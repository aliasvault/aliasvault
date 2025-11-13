import SwiftUI

/// Loading view shown during quick unlock (biometric authentication)
public struct QuickUnlockLoadingView: View {
    @Environment(\.colorScheme) private var colorScheme

    private let locBundle = Bundle.vaultUI
    private let type: QuickUnlockType

    public init(type: QuickUnlockType) {
        self.type = type
    }

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: colorScheme)
    }

    private var localizedMessage: String {
        switch type {
        case .credential:
            return String(localized: "retrieving_credential", bundle: locBundle)
        case .passkey:
            return String(localized: "retrieving_passkey", bundle: locBundle)
        }
    }

    public var body: some View {
        ZStack {
            // Background
            colors.background
                .ignoresSafeArea()

            // Loading overlay
            LoadingOverlayView(message: localizedMessage)
        }
    }
}

#Preview("Credential - Light Mode") {
    QuickUnlockLoadingView(type: .credential)
        .preferredColorScheme(.light)
}

#Preview("Credential - Dark Mode") {
    QuickUnlockLoadingView(type: .credential)
        .preferredColorScheme(.dark)
}

#Preview("Passkey - Light Mode") {
    QuickUnlockLoadingView(type: .passkey)
        .preferredColorScheme(.light)
}

#Preview("Passkey - Dark Mode") {
    QuickUnlockLoadingView(type: .passkey)
        .preferredColorScheme(.dark)
}
