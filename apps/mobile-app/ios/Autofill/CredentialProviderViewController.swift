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

    // Passkey registration properties
    internal var passkeyRegistrationParams: PasskeyRegistrationParams?

    // Quick return mode (complete request without showing UI)
    internal var isQuickReturnMode = false
    internal var quickReturnPasswordRequest: ASPasswordCredentialRequest?
    internal var quickReturnPasskeyRequest: ASPasskeyCredentialRequest?

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

        // Check if we're in quick return mode
        // Setup the loading view (actual unlock happens in viewDidAppear)
        if isQuickReturnMode {
            // Determine the type of credential being retrieved
            let type: QuickUnlockType = quickReturnPasskeyRequest != nil ? .passkey : .credential

            // Show loading view with appropriate type
            let loadingView = QuickUnlockLoadingView(type: type)
            let hostingController = UIHostingController(rootView: loadingView)

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
            return
        }

        // Check if there is a stored vault. If not, it means the user has not logged in yet and we
        // should redirect to the main app login screen automatically.
        let vaultStore = VaultStore()

        if !sanityChecks(vaultStore: vaultStore) {
            return
        }

        // Check if any authentication method is enabled (PIN or biometric)
        let pinEnabled = vaultStore.isPinEnabled()
        let biometricEnabled = vaultStore.isBiometricAuthEnabled()

        if !pinEnabled && !biometricEnabled {
            // No authentication method is enabled - show error
            let alert = UIAlertController(
                title: NSLocalizedString("auth_required", comment: "Authentication Required"),
                message: NSLocalizedString("auth_required_message", comment: "Please enable Face ID or PIN unlock in the main AliasVault app to use autofill."),
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: NSLocalizedString("ok", comment: "OK"), style: .default) { [weak self] _ in
                self?.extensionContext.cancelRequest(withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.userCanceled.rawValue
                ))
            })
            present(alert, animated: true)
            return
        }

        // Show unlock coordinator which will handle PIN/biometric unlock
        // and then show the actual view after successful unlock
        showUnlockCoordinator(vaultStore: vaultStore)
    }

    override public func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)

        // If we're in quick return mode, now trigger the unlock and complete the request
        // The loading view is already visible from viewWillAppear
        if isQuickReturnMode {
            // Dispatch async to ensure the view is fully rendered before showing auth prompt
            // This prevents a race condition where the first tap doesn't trigger the auth UI
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }

                let vaultStore = VaultStore()

                if !self.sanityChecks(vaultStore: vaultStore) {
                    return
                }

                // Check if any authentication method is enabled
                let pinEnabled = vaultStore.isPinEnabled()
                let biometricEnabled = vaultStore.isBiometricAuthEnabled()

                if !pinEnabled && !biometricEnabled {
                    print("Quick return failed: No auth method enabled")
                    self.extensionContext.cancelRequest(withError: NSError(
                        domain: ASExtensionErrorDomain,
                        code: ASExtensionError.failed.rawValue,
                        userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("auth_required_message", comment: "Please enable Face ID or PIN unlock in the main AliasVault app to use autofill.")]
                    ))
                    return
                }

                // If PIN is enabled, show PIN unlock immediately (PIN takes priority)
                if pinEnabled {
                    self.showQuickReturnPinUnlock(vaultStore: vaultStore)
                    return
                }

                // Only biometric is enabled - try to unlock with biometric
                do {
                    // Try to unlock the vault with biometric
                    try vaultStore.unlockVault()

                    // Unlock succeeded - process the credential request
                    if let passkeyRequest = self.quickReturnPasskeyRequest {
                        self.handleQuickReturnPasskeyCredential(vaultStore: vaultStore, request: passkeyRequest)
                    } else if let passwordRequest = self.quickReturnPasswordRequest {
                        self.handleQuickReturnPasswordCredential(vaultStore: vaultStore, request: passwordRequest)
                    }
                } catch let error as NSError {
                    print("Quick return vault unlock failed: \(error)")

                    // Provide specific error message based on error code
                    var errorMessage = error.localizedDescription
                    if error.domain == "VaultStore" {
                        switch error.code {
                        case 3:
                            errorMessage = NSLocalizedString("no_encryption_key_message", comment: "No encryption key found. Please unlock the vault in the main AliasVault app first.")
                        case 8, 9:
                            errorMessage = NSLocalizedString("keychain_error_message", comment: "Failed to retrieve encryption key. This may be due to cancelled biometric authentication.")
                        default:
                            break
                        }
                    }

                    self.extensionContext.cancelRequest(withError: NSError(
                        domain: ASExtensionErrorDomain,
                        code: ASExtensionError.failed.rawValue,
                        userInfo: [NSLocalizedDescriptionKey: errorMessage]
                    ))
                }
            }
        }
    }

    /// Show PIN unlock for quick return mode when biometric fails
    private func showQuickReturnPinUnlock(vaultStore: VaultStore) {
        // Remove the loading view
        if let loadingController = currentHostingController {
            loadingController.willMove(toParent: nil)
            loadingController.view.removeFromSuperview()
            loadingController.removeFromParent()
            currentHostingController = nil
        }

        // Create PIN unlock view model with injected dependencies
        let viewModel = PinUnlockViewModel(
            pinLength: vaultStore.getPinLength(),
            unlockHandler: { [weak self] pin in
                guard let self = self else { return }

                // Attempt to unlock with PIN
                let encryptionKeyBase64 = try vaultStore.unlockWithPin(pin)

                // Store the encryption key and unlock
                try vaultStore.storeEncryptionKey(base64Key: encryptionKeyBase64)
                try vaultStore.unlockVault()

                // Process the credential request
                await MainActor.run {
                    if let passkeyRequest = self.quickReturnPasskeyRequest {
                        self.handleQuickReturnPasskeyCredential(vaultStore: vaultStore, request: passkeyRequest)
                    } else if let passwordRequest = self.quickReturnPasswordRequest {
                        self.handleQuickReturnPasswordCredential(vaultStore: vaultStore, request: passwordRequest)
                    }
                }
            },
            cancelHandler: { [weak self] in
                self?.handleCancel()
            }
        )

        // Show PIN unlock view
        let pinUnlockView = PinUnlockView(viewModel: viewModel)
        let hostingController = UIHostingController(rootView: pinUnlockView)
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
        currentHostingController = hostingController
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
        self.isPasskeyAuthenticationMode = true
        self.currentPasskeyRequest = requestParameters
        self.initialRpId = requestParameters.relyingPartyIdentifier
        self.clientDataHash = requestParameters.clientDataHash
    }

    override public func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        let matchedDomains = serviceIdentifiers.map { $0.identifier.lowercased() }
        if let firstDomain = matchedDomains.first {
            print("CredentialProviderViewController: First domain: \(firstDomain)")

            initialServiceUrl = firstDomain
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

    // MARK: - Unlock Flow

    /// Show the unlock coordinator which handles PIN/biometric unlock
    private func showUnlockCoordinator(vaultStore: VaultStore) {
        let unlockController = UnlockCoordinatorViewController(
            vaultStore: vaultStore,
            onUnlocked: { [weak self] in
                self?.onUnlockSuccess(vaultStore: vaultStore)
            },
            onCancel: { [weak self] in
                self?.handleCancel()
            }
        )

        // Add as child view controller
        addChild(unlockController)
        view.addSubview(unlockController.view)

        unlockController.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            unlockController.view.topAnchor.constraint(equalTo: view.topAnchor),
            unlockController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            unlockController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            unlockController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        unlockController.didMove(toParent: self)
        self.currentHostingController = unlockController
    }

    /// Called after successful unlock - show the actual credential/passkey view
    private func onUnlockSuccess(vaultStore: VaultStore) {
        // Remove the unlock coordinator view
        if let unlockController = currentHostingController {
            unlockController.willMove(toParent: nil)
            unlockController.view.removeFromSuperview()
            unlockController.removeFromParent()
            currentHostingController = nil
        }

        // Handle passkey registration mode after vault is unlocked
        if isPasskeyRegistrationMode {
            guard let params = passkeyRegistrationParams else {
                extensionContext.cancelRequest(withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.failed.rawValue,
                    userInfo: [NSLocalizedDescriptionKey: "Missing passkey registration parameters"]
                ))
                return
            }

            // Show passkey registration UI
            showPasskeyRegistrationView(
                rpId: params.rpId,
                userName: params.userName,
                userDisplayName: params.userDisplayName,
                userId: params.userId,
                clientDataHash: params.clientDataHash,
                vaultStore: vaultStore,
                enablePrf: params.enablePrf,
                prfInputs: params.prfInputs
            )
            return
        }

        // Set up the credential/passkey selection view
        do {
            try setupView(vaultStore: vaultStore)

            // Perform initial credential sync if the credential identity store is empty
            // This is an OOBE (Out Of Box Experience) step to populate the store on first use
            // Note: Regular syncs happen in the main app, this is just a fallback
            Task {
                await performInitialSyncIfNeeded(vaultStore: vaultStore)
            }
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
        }
    }

    // MARK: - Passkey Support

    override public func provideCredentialWithoutUserInteraction(for credentialRequest: ASCredentialRequest) {
        // Always cancel and let iOS invoke prepareInterfaceToProvideCredential instead.
        self.extensionContext.cancelRequest(withError: NSError(
            domain: ASExtensionErrorDomain,
            code: ASExtensionError.userInteractionRequired.rawValue
        ))
    }

    override public func prepareInterfaceToProvideCredential(for request: ASCredentialRequest) {
        // Check if this is a password/credential request
        if let passwordRequest = request as? ASPasswordCredentialRequest {
            self.isQuickReturnMode = true
            self.quickReturnPasswordRequest = passwordRequest
            return
        }

        // Check if this is a passkey request
        if let passkeyRequest = request as? ASPasskeyCredentialRequest {
            self.isQuickReturnMode = true
            self.quickReturnPasskeyRequest = passkeyRequest
            return
        }
    }

    /// Perform initial sync if credential identity store is empty
    /// This is called on first autofill use as an OOBE step
    private func performInitialSyncIfNeeded(vaultStore: VaultStore) async {
        do {
            // Check if the credential identity store is empty
            let isEmpty = await CredentialIdentityStore.shared.isStoreEmpty()
            guard isEmpty else {
                print("Credential identity store already has entries, skipping initial sync")
                return
            }

            print("Credential identity store is empty, performing initial sync")

            // Get all credentials from the vault (already unlocked)
            let credentials = try vaultStore.getAllCredentials()

            // Save credentials to the iOS credential identity store
            try await CredentialIdentityStore.shared.saveCredentialIdentities(credentials)

            print("Initial credential sync completed successfully")
        } catch {
            // Log error but don't block the user - they can still use autofill
            print("Initial credential sync failed: \(error)")
        }
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

        // Check if any authentication method (PIN or biometric) is enabled
        let pinEnabled = vaultStore.isPinEnabled()
        let biometricEnabled = vaultStore.getAuthMethods().contains(.faceID)

        // If neither PIN nor biometric is enabled, show error
        if !pinEnabled && !biometricEnabled {
            let alert = UIAlertController(
                title: NSLocalizedString("auth_required", comment: ""),
                message: NSLocalizedString("auth_required_message", comment: ""),
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

        // If biometric is enabled, check if device supports it
        if biometricEnabled {
            let context = LAContext()
            var authMethod = NSLocalizedString("face_id_touch_id", comment: "")
            var biometricsError: NSError?

            // Check if device supports biometrics
            if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &biometricsError) {
                switch context.biometryType {
                case .faceID:
                    authMethod = NSLocalizedString("face_id", comment: "")
                case .touchID:
                    authMethod = NSLocalizedString("touch_id", comment: "")
                default:
                    break
                }
            } else {
                // Device doesn't support biometrics but biometric is enabled
                // Check if PIN is available as fallback
                if !pinEnabled {
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
            }
        }

        return true
    }

    // MARK: - Error Handling

    /**
     * Show sync error alert dialog with appropriate message based on error type
     * This method is internal so it can be used by both passkey and credential extensions
     */
    internal func showSyncErrorAlert(error: Error) {
        var title = NSLocalizedString("connection_error_title", comment: "Connection Error")
        var message = NSLocalizedString("connection_error_message", comment: "No connection to the server can be made.")

        // Check if it's a VaultSyncError and customize message accordingly
        if let syncError = error as? VaultSyncError {
            switch syncError {
            case .sessionExpired, .authenticationFailed:
                title = NSLocalizedString("session_expired_title", comment: "Session Expired")
                message = NSLocalizedString("session_expired_message", comment: "Your session has expired. Please sign in again.")

            case .passwordChanged:
                title = NSLocalizedString("password_changed_title", comment: "Password Changed")
                message = NSLocalizedString("password_changed_message", comment: "Your password has been changed. Please sign in again.")

            case .clientVersionNotSupported:
                title = NSLocalizedString("version_not_supported_title", comment: "Update Required")
                message = NSLocalizedString("version_not_supported_message", comment: "Your app version is no longer supported. Please update to the latest version.")

            case .serverVersionNotSupported:
                title = NSLocalizedString("server_version_not_supported_title", comment: "Server Update Required")
                message = NSLocalizedString("server_version_not_supported_message", comment: "The server version is outdated. Please contact your administrator to update the server.")

            case .serverUnavailable:
                title = NSLocalizedString("server_unavailable_title", comment: "Server Unavailable")
                message = NSLocalizedString("server_unavailable_message", comment: "The server is currently unavailable. Please try again later.")

            case .networkError, .timeout:
                title = NSLocalizedString("network_error_title", comment: "Network Error")
                message = NSLocalizedString("network_error_message", comment: "A network error occurred. Please check your connection and try again.")

            default:
                // Use default connectivity error message for other errors
                break
            }
        }

        let alert = UIAlertController(
            title: title,
            message: message,
            preferredStyle: .alert
        )

        alert.addAction(UIAlertAction(
            title: NSLocalizedString("ok", comment: "OK"),
            style: .default,
            handler: { _ in
                // User acknowledged the error
            }
        ))

        // Present the alert
        if let currentController = self.currentHostingController {
            currentController.present(alert, animated: true)
        } else {
            self.present(alert, animated: true)
        }
    }

}
