import SwiftUI
import UIKit
import VaultStoreKit
import VaultUI

/// Coordinator view that handles the unlock flow before showing the actual autofill/passkey content
/// This view decides whether to show PIN unlock, biometric unlock, or directly show the content
struct UnlockCoordinatorView: View {
    @StateObject private var coordinator: UnlockCoordinator

    init(
        vaultStore: VaultStore,
        onUnlocked: @escaping () -> Void,
        onCancel: @escaping () -> Void
    ) {
        _coordinator = StateObject(wrappedValue: UnlockCoordinator(
            vaultStore: vaultStore,
            onUnlocked: onUnlocked,
            onCancel: onCancel
        ))
    }

    var body: some View {
        Group {
            if let pinViewModel = coordinator.pinViewModel {
                // Show PIN unlock view
                PinUnlockView(viewModel: pinViewModel)
            } else {
                // Show branded loading view while biometric unlock is in progress
                BrandedLoadingView(message: nil, showLoadingAnimation: false)
            }
        }
        .onAppear {
            coordinator.startUnlockFlow()
        }
    }
}

/// Coordinator that manages the unlock flow logic
@MainActor
class UnlockCoordinator: ObservableObject {
    @Published var pinViewModel: PinUnlockViewModel?

    let vaultStore: VaultStore
    private let onUnlocked: () -> Void
    private let onCancel: () -> Void

    init(
        vaultStore: VaultStore,
        onUnlocked: @escaping () -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.vaultStore = vaultStore
        self.onUnlocked = onUnlocked
        self.onCancel = onCancel
    }

    func startUnlockFlow() {
        // Check which auth methods are enabled
        // Priority: Biometric -> PIN -> Cancel
        // Biometrics takes priority, PIN serves as fallback if biometrics fails or is unavailable.
        let pinEnabled = vaultStore.isPinEnabled()
        let biometricEnabled = vaultStore.isBiometricAuthEnabled()

        if biometricEnabled {
            // Biometric is enabled - attempt biometric unlock first
            Task {
                await attemptBiometricUnlock()
            }
        } else if pinEnabled {
            // Only PIN is enabled - show PIN unlock view
            createPinViewModel()
        } else {
            // No auth method enabled - this shouldn't happen, but cancel the request
            cancel()
        }
    }

    private func createPinViewModel() {
        pinViewModel = PinUnlockViewModel(
            pinLength: vaultStore.getPinLength(),
            unlockHandler: { [weak self] pin in
                guard let self = self else { return }

                // Attempt to unlock with PIN
                let encryptionKeyBase64 = try self.vaultStore.unlockWithPin(pin)

                // Store the encryption key in memory
                try self.vaultStore.storeEncryptionKey(base64Key: encryptionKeyBase64)

                // Now unlock the vault with the key in memory
                try self.vaultStore.unlockVault()

                // Success - proceed to the actual autofill/passkey view
                await MainActor.run {
                    self.onUnlocked()
                }
            },
            cancelHandler: { [weak self] in
                // User cancelled or PIN was disabled
                // Just cancel - let the system handle the fallback
                self?.cancel()
            }
        )
    }

    func cancel() {
        onCancel()
    }

    private func attemptBiometricUnlock() async {
        // Trigger Face ID immediately without showing loading spinner
        // This prevents any UI freeze or jarring animation
        do {
            // Attempt to unlock with biometric
            try vaultStore.unlockVault()

            // Success - proceed to the actual autofill/passkey view
            onUnlocked()
        } catch {
            print("Biometric unlock failed: \(error)")

            // If biometric fails, check if PIN is available as fallback
            if vaultStore.isPinEnabled() {
                createPinViewModel()
            } else {
                // No fallback available - cancel
                cancel()
            }
        }
    }
}

/// UIHostingController wrapper for the UnlockCoordinatorView
class UnlockCoordinatorViewController: UIHostingController<UnlockCoordinatorView> {
    init(
        vaultStore: VaultStore,
        onUnlocked: @escaping () -> Void,
        onCancel: @escaping () -> Void
    ) {
        let coordinatorView = UnlockCoordinatorView(
            vaultStore: vaultStore,
            onUnlocked: onUnlocked,
            onCancel: onCancel
        )
        super.init(rootView: coordinatorView)
    }

    @MainActor required dynamic init?(coder aDecoder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}
