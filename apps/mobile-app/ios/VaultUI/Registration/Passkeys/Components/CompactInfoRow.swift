import SwiftUI

/// Info row component for displaying read-only information
struct InfoRow: View {
    let label: String
    let value: String
    let icon: String

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .foregroundColor(ColorConstants.Light.primary)
                .font(.caption)
                .frame(width: 16)

            Text(label + ":")
                .font(.caption)
                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)

            Text(value)
                .font(.caption)
                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)

            Spacer()
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
    }
}
