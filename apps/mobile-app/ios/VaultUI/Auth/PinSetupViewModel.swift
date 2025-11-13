import Foundation
import SwiftUI
import UIKit

private let locBundle = Bundle.vaultUI

/// Configuration for PIN setup flow
public struct PinSetupConfiguration {
    /// Current step in the setup process
    public enum Step {
        case enterNew
        case confirm
    }

    public let step: Step
    public let title: String
    public let subtitle: String
    public let pinLength: Int?  // nil = variable length (4-8 digits)
    public let firstStepPin: String?  // Pin from first step (used in confirm step)

    public init(step: Step, title: String, subtitle: String, pinLength: Int?, firstStepPin: String? = nil) {
        self.step = step
        self.title = title
        self.subtitle = subtitle
        self.pinLength = pinLength
        self.firstStepPin = firstStepPin
    }
}

/// ViewModel for PIN setup flow
@MainActor
public class PinSetupViewModel: ObservableObject {
    @Published public var pin: String = ""
    @Published public var error: String?
    @Published public var isProcessing: Bool = false
    @Published public var configuration: PinSetupConfiguration

    private let setupHandler: (String) async throws -> Void
    private let cancelHandler: () -> Void

    public init(
        setupHandler: @escaping (String) async throws -> Void,
        cancelHandler: @escaping () -> Void
    ) {
        self.setupHandler = setupHandler
        self.cancelHandler = cancelHandler

        // Start with first step
        self.configuration = PinSetupConfiguration(
            step: .enterNew,
            title: String(localized: "pin_setup_title", bundle: locBundle),
            subtitle: String(localized: "pin_setup_subtitle", bundle: locBundle),
            pinLength: nil  // Variable length for first step
        )
    }

    public func addDigit(_ digit: String) {
        // Clear error when user starts typing again
        error = nil

        // Check if we've reached max length
        let maxLength = configuration.pinLength ?? 8  // Max 8 digits in setup mode
        if pin.count >= maxLength {
            return
        }

        pin += digit

        // Auto-submit when PIN reaches expected length (only for confirm step with fixed length)
        if configuration.step == .confirm,
           let expectedLength = configuration.pinLength,
           pin.count == expectedLength {
            // Small delay to show the last dot filled before submitting
            Task {
                try? await Task.sleep(nanoseconds: 100_000_000) // 100ms
                await submitPin()
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

    public func submitPin() async {
        // Validate minimum length for setup mode
        if configuration.step == .enterNew && pin.count < 4 {
            return  // Don't submit until at least 4 digits
        }

        isProcessing = true

        // Give UI time to update
        try? await Task.sleep(nanoseconds: 50_000_000) // 50ms

        switch configuration.step {
        case .enterNew:
            // Move to confirm step
            let pinLength = pin.count
            let firstStepPin = pin

            isProcessing = false

            // Update configuration for confirm step
            configuration = PinSetupConfiguration(
                step: .confirm,
                title: String(localized: "pin_confirm_title", bundle: locBundle),
                subtitle: String(localized: "pin_confirm_subtitle", bundle: locBundle),
                pinLength: pinLength,  // Fix length for confirmation
                firstStepPin: firstStepPin
            )

            // Clear current PIN for confirmation entry
            pin = ""

        case .confirm:
            // Check if PINs match
            guard let firstPin = configuration.firstStepPin else {
                isProcessing = false
                self.error = String(localized: "pin_setup_error", bundle: locBundle)
                triggerErrorFeedback()
                return
            }

            if pin != firstPin {
                // PINs don't match - restart from beginning
                isProcessing = false
                self.error = String(localized: "pin_mismatch", bundle: locBundle)
                triggerErrorFeedback()

                // Wait to let user see the error message
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second

                // Restart from beginning
                configuration = PinSetupConfiguration(
                    step: .enterNew,
                    title: String(localized: "pin_setup_title", bundle: locBundle),
                    subtitle: String(localized: "pin_setup_subtitle", bundle: locBundle),
                    pinLength: nil
                )
                pin = ""
                error = nil
                return
            }

            // PINs match - setup the PIN
            do {
                try await setupHandler(pin)
                // Success - the handler will navigate away or complete the flow
                // Keep loading state active since we're navigating
            } catch {
                // Generic error fallback
                isProcessing = false
                self.error = String(localized: "pin_setup_error", bundle: locBundle)
                triggerErrorFeedback()
                shakeAndClear()
            }
        }
    }

    /// Check if we can submit based on current state
    public var canSubmit: Bool {
        switch configuration.step {
        case .enterNew:
            return pin.count >= 4 && pin.count <= 8
        case .confirm:
            return pin.count == configuration.pinLength
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
