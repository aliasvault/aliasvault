import SwiftUI
import VaultModels
import VaultUtils

private let locBundle = Bundle.vaultUI

/// Autofill credential card view
public struct AutofillCredentialCard: View {
    let credential: AutofillCredential
    let action: () -> Void
    let onCopy: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme

    public init(
        credential: AutofillCredential,
        action: @escaping () -> Void,
        onCopy: @escaping (String) -> Void = { _ in }
    ) {
        self.credential = credential
        self.action = action
        self.onCopy = onCopy
    }

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: colorScheme)
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                // Service logo
                ItemLogoView(logoData: credential.logo)
                    .frame(width: 32, height: 32)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Text(truncateText(credential.serviceName ?? "Unknown", limit: 26))
                            .font(.headline)
                            .foregroundColor(colors.text)

                        // Passkey indicator
                        if credential.hasPasskey {
                            Image(systemName: "person.badge.key")
                                .font(.system(size: 12))
                                .foregroundColor(colors.textMuted)
                        }

                        // TOTP indicator
                        if credential.hasTotp {
                            Image(systemName: "textformat.123")
                                .font(.system(size: 12))
                                .foregroundColor(colors.textMuted)
                        }
                    }

                    Text(truncateText(credential.identifier, limit: 26))
                        .font(.subheadline)
                        .foregroundColor(colors.textMuted)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .foregroundColor(colors.icon)
            }
            .padding(8)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(colors.accentBackground)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(colors.accentBorder, lineWidth: 1)
            )
            .cornerRadius(8)
        }
        .contextMenu(menuItems: {
            // Copy actions only copy to the clipboard and show a toast — they
            // intentionally leave the autofill picker open so the user can
            // still pick a credential to fill afterwards (for example: copy
            // TOTP first, then tap to fill username/password).
            if let username = credential.username, !username.isEmpty {
                Button(action: {
                    UIPasteboard.general.string = username
                    onCopy(String(localized: "username_copied", bundle: locBundle))
                }, label: {
                    Label(String(localized: "copy_username", bundle: locBundle), systemImage: "person")
                })
            }

            if let password = credential.password, !password.isEmpty {
                Button(action: {
                    UIPasteboard.general.string = password
                    onCopy(String(localized: "password_copied", bundle: locBundle))
                }, label: {
                    Label(String(localized: "copy_password", bundle: locBundle), systemImage: "key")
                })
            }

            if let email = credential.email, !email.isEmpty {
                Button(action: {
                    UIPasteboard.general.string = email
                    onCopy(String(localized: "email_copied", bundle: locBundle))
                }, label: {
                    Label(String(localized: "copy_email", bundle: locBundle), systemImage: "envelope")
                })
            }

            if credential.hasTotp,
               let totp = credential.totp,
               let code = TotpGenerator.generateCode(secret: totp.secretKey,
                                                     period: totp.period,
                                                     digits: totp.digits,
                                                     algorithm: totp.algorithm),
               !code.isEmpty {
                Button(action: {
                    UIPasteboard.general.string = code
                    onCopy(String(localized: "totp_code_copied", bundle: locBundle))
                }, label: {
                    Label(String(localized: "copy_totp_code", bundle: locBundle), systemImage: "number")
                })
            }

            if (credential.username != nil && !credential.username!.isEmpty) ||
               (credential.password != nil && !credential.password!.isEmpty) ||
               (credential.email != nil && !credential.email!.isEmpty) ||
               credential.hasTotp {
                Divider()
            }

            Button(action: {
                if let url = URL(string: "aliasvault://items/\(credential.id.uuidString)") {
                    UIApplication.shared.open(url)
                }
            }, label: {
                Label(String(localized: "view_details", bundle: locBundle), systemImage: "eye")
            })

            Button(action: {
                if let url = URL(string: "aliasvault://items/add-edit-page?id=\(credential.id.uuidString)") {
                    UIApplication.shared.open(url)
                }
            }, label: {
                Label(String(localized: "edit", bundle: locBundle), systemImage: "pencil")
            })
        })
    }
}

/// Toast pill used for copy confirmations.
public struct CopyToastView: View {
    public let message: String

    public init(message: String) {
        self.message = message
    }

    public var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.green)
            Text(message)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            Capsule()
                .fill(.regularMaterial)
        )
        .overlay(
            Capsule()
                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5)
        )
        .shadow(color: Color.black.opacity(0.18), radius: 12, x: 0, y: 4)
    }
}

/// Truncate text to a maximum limit and appends "..." at the end
public func truncateText(_ text: String?, limit: Int) -> String {
    guard let text = text else { return "" }
    if text.count > limit {
        let index = text.index(text.startIndex, offsetBy: limit)
        return String(text[..<index]) + "..."
    } else {
        return text
    }
}

#Preview {
    AutofillCredentialCard(
        credential: AutofillCredential(
            id: UUID(),
            serviceName: "Example Service with a very long name bla bla bla",
            serviceUrl: "https://example.com",
            logo: nil,
            username: "usernameverylongverylongtextindeed",
            email: "john.doe@example.com",
            password: "securepassword123",
            notes: "Sample notes",
            passkey: nil,
            createdAt: Date(),
            updatedAt: Date()
        ),
        action: {}
    )
}
