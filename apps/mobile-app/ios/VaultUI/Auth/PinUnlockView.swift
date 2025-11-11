import SwiftUI

private let locBundle = Bundle.vaultUI

/// SwiftUI view for PIN unlock in native autofill/passkey flows
/// Similar to the React Native PinNumpad component
public struct PinUnlockView: View {
    @ObservedObject public var viewModel: PinUnlockViewModel
    @Environment(\.colorScheme) var colorScheme

    public init(viewModel: PinUnlockViewModel) {
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
                Text(String(localized: "unlock_vault", bundle: locBundle))
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(theme.text)
                    .padding(.bottom, 8)

                // Subtitle
                Text(String(format: String(localized: "enter_pin_to_unlock_vault", bundle: locBundle)))
                    .font(.system(size: 16))
                    .foregroundColor(theme.text.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 32)

                // PIN dots display
                if let pinLength = viewModel.pinLength {
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
                    // For variable length, show bullet points
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

                Spacer()

                // Numpad
                VStack(spacing: 12) {
                    // Row 1: 1-3
                    HStack(spacing: 12) {
                        ForEach(1...3, id: \.self) { num in
                            NumpadButton(value: "\(num)", theme: theme) {
                                viewModel.addDigit("\(num)")
                            }
                        }
                    }

                    // Row 2: 4-6
                    HStack(spacing: 12) {
                        ForEach(4...6, id: \.self) { num in
                            NumpadButton(value: "\(num)", theme: theme) {
                                viewModel.addDigit("\(num)")
                            }
                        }
                    }

                    // Row 3: 7-9
                    HStack(spacing: 12) {
                        ForEach(7...9, id: \.self) { num in
                            NumpadButton(value: "\(num)", theme: theme) {
                                viewModel.addDigit("\(num)")
                            }
                        }
                    }

                    // Row 4: Empty, 0, Backspace
                    HStack(spacing: 12) {
                        // Empty space
                        Color.clear
                            .frame(height: 60)

                        // 0 button
                        NumpadButton(value: "0", theme: theme) {
                            viewModel.addDigit("0")
                        }

                        // Backspace button
                        NumpadButton(icon: "delete.left", theme: theme) {
                            viewModel.removeDigit()
                        }
                    }
                }
                .padding(.horizontal, 40)
                .padding(.bottom, 40)
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .background(theme.background)
                .blur(radius: viewModel.isUnlocking ? 2 : 0)
                .disabled(viewModel.isUnlocking)

                // Loading overlay
                if viewModel.isUnlocking {
                    ZStack {
                        Color.black.opacity(0.3)
                            .ignoresSafeArea()

                        VStack(spacing: 16) {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: theme.primary))
                                .scaleEffect(1.5)

                            Text(String(localized: "unlocking", bundle: locBundle))
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(theme.text)
                        }
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

/// Numpad button component
struct NumpadButton: View {
    let value: String?
    let icon: String?
    let theme: Theme
    let action: () -> Void

    @State private var isPressed = false

    init(value: String, theme: Theme, action: @escaping () -> Void) {
        self.value = value
        self.icon = nil
        self.theme = theme
        self.action = action
    }

    init(icon: String, theme: Theme, action: @escaping () -> Void) {
        self.value = nil
        self.icon = icon
        self.theme = theme
        self.action = action
    }

    var body: some View {
        Button(action: {
            action()
        }) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(theme.accentBackground)

                // Highlight overlay when pressed
                if isPressed {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(theme.primary.opacity(0.2))
                }

                if let value = value {
                    Text(value)
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(theme.text)
                } else if let icon = icon {
                    Image(systemName: icon)
                        .font(.system(size: 24))
                        .foregroundColor(theme.text)
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

// MARK: - Theme

/// Theme colors matching the React Native app
struct Theme {
    let background: Color
    let text: Color
    let primary: Color
    let accentBackground: Color
    let accentBorder: Color
    let errorBorder: Color

    static let light = Theme(
        background: Color(UIColor.systemBackground),
        text: Color(UIColor.label),
        primary: ColorConstants.Light.primary,
        accentBackground: Color(UIColor.secondarySystemBackground),
        accentBorder: Color(UIColor.separator),
        errorBorder: Color.red
    )

    static let dark = Theme(
        background: Color(UIColor.systemBackground),
        text: Color(UIColor.label),
        primary: ColorConstants.Dark.primary,
        accentBackground: Color(UIColor.secondarySystemBackground),
        accentBorder: Color(UIColor.separator),
        errorBorder: Color.red
    )
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
        // Show loading state
        isUnlocking = true

        do {
            // Call the injected unlock handler with the PIN
            try await unlockHandler(pin)
            // Success - the handler will navigate away or complete the flow
            // Keep loading state active since we're navigating
        } catch let nsError as NSError {
            // Handle unlock errors
            isUnlocking = false
            self.error = nsError.localizedDescription
            shakeAndClear()
        } catch let genericError {
            // Generic error
            isUnlocking = false
            self.error = String(localized: "unlock_failed", bundle: locBundle)
            shakeAndClear()
        }
    }

    private func shakeAndClear() {
        // Clear the PIN after a short delay to show error
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000) // 500ms
            pin = ""
        }
    }
}
