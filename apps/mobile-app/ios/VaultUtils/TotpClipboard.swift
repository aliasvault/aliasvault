import Foundation
import UIKit
import VaultModels

/// Puts a credential's current TOTP code on the clipboard while autofilling, so the user can
/// paste it into the 2FA field after the fill completes.
public enum TotpClipboard {
    /// Copy the current code for `totp` to the clipboard (only when the user has the
    /// copy-on-fill setting enabled, which is the default).
    public static func copyCodeIfEnabled(totp: TotpCode?) {
        guard AutofillSettings.shouldCopyTotpOnFill,
              let totp = totp, !totp.secretKey.isEmpty,
              let code = TotpGenerator.generateCode(secret: totp.secretKey,
                                                    period: totp.period,
                                                    digits: totp.digits,
                                                    algorithm: totp.algorithm),
              !code.isEmpty else {
            return
        }

        UIPasteboard.general.string = code
    }
}
