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
                                .foregroundColor(theme.primary)
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
                        .frame(width: 80, height: 80)
                        .padding(.bottom, 20)

                    // Title
                    Text(viewModel.configuration.title)
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(theme.text)
                        .padding(.bottom, 8)

                    // Subtitle
                    Text(viewModel.configuration.subtitle)
                        .font(.system(size: 16))
                        .foregroundColor(theme.text.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                        .padding(.bottom, 32)

                    // PIN dots display or text based on step
                    if let pinLength = viewModel.configuration.pinLength {
                        // Confirm step: show dots for fixed length
                        HStack(spacing: 12) {
                            ForEach(0..<pinLength, id: \.self) { index in
                                Circle()
                                    .strokeBorder(
                                        index < viewModel.pin.count ? theme.primary : theme.accentBorder,
                                        lineWidth: 2
                                    )
                                    .background(
                                        Circle()
                                            .fill(index < viewModel.pin.count ? theme.primary : Color.clear)
                                    )
                                    .frame(width: 16, height: 16)
                            }
                        }
                        .padding(.bottom, 24)
                    } else {
                        // Enter new step: show bullet points for variable length
                        Text(viewModel.pin.isEmpty ? "----" : String(repeating: "•", count: viewModel.pin.count))
                            .font(.system(size: 42, weight: .semibold))
                            .foregroundColor(theme.text)
                            .kerning(8)
                            .frame(minHeight: 48)
                            .padding(.bottom, 24)
                    }

                    // Error message
                    if let error = viewModel.error {
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(theme.errorBorder)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                            .padding(.bottom, 12)
                            .transition(.opacity)
                    }

                    // Continue/Confirm button (for enter new step with variable length)
                    if viewModel.configuration.step == .enterNew && viewModel.configuration.pinLength == nil {
                        Button(action: {
                            Task {
                                await viewModel.submitPin()
                            }
                        }) {
                            Text(String(localized: "pin_next", bundle: locBundle))
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(theme.primarySurfaceText)
                                .frame(maxWidth: .infinity)
                                .frame(height: 50)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(viewModel.canSubmit ? theme.primary : theme.primary.opacity(0.5))
                                )
                        }
                        .disabled(!viewModel.canSubmit)
                        .padding(.horizontal, 40)
                        .padding(.bottom, 24)
                    }

                    Spacer()

                    // Numpad
                    PinNumpadView(
                        theme: theme,
                        onDigit: { digit in
                            viewModel.addDigit(digit)
                        },
                        onBackspace: {
                            viewModel.removeDigit()
                        }
                    )
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .background(theme.background)
                .blur(radius: viewModel.isProcessing ? 2 : 0)
                .disabled(viewModel.isProcessing)

                // Loading overlay
                if viewModel.isProcessing {
                    ZStack {
                        Color.black.opacity(0.3)
                            .ignoresSafeArea()

                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: theme.primary))
                            .scaleEffect(1.5)
                            .padding(24)
                            .background(
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(theme.accentBackground)
                            )
                            .shadow(color: Color.black.opacity(0.2), radius: 10, x: 0, y: 4)
                    }
                    .transition(.opacity)
                }
            }
        }
    }

    private var theme: Theme {
        colorScheme == .dark ? Theme.dark : Theme.light
    }
}
