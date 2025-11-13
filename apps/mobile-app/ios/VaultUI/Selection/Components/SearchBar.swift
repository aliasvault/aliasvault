import SwiftUI
import Macaw

private let locBundle = Bundle.vaultUI

/// Search bar view
public struct SearchBarView: View {
    @Binding var text: String
    @Environment(\.colorScheme) private var colorScheme

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: colorScheme)
    }

    public var body: some View {
        ZStack {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(colors.text)
                    .padding(.leading, 8)

                TextField(String(localized: "search_credentials", bundle: locBundle), text: $text)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .foregroundColor(colors.text)
                    .padding(.leading, 4)
                    .padding(.trailing, 28) // Space for clear button
            }
            .padding(8)
            .padding(.vertical, 2)
            .background(colors.accentBackground)
            .cornerRadius(8)

            if !text.isEmpty {
                HStack {
                    Spacer()
                    Button(action: {
                        text = ""
                    }, label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(colors.text)
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
