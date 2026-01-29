import Foundation
import VaultModels

/**
 * CredentialHelpers
 * -------------------------
 * Utility functions for working with AutofillCredential objects.
 */
public class CredentialHelpers {
    /// Returns username or email from a credential, depending on which is available.
    /// Prioritizes username over email.
    /// - Parameter credential: The credential to extract the identifier from
    /// - Returns: Username if available, otherwise email, or empty string if neither exists
    public static func usernameOrEmail(credential: AutofillCredential) -> String {
        return credential.identifier
    }
}
