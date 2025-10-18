import SwiftUI

private let locBundle = Bundle.vaultUI

/// Header component for passkey registration view
struct PasskeyRegistrationHeader: View {
    let rpId: String
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 12) {
            Image("Logo", bundle: Bundle(for: PasskeyRegistrationViewModel.self))
                .resizable()
                .scaledToFit()
                .frame(width: 80, height: 80)
                .padding(.top, 20)

            Text(String(localized: "create_passkey_title", bundle: locBundle))
                .font(.title)
                .fontWeight(.bold)
                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)

            Text(String(localized: "create_passkey_subtitle", bundle: locBundle))
                .font(.subheadline)
                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .padding(.bottom, 20)
    }
}
