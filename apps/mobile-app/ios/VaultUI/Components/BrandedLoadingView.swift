import SwiftUI
import UIKit

/// A reusable branded loading/placeholder view with the AliasVault logo.
/// The logo is positioned in the upper portion of the screen to avoid overlap with Face ID prompts.
/// Supports both light and dark mode automatically.
public struct BrandedLoadingView: View {
    /// Optional loading message to display below the logo
    let message: String?

    /// Whether to show the animated loading dots
    let showLoadingAnimation: Bool

    @Environment(\.colorScheme) private var colorScheme
    @State private var animatingDots: [Bool] = [false, false, false, false]
    @State private var textDots = ""
    @State private var timer: Timer?

    /// Creates a branded loading view with optional message and loading animation
    /// - Parameters:
    ///   - message: Optional message to display below the logo
    ///   - showLoadingAnimation: Whether to show the animated loading dots (default: true)
    public init(message: String? = nil, showLoadingAnimation: Bool = true) {
        self.message = message
        self.showLoadingAnimation = showLoadingAnimation
    }

    /// Determine the effective color scheme, falling back to UIKit if SwiftUI environment is unavailable
    private var effectiveColorScheme: ColorScheme {
        // Use UIKit's trait collection as fallback since extension contexts may not
        // properly propagate the SwiftUI colorScheme environment
        let uiStyle = UITraitCollection.current.userInterfaceStyle
        return uiStyle == .dark ? .dark : .light
    }

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: effectiveColorScheme)
    }

    public var body: some View {
        GeometryReader { geometry in
            ZStack {
                colors.background
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Position content at 15% from top to avoid Face ID prompt obstruction
                    Spacer()
                        .frame(height: geometry.size.height * 0.15)

                    VStack(spacing: 16) {
                        // AliasVault logo
                        Image("Logo", bundle: .vaultUI)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 100, height: 100)

                        // Loading animation - four pulsing dots
                        if showLoadingAnimation {
                            HStack(spacing: 10) {
                                ForEach(0..<4) { index in
                                    Circle()
                                        .fill(colors.tertiary)
                                        .frame(width: 8, height: 8)
                                        .opacity(animatingDots[index] ? 1.0 : 0.3)
                                        .animation(
                                            Animation.easeInOut(duration: 0.7)
                                                .repeatForever(autoreverses: true)
                                                .delay(Double(index) * 0.2),
                                            value: animatingDots[index]
                                        )
                                }
                            }
                            .padding(12)
                            .padding(.horizontal, 12)
                            .background(
                                RoundedRectangle(cornerRadius: 20)
                                    .fill(effectiveColorScheme == .dark ? Color.clear : Color.white)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 20)
                                            .stroke(colors.tertiary, lineWidth: 5)
                                    )
                                    .shadow(color: Color.black.opacity(0.05), radius: 2, x: 0, y: 1)
                            )
                        }

                        // Loading message with animated dots
                        if let message = message, !message.isEmpty {
                            Text(message + textDots)
                                .font(.body)
                                .foregroundColor(colors.text)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)
                                .padding(.top, showLoadingAnimation ? 0 : 8)
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity)

                    Spacer()
                }
                .frame(maxWidth: .infinity)
            }
        }
        .onAppear {
            if showLoadingAnimation {
                // Start dot animations
                for index in 0..<4 {
                    animatingDots[index] = true
                }

                // Start text dots animation
                let textTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { _ in
                    if textDots.count >= 3 {
                        textDots = ""
                    } else {
                        textDots += "."
                    }
                }
                timer = textTimer
            }
        }
        .onDisappear {
            timer?.invalidate()
            timer = nil
        }
    }
}
