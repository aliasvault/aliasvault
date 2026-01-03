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
                return try await vaultStore.getAllAutofillCredentials()
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
    
    /**
     * Handle quick return password credential request
     * Called from viewWillAppear when in quick return mode with vault already unlocked
     * Ensures minimum 700ms duration for smooth UX (prevents flash/jitter)
     */
    internal func handleQuickReturnPasswordCredential(vaultStore: VaultStore, request: ASPasswordCredentialRequest) {
        // Track start time for minimum duration
        let startTime = Date()
        let minimumDuration: TimeInterval = 0.7 // 700ms

        do {
            let credentials = try vaultStore.getAllAutofillCredentials()

            if let matchingCredential = credentials.first(where: { credential in
                return credential.id.uuidString == request.credentialIdentity.recordIdentifier
            }) {
                // Ensure minimum duration before completing
                let elapsed = Date().timeIntervalSince(startTime)
                if elapsed < minimumDuration {
                    Thread.sleep(forTimeInterval: minimumDuration - elapsed)
                }

                // Use the identifier that matches the credential identity
                let identifier = request.credentialIdentity.user
                let passwordCredential = ASPasswordCredential(
                    user: identifier,
                    password: matchingCredential.password ?? ""
                )
                self.extensionContext.completeRequest(withSelectedCredential: passwordCredential, completionHandler: nil)
            } else {
                // Ensure minimum duration even on error
                let elapsed = Date().timeIntervalSince(startTime)
                if elapsed < minimumDuration {
                    Thread.sleep(forTimeInterval: minimumDuration - elapsed)
                }

                self.extensionContext.cancelRequest(
                    withError: NSError(
                        domain: ASExtensionErrorDomain,
                        code: ASExtensionError.credentialIdentityNotFound.rawValue
                    )
                )
            }
        } catch {
            // Ensure minimum duration even on error
            let elapsed = Date().timeIntervalSince(startTime)
            if elapsed < minimumDuration {
                Thread.sleep(forTimeInterval: minimumDuration - elapsed)
            }

            print("handleQuickReturnPasswordCredential error: \(error)")
            self.extensionContext.cancelRequest(
                withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.failed.rawValue,
                    userInfo: [NSLocalizedDescriptionKey: error.localizedDescription]
                )
            )
        }
    }
}
