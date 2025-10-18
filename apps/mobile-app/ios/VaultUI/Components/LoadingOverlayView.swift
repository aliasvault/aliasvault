import SwiftUI

/// Loading overlay component with AliasVault branding
public struct LoadingOverlayView: View {
    let message: String

    @Environment(\.colorScheme) private var colorScheme
    @State private var animatingDots: [Bool] = [false, false, false, false]
    @State private var textDots = ""
    @State private var timer: Timer?

    public init(message: String) {
        self.message = message
    }

    public var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 0) {
                // AliasVault logo animation - four pulsing dots
                HStack(spacing: 10) {
                    ForEach(0..<4) { index in
                        Circle()
                            .fill(ColorConstants.Light.tertiary)
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
                        .fill(colorScheme == .dark ? Color.clear : Color.white)
                        .overlay(
                            RoundedRectangle(cornerRadius: 20)
                                .stroke(ColorConstants.Light.tertiary, lineWidth: 5)
                        )
                        .shadow(color: Color.black.opacity(0.05), radius: 2, x: 0, y: 1)
                )

                // Loading message with animated dots
                if !message.isEmpty {
                    Text(message + textDots)
                        .font(.body)
                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                        .padding(.top, 16)
                }
            }
            .padding(20)

            Spacer()
        }
        .onAppear {
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
        .onDisappear {
            timer?.invalidate()
            timer = nil
        }
    }
}
