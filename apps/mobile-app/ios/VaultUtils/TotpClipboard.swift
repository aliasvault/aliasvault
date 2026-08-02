import Foundation
import UIKit

/// Puts a credential's current TOTP code on the clipboard while autofilling, so the user can
/// paste it into the 2FA field after the fill completes.
public enum TotpClipboard {
    /// Copy the current TOTP code for `secret` to the clipboard (only when the user has the
    /// copy-on-fill setting enabled, which is the default).
    public static func copyCodeIfEnabled(secret: String?) {
        guard AutofillSettings.shouldCopyTotpOnFill,
              let secret = secret, !secret.isEmpty,
              let code = TotpGenerator.generateCode(secret: secret),
              !code.isEmpty else {
            return
        }

        UIPasteboard.general.string = code
    }
}
