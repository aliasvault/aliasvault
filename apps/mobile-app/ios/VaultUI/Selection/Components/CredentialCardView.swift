import SwiftUI
import VaultModels
import VaultUtils

private let locBundle = Bundle.vaultUI

/// Autofill credential card view
public struct AutofillCredentialCard: View {
    let credential: AutofillCredential
    let action: () -> Void
    let onCopy: () -> Void
    @Environment(\.colorScheme) private var colorScheme
    @State private var showCopyToast = false
    @State private var copyToastMessage = ""

    public init(credential: AutofillCredential, action: @escaping () -> Void, onCopy: @escaping () -> Void) {
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
            if let username = credential.username, !username.isEmpty {
                Button(action: {
                    UIPasteboard.general.string = username
                    copyToastMessage = String(localized: "username_copied", bundle: locBundle)
                    showCopyToast = true
                    // Delay for 1 second before calling onCopy which dismisses the view
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        onCopy()
                    }
                }, label: {
                    Label(String(localized: "copy_username", bundle: locBundle), systemImage: "person")
                })
            }

            if let password = credential.password, !password.isEmpty {
                Button(action: {
                    UIPasteboard.general.string = password
                    copyToastMessage = String(localized: "password_copied", bundle: locBundle)
                    showCopyToast = true
                    // Delay for 1 second before calling onCopy which dismisses the view
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        onCopy()
                    }
                }, label: {
                    Label(String(localized: "copy_password", bundle: locBundle), systemImage: "key")
                })
            }

            if let email = credential.email, !email.isEmpty {
                Button(action: {
                    UIPasteboard.general.string = email
                    copyToastMessage = String(localized: "email_copied", bundle: locBundle)
                    showCopyToast = true
                    // Delay for 1 second before calling onCopy which dismisses the view
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        onCopy()
                    }
                }, label: {
                    Label(String(localized: "copy_email", bundle: locBundle), systemImage: "envelope")
                })
            }

            if (credential.username != nil && !credential.username!.isEmpty) ||
               (credential.password != nil && !credential.password!.isEmpty) ||
               (credential.email != nil && !credential.email!.isEmpty) {
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
        .overlay(
            Group {
                if showCopyToast {
                    VStack {
                        Spacer()
                        Text(copyToastMessage)
                            .padding()
                            .background(Color.black.opacity(0.7))
                            .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
                            .cornerRadius(8)
                            .padding(.bottom, 20)
                    }
                    .transition(.opacity)
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            withAnimation {
                                showCopyToast = false
                            }
                        }
                    }
                }
            }
        )
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
        action: {},
        onCopy: {}
    )
}
