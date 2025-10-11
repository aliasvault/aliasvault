import AuthenticationServices
import LocalAuthentication
import SwiftUI
import VaultStoreKit
import VaultUI
import VaultModels

// MARK: - Protocols

protocol CredentialProviderDelegate: AnyObject {
    func setupCredentialView(vaultStore: VaultStore, serviceUrl: String?) throws -> UIViewController
    func handleCredentialSelection(identifier: String, password: String)
}

protocol PasskeyProviderDelegate: AnyObject {
    func setupPasskeyView(vaultStore: VaultStore, rpId: String, clientDataHash: Data) throws -> UIViewController
    func handlePasskeySelection(credential: Credential, clientDataHash: Data, rpId: String)
}

/**
 * Base class for credential provider view controller.
 * Contains shared functionality and delegates specific behavior to extensions.
 */
public class CredentialProviderViewController: ASCredentialProviderViewController {
    // MARK: - Properties
    internal var currentHostingController: UIViewController?
    internal var isPasskeyRegistrationMode = false
    internal var isPasskeyAuthenticationMode = false
    internal var isChoosingTextToInsert = false
    internal var currentPasskeyRequest: ASPasskeyCredentialRequestParameters?

    // Credential-specific properties
    private var initialServiceUrl: String?

    // Passkey-specific properties
    private var initialRpId: String?
    private var clientDataHash: Data?

    // Delegates for specific credential types
    weak var credentialDelegate: CredentialProviderDelegate?
    weak var passkeyDelegate: PasskeyProviderDelegate?

    // MARK: - Initialization

    public override init(nibName nibNameOrNil: String?, bundle nibBundleOrNil: Bundle?) {
        super.init(nibName: nibNameOrNil, bundle: nibBundleOrNil)
        setupDelegates()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupDelegates()
    }

    private func setupDelegates() {
        // Set self as delegate for both credential types
        self.credentialDelegate = self
        self.passkeyDelegate = self
    }

    override public func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)

        print("CredentialProviderViewController: viewWillAppear called - isPasskeyRegistrationMode=\(isPasskeyRegistrationMode), isPasskeyAuthenticationMode=\(isPasskeyAuthenticationMode), domain=\(initialServiceUrl ?? "nil")")

        // Don't set up credential view if we're in passkey registration mode
        if isPasskeyRegistrationMode {
            return
        }

        // Check if there is a stored vault. If not, it means the user has not logged in yet and we
        // should redirect to the main app login screen automatically.
        let vaultStore = VaultStore()

        if !sanityChecks(vaultStore: vaultStore) {
            // Sanity checks failed and dialog has been shown.
            // Do not open the view so return here.
            return
        }

        // Try to unlock the vault. If it fails, we return and do not show the dialog.
        do {
            try vaultStore.unlockVault()
        } catch {
            print("Failed to unlock vault: \(error)")
            self.extensionContext.cancelRequest(withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.failed.rawValue,
                userInfo: [NSLocalizedDescriptionKey: error.localizedDescription]
            ))
            return
        }

        // Only set up the view if we haven't already
        if currentHostingController == nil {
            do {
                try setupView(vaultStore: vaultStore)
            } catch {
                print("Failed to setup view: \(error)")
                let alert = UIAlertController(
                    title: NSLocalizedString("loading_error", comment: ""),
                    message: NSLocalizedString("loading_error_message", comment: ""),
                    preferredStyle: .alert
                )
                alert.addAction(UIAlertAction(title: NSLocalizedString("ok", comment: ""), style: .default) { [weak self] _ in
                    self?.extensionContext.cancelRequest(withError: NSError(
                        domain: ASExtensionErrorDomain,
                        code: ASExtensionError.failed.rawValue,
                        userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("failed_to_load_credentials", comment: "")]
                    ))
                })
                present(alert, animated: true)
                return
            }
        }
    }

    private func setupView(vaultStore: VaultStore) throws {
        let hostingController: UIViewController

        if isPasskeyAuthenticationMode {
            // Use passkey delegate to setup passkey view
            guard let passkeyDelegate = passkeyDelegate else {
                throw NSError(domain: "CredentialProviderViewController", code: -1, userInfo: [NSLocalizedDescriptionKey: "Passkey delegate not set"])
            }
            hostingController = try passkeyDelegate.setupPasskeyView(vaultStore: vaultStore, rpId: initialRpId ?? "", clientDataHash: clientDataHash ?? Data())
        } else {
            // Use credential delegate to setup credential view
            guard let credentialDelegate = credentialDelegate else {
                throw NSError(domain: "CredentialProviderViewController", code: -1, userInfo: [NSLocalizedDescriptionKey: "Credential delegate not set"])
            }
            hostingController = try credentialDelegate.setupCredentialView(vaultStore: vaultStore, serviceUrl: initialServiceUrl)
        }

        addChild(hostingController)
        view.addSubview(hostingController.view)

        hostingController.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            hostingController.view.topAnchor.constraint(equalTo: view.topAnchor),
            hostingController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hostingController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hostingController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        hostingController.didMove(toParent: self)
        self.currentHostingController = hostingController
    }

    override public func prepareCredentialList(for: [ASCredentialServiceIdentifier], requestParameters: ASPasskeyCredentialRequestParameters) {
        print("CredentialProviderViewController: prepareCredentialList called for passkey")

        self.isPasskeyAuthenticationMode = true
        self.currentPasskeyRequest = requestParameters
        self.initialRpId = requestParameters.relyingPartyIdentifier
        self.clientDataHash = requestParameters.clientDataHash
    }

    override public func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        print("CredentialProviderViewController: prepareCredentialList called with \(serviceIdentifiers.count) identifiers")

        let matchedDomains = serviceIdentifiers.map { $0.identifier.lowercased() }
        if let firstDomain = matchedDomains.first {
            print("CredentialProviderViewController: First domain: \(firstDomain)")

            initialServiceUrl = firstDomain
            // Delegate will handle the rest of the setup
        }
    }

    // MARK: - Shared Methods

    /// Handle autofill view cancel action.
    internal func handleCancel() {
        self.extensionContext.cancelRequest(withError: NSError(
            domain: ASExtensionErrorDomain,
            code: ASExtensionError.userCanceled.rawValue
        ))
    }

    // MARK: - Passkey Support

    override public func provideCredentialWithoutUserInteraction(for credentialRequest: ASCredentialRequest) {
        // Check if this is a passkey request
        if let passkeyRequest = credentialRequest as? ASPasskeyCredentialRequest {
            providePasskeyCredentialWithoutUserInteraction(for: passkeyRequest)
            return
        }

        // For password credentials, delegate to credential extension
        if let credentialIdentity = credentialRequest.credentialIdentity as? ASPasswordCredentialIdentity {
            // This should call the credential extension's provideCredentialWithoutUserInteraction method
            provideCredentialWithoutUserInteraction(for: credentialIdentity)
            return
        }

        // Unknown credential type
        self.extensionContext.cancelRequest(withError: NSError(
            domain: ASExtensionErrorDomain,
            code: ASExtensionError.userInteractionRequired.rawValue
        ))
    }

    /// Run sanity checks on the vault store before opening the autofill view to check things like if user is logged in,
    /// vault is available etc.
    /// - Returns
    ///  true if sanity checks succeeded and view can open
    ///  false if sanity checks failed and a notice windows has been shown.
    func sanityChecks(vaultStore: VaultStore) -> Bool {
        if !vaultStore.hasEncryptedDatabase {
            let alert = UIAlertController(
                title: NSLocalizedString("login_required", comment: ""),
                message: NSLocalizedString("login_required_message", comment: ""),
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: NSLocalizedString("ok", comment: ""), style: .default) { [weak self] _ in
                self?.extensionContext.cancelRequest(withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.userCanceled.rawValue
                ))
            })
            present(alert, animated: true)
            return false
        }

        // Check if Face ID/Touch ID is enabled
        let context = LAContext()
        var authMethod = NSLocalizedString("face_id_touch_id", comment: "")
        var biometricsAvailable = false
        var biometricsError: NSError?

        // Check if device supports biometrics
        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &biometricsError) {
            biometricsAvailable = true
            switch context.biometryType {
            case .faceID:
                authMethod = NSLocalizedString("face_id", comment: "")
            case .touchID:
                authMethod = NSLocalizedString("touch_id", comment: "")
            default:
                break
            }
        }

        // First check if biometrics are available on the device
        if !biometricsAvailable {
            let alert = UIAlertController(
                title: String(format: NSLocalizedString("biometric_required", comment: ""), authMethod),
                message: String(format: NSLocalizedString("biometric_required_message", comment: ""), authMethod),
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: NSLocalizedString("ok", comment: ""), style: .default) { [weak self] _ in
                self?.extensionContext.cancelRequest(withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.userCanceled.rawValue
                ))
            })
            present(alert, animated: true)
            return false
        }

        // Then check if Face ID/Touch ID is enabled in the app settings
        if !vaultStore.getAuthMethods().contains(.faceID) {
            let alert = UIAlertController(
                title: String(format: NSLocalizedString("biometric_required", comment: ""), authMethod),
                message: String(format: NSLocalizedString("biometric_app_required_message", comment: ""), authMethod),
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: NSLocalizedString("ok", comment: ""), style: .default) { [weak self] _ in
                self?.extensionContext.cancelRequest(withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.userCanceled.rawValue
                ))
            })
            present(alert, animated: true)
            return false
        }

        return true
    }

}
