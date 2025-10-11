import AuthenticationServices
import SwiftUI
import VaultStoreKit
import VaultUI
import VaultModels

/**
 * Credential-specific functionality for CredentialProviderViewController
 * This extension handles all password credential operations
 */
extension CredentialProviderViewController: CredentialProviderDelegate {

    // MARK: - CredentialProviderDelegate Implementation

    func setupCredentialView(vaultStore: VaultStore, serviceUrl: String?) throws -> UIViewController {
        // Create the ViewModel with injected behaviors
        let viewModel = CredentialProviderViewModel(
            loader: {
                return try await vaultStore.getAllCredentials()
            },
            selectionHandler: { identifier, password in
                self.handleCredentialSelection(identifier: identifier, password: password)
            },
            cancelHandler: {
                self.handleCancel()
            },
            serviceUrl: serviceUrl
        )

        // Set text insertion mode if needed
        if isChoosingTextToInsert {
            viewModel.isChoosingTextToInsert = true
        }

        let hostingController = UIHostingController(
            rootView: CredentialProviderView(viewModel: viewModel)
        )

        return hostingController
    }

    func handleCredentialSelection(identifier: String, password: String) {
        if isChoosingTextToInsert {
            // For text insertion, insert only the selected text
            if #available(iOS 18.0, *) {
                self.extensionContext.completeRequest(
                    withTextToInsert: identifier,
                    completionHandler: nil
                )
            } else {
                // Fallback on earlier versions: do nothing as this feature
                // is not supported and we should not reach this point?
            }
        } else {
            // For regular credential selection
            let passwordCredential = ASPasswordCredential(
                user: identifier,
                password: password
            )
            self.extensionContext.completeRequest(withSelectedCredential: passwordCredential, completionHandler: nil)
        }
    }

    // MARK: - Credential-specific Methods

    override public func prepareInterfaceForUserChoosingTextToInsert() {
        isChoosingTextToInsert = true
        // This will be handled by the credential view model when it's created
    }

    override public func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        // QuickType bar suggestions are disabled on iOS <26, so this should only be called on iOS 26+
        if #unavailable(iOS 26.0) {
            // iOS < 26 - we do not support quick autofill due to buggy behavior
            print("provideCredentialWithoutUserInteraction called on iOS <26 (unexpected)")
            self.extensionContext.cancelRequest(
                withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.userInteractionRequired.rawValue
                )
            )
            return
        }

        do {
            let vaultStore = VaultStore()

            // Check if vault database exists
            guard vaultStore.hasEncryptedDatabase else {
                self.extensionContext.cancelRequest(
                    withError: NSError(
                        domain: ASExtensionErrorDomain,
                        code: ASExtensionError.userInteractionRequired.rawValue
                    )
                )
                return
            }

            // Unlock vault with biometrics (iOS 26+ works reliably)
            try vaultStore.unlockVault()

            let credentials = try vaultStore.getAllCredentials()

            if let matchingCredential = credentials.first(where: { credential in
                return credential.id.uuidString == credentialIdentity.recordIdentifier
            }) {
                // Use the identifier that matches the credential identity
                let identifier = credentialIdentity.user
                let passwordCredential = ASPasswordCredential(
                    user: identifier,
                    password: matchingCredential.password?.value ?? ""
                )
                self.extensionContext.completeRequest(withSelectedCredential: passwordCredential, completionHandler: nil)
            } else {
                self.extensionContext.cancelRequest(
                    withError: NSError(
                        domain: ASExtensionErrorDomain,
                        code: ASExtensionError.credentialIdentityNotFound.rawValue
                    )
                )
            }
        } catch {
            print("provideCredentialWithoutUserInteraction error: \(error)")
            // On any error, request user interaction
            self.extensionContext.cancelRequest(
                withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.userInteractionRequired.rawValue
                )
            )
        }
    }
}
