import SwiftUI
import Macaw

private let locBundle = Bundle.vaultUI

/// Search bar view
public struct SearchBarView: View {
    @Binding var text: String
    @Environment(\.colorScheme) private var colorScheme

    public var body: some View {
        ZStack {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
                    .padding(.leading, 8)

                TextField(String(localized: "search_credentials", bundle: locBundle), text: $text)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
                    .padding(.leading, 4)
                    .padding(.trailing, 28) // Space for clear button
            }
            .padding(8)
            .padding(.vertical, 2)
            .background(colorScheme == .dark ? ColorConstants.Dark.accentBackground : ColorConstants.Light.accentBackground)
            .cornerRadius(8)

            if !text.isEmpty {
                HStack {
                    Spacer()
                    Button(action: {
                        text = ""
                    }, label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
                    })
                    .padding(.trailing, 8)
                }
            }
        }
    }
}

#Preview {
    SearchBarView(text: .constant("Example"))
}
