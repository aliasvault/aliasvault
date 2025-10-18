import AuthenticationServices
import VaultModels
import VaultUtils

/**
 * Native iOS implementation of the CredentialIdentityStore protocol.
 *
 * This class is used to save and remove credential identities from the iOS password
 * and passkey autosuggest store, which is shown inline in the keyboard amongst other places.
 */
public class CredentialIdentityStore {
    /// Get global credential store instance
    public static let shared = CredentialIdentityStore()
    private let store = ASCredentialIdentityStore.shared

    private init() {}

    /// Save credentials into the native iOS credential store.
    /// - Parameters:
    ///   - credentials: The credentials to register
    public func saveCredentialIdentities(_ credentials: [Credential]) async throws {
        var allIdentities: [ASCredentialIdentity] = []

        let state = await storeState()
        guard state.isEnabled else {
            return
        }

        // Save passwords into autofill store
        let passwordIdentities = createPasswordIdentities(from: credentials)
        allIdentities.append(contentsOf: passwordIdentities)

        // Save passkeys into autofill store
        let passkeyIdentities = createPasskeyIdentities(from: credentials)
        allIdentities.append(contentsOf: passkeyIdentities)

        guard !allIdentities.isEmpty else {
            return
        }

        do {
            // First, remove all existing credential identities to ensure a clean replacement
            try await store.removeAllCredentialIdentities()

            // Then save the new credential identities
            try await store.saveCredentialIdentities(allIdentities)
        } catch {
            // Re-throw the error so the caller knows the operation failed
            throw error
        }
    }

    /// Remove all credentials from iOS credential store.
    public func removeAllCredentialIdentities() async throws {
        try await store.removeAllCredentialIdentities()
    }

    private func storeState() async -> ASCredentialIdentityStoreState {
        await withCheckedContinuation { continuation in
            store.getState { state in
                continuation.resume(returning: state)
            }
        }
    }

    private static func effectiveDomain(from host: String) -> String {
        let parts = host.split(separator: ".")
        guard parts.count >= 2 else { return host }
        return parts.suffix(2).joined(separator: ".")
    }

    /// Create password credential identities from credentials
    private func createPasswordIdentities(from credentials: [Credential]) -> [ASPasswordCredentialIdentity] {
        return credentials.compactMap { credential in
            guard credential.passkeys?.isEmpty == true else {
                // Skip if this record is a passkey as it will be saved in the createPasskeyIdentities method
                return nil
            }

            guard let password = credential.password, !password.value.isEmpty else {
                // Skip credentials with no password (e.g. applies when this record is a passkey)
                return nil
            }

            guard let urlString = credential.service.url,
                  let url = URL(string: urlString),
                  let host = url.host else {
                return nil
            }

            let identifier = CredentialHelpers.usernameOrEmail(credential: credential)
            guard !identifier.isEmpty else {
                return nil // Skip credentials with no identifier
            }

            let effectiveDomain = Self.effectiveDomain(from: host)

            return ASPasswordCredentialIdentity(
                serviceIdentifier: ASCredentialServiceIdentifier(identifier: effectiveDomain, type: .domain),
                user: identifier,
                recordIdentifier: credential.id.uuidString
            )
        }
    }

    /// Create passkey credential identities from credentials
    private func createPasskeyIdentities(from credentials: [Credential]) -> [ASPasskeyCredentialIdentity] {
        return credentials.flatMap { credential -> [ASPasskeyCredentialIdentity] in
            guard let passkeys = credential.passkeys else {
                return []
            }

            return passkeys.filter { !($0.isDeleted) }
                .compactMap { passkey in
                    // Get the userName for display in iOS AutoFill UI
                    // Passkeys don't store userName in the database, so we use the credential's username or email
                    let userName = passkey.userName ?? CredentialHelpers.usernameOrEmail(credential: credential)

                    // Convert passkey.Id to bytes for credentialID
                    let credentialId = try? PasskeyHelper.guidToBytes(passkey.id.uuidString)

                    // For passkeys, we use the rpId from the passkey itself, not the service URL
                    // This is because passkeys are tied to the RP ID, which may differ from the service URL
                    return ASPasskeyCredentialIdentity(
                        relyingPartyIdentifier: passkey.rpId,
                        userName: userName,
                        credentialID: credentialId ?? Data(),  // WebAuthn credential ID (16-byte GUID)
                        userHandle: passkey.userHandle ?? Data(),
                        recordIdentifier: passkey.id.uuidString
                    )
                }
        }
    }
}
