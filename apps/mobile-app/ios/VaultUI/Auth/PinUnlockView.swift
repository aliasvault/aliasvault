import SwiftUI
import VaultModels
import UIKit

private let locBundle = Bundle.vaultUI

/// SwiftUI view for PIN unlock in native autofill/passkey flows
/// Similar to the React Native PinNumpad component
public struct PinUnlockView: View {
    @ObservedObject public var viewModel: PinUnlockViewModel
    @Environment(\.colorScheme) var colorScheme

    public init(viewModel: PinUnlockViewModel) {
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
                    .frame(width: 80, height: 80)
                    .padding(.bottom, 20)

                // Title
                Text(String(localized: "unlock_vault", bundle: locBundle))
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(colors.text)
                    .padding(.bottom, 8)

                // Subtitle
                Text(String(format: String(localized: "enter_pin_to_unlock_vault", bundle: locBundle)))
                    .font(.system(size: 16))
                    .foregroundColor(colors.text.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 32)

                // PIN dots display
                if let pinLength = viewModel.pinLength {
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
                    .padding(.bottom, 24)
                } else {
                    // For variable length, show bullet points
                    Text(viewModel.pin.isEmpty ? "----" : String(repeating: "•", count: viewModel.pin.count))
                        .font(.system(size: 42, weight: .semibold))
                        .foregroundColor(colors.text)
                        .kerning(8)
                        .frame(minHeight: 48)
                        .padding(.bottom, 24)
                }

                // Error message
                if let error = viewModel.error {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                        .padding(.bottom, 12)
                        .transition(.opacity)
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
                .blur(radius: viewModel.isUnlocking ? 2 : 0)
                .disabled(viewModel.isUnlocking)

                // Loading overlay
                if viewModel.isUnlocking {
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

/// Numpad button component
struct NumpadButton: View {
    let value: String?
    let icon: String?
    let colorScheme: ColorScheme
    let action: () -> Void

    @State private var isPressed = false

    init(value: String, colorScheme: ColorScheme, action: @escaping () -> Void) {
        self.value = value
        self.icon = nil
        self.colorScheme = colorScheme
        self.action = action
    }

    init(icon: String, colorScheme: ColorScheme, action: @escaping () -> Void) {
        self.value = nil
        self.icon = icon
        self.colorScheme = colorScheme
        self.action = action
    }

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: colorScheme)
    }

    var body: some View {
        Button(action: {
            action()
        }) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(colors.accentBackground)

                // Highlight overlay when pressed
                if isPressed {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(colors.primary.opacity(0.2))
                }

                if let value = value {
                    Text(value)
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(colors.text)
                } else if let icon = icon {
                    Image(systemName: icon)
                        .font(.system(size: 24))
                        .foregroundColor(colors.text)
                }
            }
            .frame(height: 60)
        }
        .buttonStyle(NumpadButtonStyle(isPressed: $isPressed))
    }
}

/// Custom button style for numpad buttons with press animation
struct NumpadButtonStyle: ButtonStyle {
    @Binding var isPressed: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1.0)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { newValue in
                isPressed = newValue
            }
    }
}

// MARK: - ViewModel

/// ViewModel for PIN unlock
@MainActor
public class PinUnlockViewModel: ObservableObject {
    @Published public var pin: String = ""
    @Published public var error: String?
    @Published public var isUnlocking: Bool = false

    public let pinLength: Int?
    private let unlockHandler: (String) async throws -> Void
    private let cancelHandler: () -> Void

    public init(
        pinLength: Int?,
        unlockHandler: @escaping (String) async throws -> Void,
        cancelHandler: @escaping () -> Void
    ) {
        self.pinLength = pinLength
        self.unlockHandler = unlockHandler
        self.cancelHandler = cancelHandler
    }

    public func addDigit(_ digit: String) {
        // Clear error when user starts typing again
        error = nil

        // Add digit to PIN
        if let maxLength = pinLength, pin.count >= maxLength {
            // Don't add more digits if we've reached max length
            return
        }

        pin += digit

        // Auto-submit when PIN reaches expected length
        if let expectedLength = pinLength, pin.count == expectedLength {
            // Small delay to show the last dot filled before attempting unlock
            Task {
                // Wait for the UI to update with the last filled dot
                try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
                await attemptUnlock()
            }
        }
    }

    public func removeDigit() {
        guard !pin.isEmpty else { return }
        pin.removeLast()
        error = nil
    }

    public func cancel() {
        cancelHandler()
    }

    private func attemptUnlock() async {
        // Show loading state immediately before expensive Argon2 computation
        isUnlocking = true

        // Give the UI one more frame to show the loading state
        try? await Task.sleep(nanoseconds: 50_000_000) // 50ms

        do {
            // Call the injected unlock handler with the PIN
            // This will perform Argon2 key derivation which may take 500ms-1s
            try await unlockHandler(pin)
            // Success - the handler will navigate away or complete the flow
            // Keep loading state active since we're navigating
        } catch let pinError as PinUnlockError {
            // Handle PinUnlockError with localized messages
            switch pinError {

            case .locked:
                // PIN locked after too many attempts
                isUnlocking = false
                self.error = String(localized: "pin_locked_max_attempts", bundle: locBundle)
                triggerErrorFeedback()

                // Wait to let user see the error message
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second

                // Clear the error and dismiss
                self.error = nil
                cancelHandler()
                return

            case .incorrectPin(let attemptsRemaining):
                // Incorrect PIN - show attempts remaining
                isUnlocking = false
                self.error = String(localized: "pin_incorrect_attempts_remaining", bundle: locBundle)
                    .replacingOccurrences(of: "%d", with: "\(attemptsRemaining)")
                triggerErrorFeedback()
                shakeAndClear()
            }
        } catch {
            // Generic error fallback
            isUnlocking = false
            self.error = String(localized: "unlock_failed", bundle: locBundle)
            triggerErrorFeedback()
            shakeAndClear()
        }
    }

    private func triggerErrorFeedback() {
        // Trigger haptic feedback for error
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.error)
    }

    private func shakeAndClear() {
        // Clear the PIN after a short delay to show error
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000) // 500ms
            pin = ""
        }
    }
}
