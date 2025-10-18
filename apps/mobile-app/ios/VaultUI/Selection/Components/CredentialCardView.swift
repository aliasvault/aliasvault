import SwiftUI
import VaultModels
import VaultUtils

/// Credential card view
public struct CredentialCard: View {
    let credential: Credential
    let action: () -> Void
    let onCopy: () -> Void
    @Environment(\.colorScheme) private var colorScheme
    @State private var showCopyToast = false
    @State private var copyToastMessage = ""

    public init(credential: Credential, action: @escaping () -> Void, onCopy: @escaping () -> Void) {
        self.credential = credential
        self.action = action
        self.onCopy = onCopy
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                // Service logo
                ServiceLogoView(logoData: credential.service.logo)
                    .frame(width: 32, height: 32)

                VStack(alignment: .leading, spacing: 4) {
                    Text(truncateText(credential.service.name ?? "Unknown", limit: 26))
                        .font(.headline)
                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)

                    Text(truncateText(CredentialHelpers.usernameOrEmail(credential: credential), limit: 26))
                        .font(.subheadline)
                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.icon : ColorConstants.Light.icon)
            }
            .padding(8)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(colorScheme == .dark ? ColorConstants.Dark.accentBackground : ColorConstants.Light.accentBackground)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(colorScheme == .dark ? ColorConstants.Dark.accentBorder : ColorConstants.Light.accentBorder, lineWidth: 1)
            )
            .cornerRadius(8)
        }
        .contextMenu(menuItems: {
            if let username = credential.username, !username.isEmpty {
                Button(action: {
                    UIPasteboard.general.string = username
                    copyToastMessage = NSLocalizedString("username_copied", comment: "Username copied message")
                    showCopyToast = true
                    // Delay for 1 second before calling onCopy which dismisses the view
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        onCopy()
                    }
                }, label: {
                    Label(NSLocalizedString("copy_username", comment: "Copy username context menu"), systemImage: "person")
                })
            }

            if let password = credential.password?.value, !password.isEmpty {
                Button(action: {
                    UIPasteboard.general.string = password
                    copyToastMessage = NSLocalizedString("password_copied", comment: "Password copied message")
                    showCopyToast = true
                    // Delay for 1 second before calling onCopy which dismisses the view
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        onCopy()
                    }
                }, label: {
                    Label(NSLocalizedString("copy_password", comment: "Copy password context menu"), systemImage: "key")
                })
            }

            if let email = credential.alias?.email, !email.isEmpty {
                Button(action: {
                    UIPasteboard.general.string = email
                    copyToastMessage = NSLocalizedString("email_copied", comment: "Email copied message")
                    showCopyToast = true
                    // Delay for 1 second before calling onCopy which dismisses the view
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        onCopy()
                    }
                }, label: {
                    Label(NSLocalizedString("copy_email", comment: "Copy email context menu"), systemImage: "envelope")
                })
            }

            if (credential.username != nil && !credential.username!.isEmpty) ||
               (credential.password?.value != nil && !credential.password!.value.isEmpty) ||
               (credential.alias?.email != nil && !credential.alias!.email!.isEmpty) {
                Divider()
            }

            Button(action: {
                if let url = URL(string: "net.aliasvault.app://credentials/\(credential.id.uuidString)") {
                    UIApplication.shared.open(url)
                }
            }, label: {
                Label(NSLocalizedString("view_details", comment: "View details context menu"), systemImage: "eye")
            })

            Button(action: {
                if let url = URL(string: "net.aliasvault.app://credentials/add-edit-page?id=\(credential.id.uuidString)") {
                    UIApplication.shared.open(url)
                }
            }, label: {
                Label(NSLocalizedString("edit", comment: "Edit context menu"), systemImage: "pencil")
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
    CredentialCard(
        credential: Credential(
            id: UUID(),
            alias: Alias(
                id: UUID(),
                gender: "Male",
                firstName: "John",
                lastName: "Doe",
                nickName: "Johnny",
                birthDate: Date(),
                email: "john.doe@example.com",
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            service: Service(
                id: UUID(),
                name: "Example Service with a very long name bla bla bla",
                url: "https://example.com",
                logo: nil,
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            username: "usernameverylongverylongtextindeed",
            notes: "Sample notes",
            password: Password(
                id: UUID(),
                credentialId: UUID(),
                value: "securepassword123",
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false
        ),
        action: {},
        onCopy: {}
    )
}
