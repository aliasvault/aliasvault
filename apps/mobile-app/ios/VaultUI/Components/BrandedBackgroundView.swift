import SwiftUI

/// A lightweight branded background view showing the AliasVault logo.
/// Used during biometric unlock screens (quick return and unlock coordinator)
/// where a fully transparent view would look unfinished.
public struct BrandedBackgroundView: View {
    @Environment(\.colorScheme) private var colorScheme

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: colorScheme)
    }

    public init() {}

    public var body: some View {
        ZStack {
            colors.background
                .ignoresSafeArea()

            GeometryReader { geometry in
                VStack(spacing: 0) {
                    Spacer()
                        .frame(height: geometry.size.height * 0.2)

                    // AliasVault logo
                    Image("Logo", bundle: .vaultUI)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 120, height: 120)

                    Spacer()
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}

#Preview("Light") {
    BrandedBackgroundView()
        .preferredColorScheme(.light)
}

#Preview("Dark") {
    BrandedBackgroundView()
        .preferredColorScheme(.dark)
}
