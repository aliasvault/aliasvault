import SwiftUI

/// Loading view shown during quick unlock (biometric authentication)
public struct QuickUnlockLoadingView: View {
    @Environment(\.colorScheme) private var colorScheme
    
    private let locBundle = Bundle.vaultUI

    public init() {}

    public var body: some View {
        ZStack {
            // Background
            Color(colorScheme == .dark ? ColorConstants.Dark.background : ColorConstants.Light.background)
                .ignoresSafeArea()

            // Loading overlay
            LoadingOverlayView(message: String(localized: "retrieving_credential", bundle: locBundle))
        }
    }
}

#Preview("Light Mode") {
    QuickUnlockLoadingView()
        .preferredColorScheme(.light)
}

#Preview("Dark Mode") {
    QuickUnlockLoadingView()
        .preferredColorScheme(.dark)
}
