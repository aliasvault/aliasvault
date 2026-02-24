import Foundation
import SwiftUI

private let locBundle = Bundle.vaultUI

/// ViewModel for password unlock
@MainActor
public class PasswordUnlockViewModel: ObservableObject {
    @Published public var password: String = ""
    @Published public var error: String?
    @Published public var isProcessing: Bool = false

    public let customTitle: String?
    public let customSubtitle: String?

    private let unlockHandler: (String) async throws -> Void
    private let cancelHandler: () -> Void

    public init(
        customTitle: String?,
        customSubtitle: String?,
        unlockHandler: @escaping (String) async throws -> Void,
        cancelHandler: @escaping () -> Void
    ) {
        self.customTitle = customTitle
        self.customSubtitle = customSubtitle
        self.unlockHandler = unlockHandler
        self.cancelHandler = cancelHandler
    }

    public func unlock() async {
        guard !password.isEmpty else { return }
        guard !isProcessing else { return }

        isProcessing = true
        error = nil

        do {
            try await unlockHandler(password)
        } catch {
            // Show error and clear password
            self.error = String(localized: "incorrect_password", bundle: locBundle)
            self.password = ""
            self.isProcessing = false
        }
    }

    public func cancel() {
        cancelHandler()
    }
}
