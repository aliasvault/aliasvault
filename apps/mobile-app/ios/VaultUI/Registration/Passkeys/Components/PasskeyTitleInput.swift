import SwiftUI

private let locBundle = Bundle.vaultUI

/// Editable title input field for passkey registration
struct PasskeyTitleInput: View {
    @Binding var title: String
    let focusState: FocusState<Bool>.Binding
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(String(localized: "title", bundle: locBundle))
                .font(.caption)
                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)
                .padding(.horizontal)

            TextField("", text: $title)
                .textFieldStyle(PlainTextFieldStyle())
                .font(.body)
                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
                .padding()
                .background(
                    (colorScheme == .dark ? ColorConstants.Dark.accentBackground : ColorConstants.Light.accentBackground)
                )
                .cornerRadius(8)
                .padding(.horizontal)
                .focused(focusState)
        }
        .padding(.bottom, 8)
    }
}
