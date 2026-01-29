import SwiftUI
import VaultModels

/// Row displaying an existing passkey that can be selected for replacement
struct ExistingPasskeyRow: View {
    let passkey: PasskeyWithCredentialInfo

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 12) {
            // Passkey icon
            Image(systemName: "key.fill")
                .foregroundColor(ColorConstants.Light.primary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 4) {
                Text(passkey.serviceName ?? passkey.displayName)
                    .font(.body)
                    .fontWeight(.medium)
                    .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
                if let username = passkey.username {
                    Text(username)
                        .font(.caption)
                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)
                .font(.caption)
        }
        .padding()
        .background(
            (colorScheme == .dark ? ColorConstants.Dark.accentBackground : ColorConstants.Light.accentBackground)
        )
        .cornerRadius(8)
    }
}
