import SwiftUI
import UIKit

private let locBundle = Bundle.vaultUI

/// SwiftUI view for PIN setup in native iOS flows
/// Two-step process: enter new PIN, then confirm it
public struct PinSetupView: View {
    @ObservedObject public var viewModel: PinSetupViewModel
    @Environment(\.colorScheme) var colorScheme

    public init(viewModel: PinSetupViewModel) {
        self._viewModel = ObservedObject(wrappedValue: viewModel)
    }

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: colorScheme)
    }

    public var body: some View {
        GeometryReader { geometry in
            ZStack {
                VStack(spacing: 0) {
                    // Header with cancel button
                    HStack {
                        Spacer()
                        Button(action: {
                            viewModel.cancel()
                        }) {
                            Text(String(localized: "cancel", bundle: locBundle))
                                .foregroundColor(colors.primary)
                        }
                        .padding(.trailing, 20)
                    }
                    .padding(.top, 20)
                    .frame(height: 50)

                    Spacer()

                    // AliasVault Logo
                    Image("Logo", bundle: .vaultUI)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 70, height: 70)
                        .padding(.bottom, 12)

                    // Title
                    Text(viewModel.configuration.title)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundColor(colors.text)
                        .padding(.bottom, 6)

                    // Subtitle
                    Text(viewModel.configuration.subtitle)
                        .font(.system(size: 15))
                        .foregroundColor(colors.text.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 20)

                    // PIN dots display or text based on step
                    if let pinLength = viewModel.configuration.pinLength {
                        // Confirm step: show dots for fixed length
                        HStack(spacing: 12) {
                            ForEach(0..<pinLength, id: \.self) { index in
                                Circle()
                                    .strokeBorder(
                                        index < viewModel.pin.count ? colors.primary : colors.accentBorder,
                                        lineWidth: 2
                                    )
                                    .background(
                                        Circle()
                                            .fill(index < viewModel.pin.count ? colors.primary : Color.clear)
                                    )
                                    .frame(width: 16, height: 16)
                            }
                        }
                        .padding(.bottom, 20)
                    } else {
                        // Enter new step: show bullet points for variable length
                        Text(viewModel.pin.isEmpty ? "----" : String(repeating: "•", count: viewModel.pin.count))
                            .font(.system(size: 38, weight: .semibold))
                            .foregroundColor(colors.text)
                            .kerning(6)
                            .frame(minHeight: 44)
                            .padding(.bottom, 20)
                    }

                    // Error message
                    if let error = viewModel.error {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                            .padding(.bottom, 10)
                            .transition(.opacity)
                    }

                    // Continue/Next button (for enter new step with variable length) - compact version
                    if viewModel.configuration.step == .enterNew && viewModel.configuration.pinLength == nil {
                        Button(action: {
                            Task {
                                await viewModel.submitPin()
                            }
                        }) {
                            Text(String(localized: "next", bundle: locBundle))
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .frame(height: 44)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(viewModel.canSubmit ? colors.primary : colors.primary.opacity(0.5))
                                )
                        }
                        .disabled(!viewModel.canSubmit)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 16)
                    }

                    Spacer()

                    // Numpad
                    PinNumpadView(
                        colorScheme: colorScheme,
                        onDigit: { digit in
                            viewModel.addDigit(digit)
                        },
                        onBackspace: {
                            viewModel.removeDigit()
                        }
                    )
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .background(colors.background)
                .blur(radius: viewModel.isProcessing ? 2 : 0)
                .disabled(viewModel.isProcessing)

                // Loading overlay
                if viewModel.isProcessing {
                    ZStack {
                        Color.black.opacity(0.3)
                            .ignoresSafeArea()

                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: colors.primary))
                            .scaleEffect(1.5)
                            .padding(24)
                            .background(
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(colors.accentBackground)
                            )
                            .shadow(color: Color.black.opacity(0.2), radius: 10, x: 0, y: 4)
                    }
                    .transition(.opacity)
                }
            }
        }
    }
}
