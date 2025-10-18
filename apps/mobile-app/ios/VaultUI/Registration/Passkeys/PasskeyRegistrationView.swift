import SwiftUI
import AuthenticationServices
import VaultModels

private let locBundle = Bundle.vaultUI

/// Passkey registration view for the autofill extension
public struct PasskeyRegistrationView: View {
    @ObservedObject public var viewModel: PasskeyRegistrationViewModel
    @State private var navigationPath = NavigationPath()

    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: PasskeyRegistrationViewModel) {
        self._viewModel = ObservedObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationStack(path: $navigationPath) {
            ZStack {
                (colorScheme == .dark ? ColorConstants.Dark.background : ColorConstants.Light.background)
                    .ignoresSafeArea()

                // Main content
                ScrollView {
                    VStack(spacing: 24) {
                        // Header
                        PasskeyRegistrationHeader(rpId: viewModel.rpId)

                        // Show selection or form based on existing passkeys
                        if viewModel.existingPasskeys.isEmpty {
                            // Go directly to create form
                            createFormContent
                        } else {
                            // Show selection view
                            selectionContent
                        }
                    }
                }
                .opacity(viewModel.isLoading ? 0.3 : 1.0)
                .disabled(viewModel.isLoading)

                // Loading overlay
                if viewModel.isLoading {
                    LoadingOverlayView(message: viewModel.loadingMessage)
                }
            }
            .navigationBarHidden(viewModel.existingPasskeys.isEmpty)
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: PasskeyNavigationDestination.self) { destination in
                destinationView(for: destination)
            }
        }
    }

    // MARK: - Selection Content (Inline)

    private var selectionContent: some View {
        VStack(spacing: 36) {
            // Create new button
            Button(action: {
                viewModel.handleCreateNew()
                navigationPath.append(PasskeyNavigationDestination.createNew)
            }, label: {
                HStack {
                    Image(systemName: "key.fill")
                    Text(String(localized: "create_new_passkey", bundle: locBundle))
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(ColorConstants.Light.primary)
                .foregroundColor(.white)
                .cornerRadius(8)
            })

            // Existing passkeys list
            VStack(alignment: .leading, spacing: 12) {
                Text(String(localized: "select_passkey_to_replace", bundle: locBundle) + ":")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
                    .padding(.horizontal)

                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(viewModel.existingPasskeys) { passkeyInfo in
                            Button(action: {
                                viewModel.handleSelectReplace(passkeyId: passkeyInfo.id)
                                navigationPath.append(PasskeyNavigationDestination.replace(passkeyInfo.id))
                            }, label: {
                                ExistingPasskeyRow(passkey: passkeyInfo)
                            })
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                }
                .frame(maxHeight: 200)
            }

            Spacer()

            // Cancel button
            Button(action: {
                viewModel.cancel()
            }, label: {
                Text(String(localized: "cancel", bundle: locBundle))
                    .padding()
                    .frame(maxWidth: .infinity)
                    .foregroundColor(ColorConstants.Light.primary)
            })
        }
        .padding(.horizontal)
        .padding(.bottom, 20)
    }

    // MARK: - Create Form Content (Inline for no existing passkeys)

    @FocusState private var isTitleFocused: Bool

    private var isTitleValid: Bool {
        !viewModel.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var createFormContent: some View {
        VStack(spacing: 16) {
            // Informational notice
            VStack(spacing: 8) {
                HStack(spacing: 12) {
                    Image(systemName: "info.circle.fill")
                        .foregroundColor(ColorConstants.Light.primary)
                    Text(String(localized: "create_passkey_explanation", bundle: locBundle))
                        .font(.caption)
                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding()
                .background(ColorConstants.Light.primary.opacity(0.1))
                .cornerRadius(8)
            }
            .padding(.horizontal)

            // Editable title field
            PasskeyTitleInput(title: $viewModel.displayName, focusState: $isTitleFocused)

            // Request details (compact, read-only)
            VStack(spacing: 8) {
                InfoRow(
                    label: String(localized: "website", bundle: locBundle),
                    value: viewModel.rpId,
                    icon: "globe"
                )

                if let userName = viewModel.userName {
                    InfoRow(
                        label: String(localized: "username", bundle: locBundle),
                        value: userName,
                        icon: "person.fill"
                    )
                }
            }
            .padding(.horizontal)

            Spacer()

            // Action buttons
            VStack(spacing: 12) {
                Button(action: {
                    viewModel.createPasskey()
                }, label: {
                    HStack {
                        Image(systemName: "key.fill")
                        Text(String(localized: "create_passkey_button_confirm", bundle: locBundle))
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(isTitleValid ? ColorConstants.Light.primary : Color.gray)
                    .foregroundColor(.white)
                    .cornerRadius(8)
                })
                .disabled(!isTitleValid)

                Button(action: {
                    viewModel.cancel()
                }, label: {
                    Text(String(localized: "cancel", bundle: locBundle))
                        .padding()
                        .frame(maxWidth: .infinity)
                        .foregroundColor(ColorConstants.Light.primary)
                })
            }
            .padding(.horizontal)
            .padding(.bottom, 20)
        }
        .onAppear {
            // Auto-focus when appearing
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                isTitleFocused = true
            }
        }
    }

    // MARK: - Navigation Destination

    @ViewBuilder
    private func destinationView(for destination: PasskeyNavigationDestination) -> some View {
        switch destination {
        case .createNew:
            PasskeyFormView(
                viewModel: viewModel,
                isReplaceMode: false,
                replacingPasskeyId: nil
            )
        case .replace(let passkeyId):
            PasskeyFormView(
                viewModel: viewModel,
                isReplaceMode: true,
                replacingPasskeyId: passkeyId
            )
        }
    }
}

/// View model for passkey registration
public class PasskeyRegistrationViewModel: ObservableObject {
    @Published public var requestId: String
    @Published public var rpId: String
    @Published public var origin: String
    @Published public var userName: String?
    @Published public var userDisplayName: String?
    @Published public var displayName: String  // Editable title that defaults to rpId
    @Published public var isLoading: Bool = false
    @Published public var loadingMessage: String = ""
    @Published public var existingPasskeys: [PasskeyWithCredentialInfo] = []
    @Published public var selectedPasskeyToReplace: UUID?

    private let completionHandler: (Bool) -> Void
    private let cancelHandler: () -> Void

    public init(
        requestId: String,
        rpId: String,
        origin: String,
        userName: String? = nil,
        userDisplayName: String? = nil,
        existingPasskeys: [PasskeyWithCredentialInfo] = [],
        completionHandler: @escaping (Bool) -> Void,
        cancelHandler: @escaping () -> Void
    ) {
        self.requestId = requestId
        self.rpId = rpId
        self.origin = origin
        self.userName = userName
        self.userDisplayName = userDisplayName
        // Initialize displayName to rpId by default
        self.displayName = rpId
        self.existingPasskeys = existingPasskeys
        self.completionHandler = completionHandler
        self.cancelHandler = cancelHandler
    }

    /// Update loading state (called from main thread)
    @MainActor
    public func setLoading(_ loading: Bool, message: String = "") {
        self.isLoading = loading
        self.loadingMessage = message
    }

    public func handleCreateNew() {
        selectedPasskeyToReplace = nil
        displayName = rpId
    }

    public func handleSelectReplace(passkeyId: UUID) {
        selectedPasskeyToReplace = passkeyId
        // Pre-fill display name with the existing passkey's name
        if let passkey = existingPasskeys.first(where: { $0.id == passkeyId }) {
            displayName = passkey.displayName
        }
    }

    public func createPasskey() {
        // Validate title is not empty
        let trimmedTitle = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            print("PasskeyRegistration: Cannot create passkey with empty title")
            return
        }

        // Trigger passkey creation in Swift
        completionHandler(true)
    }

    public func cancel() {
        cancelHandler()
    }
}

// MARK: - Previews
#if DEBUG
#Preview("Light Mode - No Existing Passkeys") {
    PasskeyRegistrationView(
        viewModel: PasskeyRegistrationViewModel(
            requestId: "12345678-1234-1234-1234-123456789012",
            rpId: "example.com",
            origin: "https://example.com",
            userName: "user@example.com",
            userDisplayName: "John Doe",
            existingPasskeys: [],
            completionHandler: { success in
                print("Create completed with success: \(success)")
            },
            cancelHandler: {
                print("Cancel tapped")
            }
        )
    )
    .preferredColorScheme(.light)
    .environment(\.locale, Locale(identifier: "en"))
}

#Preview("Dark Mode - With Existing Passkeys") {
    PasskeyRegistrationView(
        viewModel: PasskeyRegistrationViewModel(
            requestId: "12345678-1234-1234-1234-123456789012",
            rpId: "example.com",
            origin: "https://example.com",
            userName: "user@example.com",
            userDisplayName: "John Doe",
            existingPasskeys: [
                PasskeyWithCredentialInfo(
                    id: UUID(),
                    displayName: "My Example Passkey",
                    serviceName: "Example Service",
                    username: "user@example.com",
                    rpId: "example.com",
                    userId: nil
                ),
                PasskeyWithCredentialInfo(
                    id: UUID(),
                    displayName: "Work Account",
                    serviceName: "Example Service",
                    username: "user@example.com",
                    rpId: "example.com",
                    userId: nil
                )
            ],
            completionHandler: { success in
                print("Create completed with success: \(success)")
            },
            cancelHandler: {
                print("Cancel tapped")
            }
        )
    )
    .preferredColorScheme(.dark)
    .environment(\.locale, Locale(identifier: "en"))
}

#Preview("Loading State") {
    let viewModel = PasskeyRegistrationViewModel(
        requestId: "12345678-1234-1234-1234-123456789012",
        rpId: "example.com",
        origin: "https://example.com",
        userName: "user@example.com",
        userDisplayName: "John Doe",
        existingPasskeys: [],
        completionHandler: { _ in },
        cancelHandler: { }
    )
    viewModel.isLoading = true
    viewModel.loadingMessage = "Creating passkey"
    return PasskeyRegistrationView(viewModel: viewModel)
        .preferredColorScheme(.light)
        .environment(\.locale, Locale(identifier: "en"))
}
#endif
