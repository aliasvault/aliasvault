import AuthenticationServices
import SwiftUI
import VaultStoreKit
import VaultUI
import VaultModels
import CryptoKit

/**
 * Passkey-related functionality for CredentialProviderViewController
 * This extension handles all passkey registration and authentication operations
 */
extension CredentialProviderViewController: PasskeyProviderDelegate {
    // MARK: - PasskeyProviderDelegate Implementation

    func setupPasskeyView(vaultStore: VaultStore, rpId: String, clientDataHash: Data) throws -> UIViewController {
        let viewModel = PasskeyProviderViewModel(
            loader: {
                return try vaultStore.getAllAutofillCredentialsWithPasskeys()
            },
            selectionHandler: { credential in
                // For passkey authentication, we assume the data is available
                self.handlePasskeySelection(credential: credential, clientDataHash: clientDataHash, rpId: rpId)
            },
            cancelHandler: {
                self.handleCancel()
            },
            rpId: rpId
        )

        let passkeyView = PasskeyProviderView(viewModel: viewModel)
        let hostingController = UIHostingController(rootView: passkeyView)

        return hostingController
    }

    /**
     * Handle quick return passkey credential request
     * Called from viewWillAppear when in quick return mode with vault already unlocked
     * Ensures minimum 700ms duration for smooth UX (prevents flash/jitter)
     */
    internal func handleQuickReturnPasskeyCredential(vaultStore: VaultStore, request: ASPasskeyCredentialRequest) {
        // Track start time for minimum duration
        let startTime = Date()
        let minimumDuration: TimeInterval = 0.7 // 700ms

        do {
            let clientDataHash = request.clientDataHash
            let credentialIdentity = request.credentialIdentity as? ASPasskeyCredentialIdentity
            let rpId = credentialIdentity?.relyingPartyIdentifier ?? ""
            let credentialID = credentialIdentity?.credentialID ?? Data()

            // Look up passkey by credential ID
            guard let passkey = try vaultStore.getPasskey(byCredentialId: credentialID) else {
                // Ensure minimum duration even on error
                let elapsed = Date().timeIntervalSince(startTime)
                if elapsed < minimumDuration {
                    Thread.sleep(forTimeInterval: minimumDuration - elapsed)
                }

                extensionContext.cancelRequest(withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.credentialIdentityNotFound.rawValue
                ))
                return
            }

            // Extract PRF inputs if available (iOS 18+)
            var prfInputs: PrfInputs? = nil

            if #available(iOS 18.0, *) {
                prfInputs = extractPrfInputs(from: request.extensionInput)
            }

            // Generate assertion
            let credentialId = try? PasskeyHelper.guidToBytes(passkey.id.uuidString)
            let assertion = try PasskeyAuthenticator.getAssertion(
                credentialId: credentialId ?? Data(),
                clientDataHash: clientDataHash,
                rpId: rpId,
                privateKeyJWK: passkey.privateKey,
                userId: passkey.userHandle,
                uvPerformed: true,
                prfInputs: prfInputs,
                prfSecret: passkey.prfKey
            )

            // Build extension output if PRF results are available (iOS 18+)
            if #available(iOS 18.0, *), let prfResults = assertion.prfResults {
                // Convert Data to SymmetricKey for PRF output
                let firstKey = SymmetricKey(data: prfResults.first)
                let secondKey = prfResults.second.map { SymmetricKey(data: $0) }

                let prfOutput = ASAuthorizationPublicKeyCredentialPRFAssertionOutput(
                    first: firstKey,
                    second: secondKey
                )
                let extensionOutput = ASPasskeyAssertionCredentialExtensionOutput(prf: prfOutput)

                // Ensure minimum duration before completing
                let elapsed = Date().timeIntervalSince(startTime)
                if elapsed < minimumDuration {
                    Thread.sleep(forTimeInterval: minimumDuration - elapsed)
                }

                // Complete the request with extension output
                let credential = ASPasskeyAssertionCredential(
                    userHandle: assertion.userHandle ?? Data(),
                    relyingParty: rpId,
                    signature: assertion.signature,
                    clientDataHash: clientDataHash,
                    authenticatorData: assertion.authenticatorData,
                    credentialID: assertion.credentialId,
                    extensionOutput: extensionOutput
                )

                extensionContext.completeAssertionRequest(using: credential)
                return
            }

            // Ensure minimum duration before completing
            let elapsed = Date().timeIntervalSince(startTime)
            if elapsed < minimumDuration {
                Thread.sleep(forTimeInterval: minimumDuration - elapsed)
            }

            // Complete the request without PRF extension output
            let credential = ASPasskeyAssertionCredential(
                userHandle: assertion.userHandle ?? Data(),
                relyingParty: rpId,
                signature: assertion.signature,
                clientDataHash: clientDataHash,
                authenticatorData: assertion.authenticatorData,
                credentialID: assertion.credentialId
            )

            extensionContext.completeAssertionRequest(using: credential)

        } catch {
            // Ensure minimum duration even on error
            let elapsed = Date().timeIntervalSince(startTime)
            if elapsed < minimumDuration {
                Thread.sleep(forTimeInterval: minimumDuration - elapsed)
            }

            print("handleQuickReturnPasskeyCredential error: \(error)")
            extensionContext.cancelRequest(withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.failed.rawValue,
                userInfo: [NSLocalizedDescriptionKey: error.localizedDescription]
            ))
        }
    }

    // MARK: - Passkey Registration
    override public func prepareInterface(forPasskeyRegistration registrationRequest: any ASCredentialRequest) {
        self.isPasskeyRegistrationMode = true

        guard let passkeyRequest = registrationRequest as? ASPasskeyCredentialRequest else {
            extensionContext.cancelRequest(withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.failed.rawValue
            ))
            return
        }

        // Extract registration request data
        let credentialIdentity = passkeyRequest.credentialIdentity as? ASPasskeyCredentialIdentity
        let rpId = credentialIdentity?.relyingPartyIdentifier ?? ""
        let userId = credentialIdentity?.userHandle
        let userName = credentialIdentity?.userName
        let userDisplayName = credentialIdentity?.userName // Use userName as displayName for now
        let clientDataHash = passkeyRequest.clientDataHash

        // Check if PRF extension is requested (iOS 18+)
        var prfEnabled = false
        var prfInputs: PrfInputs? = nil
        if #available(iOS 18.0, *) {
            let extensionInput = passkeyRequest.extensionInput

            if case .registration(let reg) = extensionInput {
                if let prf = reg.prf {
                    prfEnabled = true
                }
            }

            prfInputs = extractPrfInputs(from: extensionInput)
        }

        /*
        * Choose the credential algorithm from the RP’s requested list, preserving RP order.
        * iOS only exposes this list through `supportedAlgorithms`.
        *
        * Note on iOS limitation: as of iOS 18, RS256 (-257) is not forwarded to credential provider
        * extensions. Even if the RP requests RS256, iOS only provides ES256 (-7), so RS256
        * registration cannot work on iOS. RS256 signing is still supported for passkeys
        * created elsewhere and synced into the vault.
        *
        * This matches Apple’s embedded assertion behavior: Secure Enclave uses ES256
        * because it supports elliptic-curve keys, not RSA keys.
        * https://developer.apple.com/documentation/authenticationservices/creating-an-embedded-assertion
        */
        let requestedAlgorithms = passkeyRequest.supportedAlgorithms.map { $0.rawValue }

        let algorithm: Int
        do {
            algorithm = try PasskeyAuthenticator.pickSupportedAlgorithm(requestedAlgorithms)
        } catch {
            // We don't support the requested algorithm, so decline the request.
            extensionContext.cancelRequest(withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.failed.rawValue,
                userInfo: [NSLocalizedDescriptionKey: "No supported passkey algorithm requested by the relying party"]
            ))
            return
        }

        // Store parameters for use in viewWillAppear
        // Vault unlock and UI display will happen in viewWillAppear
        self.passkeyRegistrationParams = PasskeyRegistrationParams(
            rpId: rpId,
            userName: userName,
            userDisplayName: userDisplayName,
            userId: userId,
            clientDataHash: clientDataHash,
            enablePrf: prfEnabled,
            prfInputs: prfInputs,
            algorithm: algorithm
        )
    }

    /**
     * Show the passkey registration view
     */
    internal func showPasskeyRegistrationView(
        rpId: String,
        userName: String?,
        userDisplayName: String?,
        userId: Data?,
        clientDataHash: Data,
        vaultStore: VaultStore,
        enablePrf: Bool = false,
        prfInputs: PrfInputs? = nil,
        algorithm: Int = PasskeyAuthenticator.algES256
    ) {
        // Store parameters for closure capture
        let capturedRpId = rpId
        let capturedUserName = userName
        let capturedUserDisplayName = userDisplayName
        let capturedUserId = userId
        let capturedClientDataHash = clientDataHash
        let capturedVaultStore = vaultStore
        let capturedEnablePrf = enablePrf
        let capturedPrfInputs = prfInputs
        let capturedAlgorithm = algorithm

        // Query for existing passkeys with this rpId and userName
        var existingPasskeys: [PasskeyWithCredentialInfo] = []
        do {
            let results = try vaultStore.getPasskeysWithCredentialInfo(forRpId: rpId, userId: userId)
            existingPasskeys = results.map { result in
                PasskeyWithCredentialInfo(
                    id: result.passkey.id,
                    displayName: result.passkey.displayName,
                    serviceName: result.serviceName,
                    username: result.username,
                    rpId: result.passkey.rpId,
                    userId: result.passkey.userHandle
                )
            }
        } catch {
            print("PasskeyRegistration: Failed to query existing passkeys: \(error)")
            // Continue with empty list
        }

        // Query for existing Items without passkeys that match this rpId
        // Note: Don't filter by userName here - we want to show all matching items
        // regardless of username so user can choose which item to merge into
        var existingItemsWithoutPasskey: [ItemWithCredentialInfo] = []
        do {
            let results = try vaultStore.getItemsWithoutPasskey(forRpId: rpId)
            existingItemsWithoutPasskey = results.map { item in
                ItemWithCredentialInfo(
                    itemId: item.itemId,
                    serviceName: item.serviceName,
                    url: item.url,
                    username: item.username,
                    hasPassword: item.hasPassword,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt
                )
            }
        } catch {
            print("PasskeyRegistration: Failed to query existing items: \(error)")
            // Continue with empty list
        }

        // Create view model with handlers
        // Use lazy initialization to avoid capturing viewModel before it's assigned
        var viewModel: PasskeyRegistrationViewModel!
        viewModel = PasskeyRegistrationViewModel(
            requestId: "",  // Not needed for direct creation
            rpId: rpId,
            origin: "https://\(rpId)",
            userName: userName,
            userDisplayName: userDisplayName,
            existingPasskeys: existingPasskeys,
            existingItemsWithoutPasskey: existingItemsWithoutPasskey,
            completionHandler: { [weak self] success in
                guard let self = self else { return }

                // Button was clicked - create the passkey directly in Swift
                self.createPasskeyInSwift(
                    rpId: capturedRpId,
                    userName: capturedUserName,
                    userDisplayName: capturedUserDisplayName,
                    userId: capturedUserId,
                    clientDataHash: capturedClientDataHash,
                    vaultStore: capturedVaultStore,
                    viewModel: viewModel,
                    enablePrf: capturedEnablePrf,
                    prfInputs: capturedPrfInputs,
                    algorithm: capturedAlgorithm
                )
            },
            cancelHandler: { [weak self] in
                // Passkey registration - just cancel on any dismissal
                self?.extensionContext.cancelRequest(withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.userCanceled.rawValue
                ))
            }
        )

        // Create and present the view
        let passkeyView = PasskeyRegistrationView(viewModel: viewModel)
        let hostingController = UIHostingController(rootView: passkeyView)

        // Remove existing passkey hosting controller if present
        if let existingController = self.currentHostingController {
            existingController.willMove(toParent: nil)
            existingController.view.removeFromSuperview()
            existingController.removeFromParent()
        }

        // Add new hosting controller
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

    /// Maximum time to wait for a best-effort server sync/upload before proceeding offline.
    /// Keeps passkey creation responsive when the server is slow or unreachable.
    private static let bestEffortSyncTimeoutSeconds: TimeInterval = 5

    /// Runs an async operation with a best-effort timeout.
    /// Returns the operation's result, or `nil` if `seconds` elapse first.
    /// On timeout the in-flight operation is cancelled (e.g. URLSession requests abort), so the
    /// caller can proceed without blocking the user. The operation never returns `nil` itself, so a
    /// `nil` result unambiguously means "timed out".
    private func withBestEffortTimeout<T>(
        seconds: TimeInterval,
        operation: @escaping () async -> T
    ) async -> T? {
        await withTaskGroup(of: T?.self) { group in
            group.addTask { await operation() }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                return nil
            }
            let result = await group.next() ?? nil
            group.cancelAll()
            return result
        }
    }

    /**
     * Create passkey directly in Swift (called when user clicks the button)
     */
    internal func createPasskeyInSwift(
        rpId: String,
        userName: String?,
        userDisplayName: String?,
        userId: Data?,
        clientDataHash: Data,
        vaultStore: VaultStore,
        viewModel: PasskeyRegistrationViewModel,
        enablePrf: Bool = false,
        prfInputs: PrfInputs? = nil,
        algorithm: Int = PasskeyAuthenticator.algES256
    ) {
        // Create a Task to handle async operations
        Task {
            do {
                // Initialize WebApiService for vault sync/mutate and favicon extraction
                let webApiService = WebApiService()

                // Step 1: Best-effort vault sync before creating the passkey.
                // We try to sync immediately so the passkey is created on top of the latest vault,
                // but we never let a slow or unreachable server block the user. If the sync doesn't
                // finish within a few seconds we proceed offline: the passkey is stored locally and
                // the vault stays marked dirty, so it syncs automatically on the next opportunity
                // (main app launch or next autofill run).
                viewModel.setLoading(true, message: NSLocalizedString("vault_syncing", comment: "Checking connection..."))

                let syncResult = await self.withBestEffortTimeout(seconds: Self.bestEffortSyncTimeoutSeconds) {
                    await vaultStore.syncVaultWithServer(using: webApiService)
                }

                // Only surface an error for a fast, definitive failure (e.g. session expired or
                // password changed). A timeout (nil) or an offline result is treated as best-effort,
                // and we continue creating the passkey locally.
                if let syncResult, !syncResult.success, !syncResult.wasOffline {
                    viewModel.setLoading(false)

                    // Show appropriate error dialog based on error type
                    await MainActor.run {
                        self.showSyncErrorAlert(error: AppError.unknownError(message: syncResult.error ?? "Sync failed"))
                    }
                    return
                }

                // Step 2: Extract favicon from service URL
                var logo: Data?
                do {
                    logo = try await webApiService.extractFavicon(url: "https://\(rpId)")
                } catch {
                    // Continue if favicon extraction fails
                }

                // Step 3: Create passkey credentials
                let itemId = UUID()  // Item ID that will contain the passkey
                let passkeyId = UUID()  // Passkey credential ID
                let credentialId = try PasskeyHelper.guidToBytes(passkeyId.uuidString)

                // Create the passkey using PasskeyAuthenticator
                let passkeyResult = try PasskeyAuthenticator.createPasskey(
                    credentialId: credentialId,
                    clientDataHash: clientDataHash,
                    rpId: rpId,
                    userId: userId,
                    userName: userName,
                    userDisplayName: userDisplayName,
                    uvPerformed: true,
                    enablePrf: enablePrf,
                    prfInputs: prfInputs,
                    algorithm: algorithm
                )

                // Create a Passkey model object with correct parentItemId
                let now = Date()
                let passkey = Passkey(
                    id: passkeyId,
                    parentItemId: itemId,  // Link to the Item that will be created
                    rpId: rpId,
                    userHandle: userId,
                    userName: userName,
                    publicKey: passkeyResult.publicKey,
                    privateKey: passkeyResult.privateKey,
                    prfKey: passkeyResult.prfSecret,
                    displayName: userDisplayName ?? userName ?? rpId,
                    createdAt: now,
                    updatedAt: now,
                    isDeleted: false
                )

                // Step 4: Store credential with passkey in database
                // Check if we're replacing an existing passkey
                if let oldPasskeyId = viewModel.selectedPasskeyToReplace {
                    // Replace existing passkey
                    try vaultStore.replacePasskey(
                        oldPasskeyId: oldPasskeyId,
                        newPasskey: passkey,
                        displayName: viewModel.displayName,
                        logo: logo
                    )
                } else if let existingItemId = viewModel.selectedItemToMerge {
                    // Merge passkey into existing item without passkey
                    try vaultStore.addPasskeyToExistingItem(
                        itemId: existingItemId,
                        passkey: passkey,
                        logo: logo
                    )
                } else {
                    // Store item with passkey and logo in database
                    // Use viewModel.displayName as the title (Item.name)
                    _ = try vaultStore.createItemWithPasskey(
                        rpId: rpId,
                        userName: userName,
                        displayName: viewModel.displayName,
                        passkey: passkey,
                        logo: logo
                    )
                }

                // Step 5: Best-effort upload of the new passkey to the server, bounded by the same
                // timeout so a slow server can't hang the "creating passkey" overlay. On timeout or
                // failure the passkey stays saved locally with the vault marked dirty and syncs later.
                viewModel.setLoading(true, message: NSLocalizedString("creating_passkey", comment: "Uploading vault..."))
                _ = await self.withBestEffortTimeout(seconds: Self.bestEffortSyncTimeoutSeconds) { () -> Bool in
                    do {
                        try await vaultStore.mutateVault(using: webApiService)
                        return true
                    } catch {
                        // Continue even if upload fails: the passkey is saved locally
                        return false
                    }
                }

                // Step 6: Update the IdentityStore with the new credential (async call)
                let credentials = try vaultStore.getAllAutofillCredentials()
                try await CredentialIdentityStore.shared.saveCredentialIdentities(credentials)

                // Step 7: Create the ASPasskeyRegistrationCredential to return to the system
                let asCredential = ASPasskeyRegistrationCredential(
                    relyingParty: rpId,
                    clientDataHash: clientDataHash,
                    credentialID: credentialId,
                    attestationObject: passkeyResult.attestationObject
                )

                if #available(iOS 18.0, *) {
                    var prfOutput = ASPasskeyRegistrationCredentialExtensionOutput(prf: enablePrf ? .supported : .unsupported)

                    if enablePrf {
                        if let prfResults = passkeyResult.prfResults {
                            // Include evaluated prfResults if available
                            let firstKey = SymmetricKey(data: prfResults.first)

                            var secondKey: SymmetricKey?
                            if let prfSecond = passkeyResult.prfResults?.second {
                                secondKey = SymmetricKey(data: prfSecond)
                            }

                            let prf = ASAuthorizationPublicKeyCredentialPRFRegistrationOutput(first: firstKey, second: secondKey)
                            prfOutput = ASPasskeyRegistrationCredentialExtensionOutput(prf: prf)
                        }
                    }

                    asCredential.extensionOutput = prfOutput
                }

                // Hide loading overlay
                viewModel.setLoading(false)

                // Complete the registration request (must be on main thread)
                await MainActor.run {
                    self.extensionContext.completeRegistrationRequest(using: asCredential)
                }

            } catch {
                // Hide loading overlay
                viewModel.setLoading(false)

                // Cancel request (must be on main thread)
                await MainActor.run {
                    self.extensionContext.cancelRequest(withError: NSError(
                        domain: ASExtensionErrorDomain,
                        code: ASExtensionError.failed.rawValue,
                        userInfo: [NSLocalizedDescriptionKey: "Failed to create passkey: \(error.localizedDescription)"]
                    ))
                }
            }
        }
    }

    // MARK: - Passkey Authentication

    /**
     * Authenticate with a specific passkey
     */
    private func authenticateWithPasskey(
        _ passkey: Passkey,
        clientDataHash: Data,
        rpId: String,
        prfInputs: PrfInputs? = nil
    ) throws {
        // Generate assertion using PasskeyAuthenticator
        let credentialId = try? PasskeyHelper.guidToBytes(passkey.id.uuidString)

        let assertion = try PasskeyAuthenticator.getAssertion(
            credentialId: credentialId ?? Data(),
            clientDataHash: clientDataHash,
            rpId: rpId,
            privateKeyJWK: passkey.privateKey,
            userId: passkey.userHandle,
            uvPerformed: true,
            prfInputs: prfInputs,
            prfSecret: passkey.prfKey
        )

        // Build extension output if PRF results are available (iOS 18+)
        if #available(iOS 18.0, *), let prfResults = assertion.prfResults {
            // Convert Data to SymmetricKey for PRF output
            let firstKey = SymmetricKey(data: prfResults.first)
            let secondKey = prfResults.second.map { SymmetricKey(data: $0) }

            let prfOutput = ASAuthorizationPublicKeyCredentialPRFAssertionOutput(
                first: firstKey,
                second: secondKey
            )
            let extensionOutput = ASPasskeyAssertionCredentialExtensionOutput(prf: prfOutput)

            // Complete the request with extension output
            let credential = ASPasskeyAssertionCredential(
                userHandle: assertion.userHandle ?? Data(),
                relyingParty: rpId,
                signature: assertion.signature,
                clientDataHash: clientDataHash,
                authenticatorData: assertion.authenticatorData,
                credentialID: assertion.credentialId,
                extensionOutput: extensionOutput
            )

            extensionContext.completeAssertionRequest(using: credential)
            return
        }

        // Complete the request without PRF extension output
        let credential = ASPasskeyAssertionCredential(
            userHandle: assertion.userHandle ?? Data(),
            relyingParty: rpId,
            signature: assertion.signature,
            clientDataHash: clientDataHash,
            authenticatorData: assertion.authenticatorData,
            credentialID: assertion.credentialId
        )

        extensionContext.completeAssertionRequest(using: credential)
    }

    /**
     * Handle passkey credential selection from picker
     */
    internal func handlePasskeySelection(credential: AutofillCredential, clientDataHash: Data, rpId: String) {
        do {
            // Get the passkey and verify it matches the RP ID
            guard let passkey = credential.passkey,
                  passkey.rpId.lowercased() == rpId.lowercased() else {
                extensionContext.cancelRequest(withError: NSError(
                    domain: ASExtensionErrorDomain,
                    code: ASExtensionError.credentialIdentityNotFound.rawValue
                ))
                return
            }

            // Extract PRF inputs from the passkey request if available
            var prfInputs: PrfInputs?
            if #available(iOS 18.0, *), let extensionInput = self.currentPasskeyRequest?.extensionInput {
                prfInputs = extractPrfInputs(from: extensionInput)
            }

            try authenticateWithPasskey(passkey, clientDataHash: clientDataHash, rpId: rpId, prfInputs: prfInputs)
        } catch {
            print("PasskeyAuthentication error: \(error)")
            extensionContext.cancelRequest(withError: NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.failed.rawValue,
                userInfo: [NSLocalizedDescriptionKey: error.localizedDescription]
            ))
        }
    }

    /**
     * Extract PRF inputs from passkey credential request parameters
     * Returns nil if PRF extension is not requested or not available
     */
    @available(iOS 18.0, *)
    private func extractPrfInputs(from extensionInput: ASPasskeyCredentialExtensionInput) -> PrfInputs? {
        if case .registration(let reg) = extensionInput {
            if let prf = reg.prf {
                return PrfInputs(first: prf.inputValues?.saltInput1, second: prf.inputValues?.saltInput2)
            } else {
                return nil
            }
        }
        else if case .assertion(let ass) = extensionInput {
            if let prf = ass.prf {
                return PrfInputs(first: prf.inputValues?.saltInput1, second: prf.inputValues?.saltInput2)
            } else {
                return nil
            }
        }

        return nil
    }

    /**
     * Extract PRF inputs from passkey credential request parameters
     * Returns nil if PRF extension is not requested or not available
     */
    @available(iOS 18.0, *)
    private func extractPrfInputs(from extensionInput: ASPasskeyAssertionCredentialExtensionInput) -> PrfInputs? {
        if let prf = extensionInput.prf {
            return PrfInputs(first: prf.inputValues?.saltInput1, second: prf.inputValues?.saltInput2)
        }

        return nil
    }
}
