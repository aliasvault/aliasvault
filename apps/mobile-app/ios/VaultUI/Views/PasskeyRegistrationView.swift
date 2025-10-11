import SwiftUI
import AuthenticationServices

/// Passkey registration view for the autofill extension
public struct PasskeyRegistrationView: View {
    @ObservedObject public var viewModel: PasskeyRegistrationViewModel

    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: PasskeyRegistrationViewModel) {
        self._viewModel = ObservedObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationView {
            ZStack {
                (colorScheme == .dark ? ColorConstants.Dark.background : ColorConstants.Light.background)
                    .ignoresSafeArea()

                // Main content
                ScrollView {
                    VStack(spacing: 24) {
                        // Header
                        VStack(spacing: 12) {
                            Image(systemName: "key.fill")
                                .font(.system(size: 60))
                                .foregroundColor(ColorConstants.Light.primary)
                                .padding(.top, 20)

                            Text(NSLocalizedString("passkey_registration", comment: ""))
                                .font(.title)
                                .fontWeight(.bold)
                                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)

                            Text(NSLocalizedString("passkey_registration_subtitle", comment: ""))
                                .font(.subheadline)
                                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)
                        }
                        .padding(.bottom, 20)

                        // Request details
                        VStack(spacing: 16) {
                            InfoRow(
                                label: "Website",
                                value: viewModel.rpId,
                                icon: "globe"
                            )

                            if let userName = viewModel.userName {
                                InfoRow(
                                    label: "Username",
                                    value: userName,
                                    icon: "person.fill"
                                )
                            }
                        }
                        .padding(.horizontal)

                        // Info box
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "info.circle.fill")
                                .foregroundColor(ColorConstants.Light.primary)
                                .font(.system(size: 20))

                            Text(NSLocalizedString("passkey_registration_info", comment: ""))
                                .font(.footnote)
                                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding()
                        .background(
                            (colorScheme == .dark ? ColorConstants.Dark.accentBackground : ColorConstants.Light.accentBackground)
                                .opacity(0.5)
                        )
                        .cornerRadius(12)
                        .padding(.horizontal)

                        Spacer()

                        // Action buttons
                        VStack(spacing: 12) {
                            Button(action: {
                                viewModel.createPasskey()
                            }, label: {
                                HStack {
                                    Image(systemName: "key.fill")
                                    Text("Create Passkey")
                                }
                                .padding()
                                .frame(maxWidth: .infinity)
                                .background(ColorConstants.Light.primary)
                                .foregroundColor(.white)
                                .cornerRadius(8)
                            })

                            Button(action: {
                                viewModel.cancel()
                            }, label: {
                                Text(NSLocalizedString("cancel", comment: ""))
                                    .padding()
                                    .frame(maxWidth: .infinity)
                                    .foregroundColor(ColorConstants.Light.primary)
                            })
                        }
                        .padding(.horizontal)
                        .padding(.bottom, 20)
                    }
                }
                .opacity(viewModel.isLoading ? 0.3 : 1.0)
                .disabled(viewModel.isLoading)

                // Loading overlay
                if viewModel.isLoading {
                    LoadingOverlayView(message: viewModel.loadingMessage)
                }
            }
            .navigationBarHidden(true)
        }
    }
}

/// Loading overlay component with AliasVault branding
private struct LoadingOverlayView: View {
    let message: String
    @Environment(\.colorScheme) private var colorScheme
    @State private var animatingDots: [Bool] = [false, false, false, false]
    @State private var textDots = ""
    @State private var timer: Timer?

    var body: some View {
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

/// Info row component for displaying passkey registration details
private struct InfoRow: View {
    let label: String
    let value: String
    let icon: String

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(ColorConstants.Light.primary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(.caption)
                    .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)

                Text(value)
                    .font(.body)
                    .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
            }

            Spacer()
        }
        .padding()
        .background(
            (colorScheme == .dark ? ColorConstants.Dark.accentBackground : ColorConstants.Light.accentBackground)
        )
        .cornerRadius(8)
    }
}

/// View model for passkey registration
public class PasskeyRegistrationViewModel: ObservableObject {
    @Published public var requestId: String
    @Published public var rpId: String
    @Published public var origin: String
    @Published public var userName: String?
    @Published public var userDisplayName: String?
    @Published public var isLoading: Bool = false
    @Published public var loadingMessage: String = ""

    private let completionHandler: (Bool) -> Void
    private let cancelHandler: () -> Void

    public init(
        requestId: String,
        rpId: String,
        origin: String,
        userName: String? = nil,
        userDisplayName: String? = nil,
        completionHandler: @escaping (Bool) -> Void,
        cancelHandler: @escaping () -> Void
    ) {
        self.requestId = requestId
        self.rpId = rpId
        self.origin = origin
        self.userName = userName
        self.userDisplayName = userDisplayName
        self.completionHandler = completionHandler
        self.cancelHandler = cancelHandler
    }

    /// Update loading state (called from main thread)
    @MainActor
    public func setLoading(_ loading: Bool, message: String = "") {
        self.isLoading = loading
        self.loadingMessage = message
    }

    public func createPasskey() {
        // Trigger passkey creation in Swift
        print("PasskeyRegistration: Create passkey button clicked")
        completionHandler(true)
    }

    public func openMainApp() {
        // Build the deep link URL
        var urlString = "net.aliasvault.app://credentials/passkey-create"
        let encodedRequestId = requestId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        urlString += "?requestId=\(encodedRequestId)"

        guard let url = URL(string: urlString) else {
            print("PasskeyRegistration: Invalid URL string: \(urlString)")
            completionHandler(false)
            return
        }

        print("PasskeyRegistration: Opening main app with URL: \(url.absoluteString)")

        // Use UIApplication.shared.open from the view model (works in button tap context)
        UIApplication.shared.open(url, options: [:]) { [weak self] success in
            print("PasskeyRegistration: UIApplication.shared.open completed with success=\(success)")

            if success {
                print("PasskeyRegistration: App opened successfully")
            } else {
                print("PasskeyRegistration: Failed to open app")
            }

            self?.completionHandler(success)
        }
    }

    public func cancel() {
        cancelHandler()
    }
}

// MARK: - Previews
#if DEBUG
private struct PasskeyRegistrationView_Previews: PreviewProvider {
    static var previews: some View {
        PasskeyRegistrationView(
            viewModel: PasskeyRegistrationViewModel(
                requestId: "12345678-1234-1234-1234-123456789012",
                rpId: "example.com",
                origin: "https://example.com",
                userName: "user@example.com",
                userDisplayName: "John Doe",
                completionHandler: { success in
                    print("Open app completed with success: \(success)")
                },
                cancelHandler: {
                    print("Cancel tapped")
                }
            )
        )
        .preferredColorScheme(.light)

        PasskeyRegistrationView(
            viewModel: PasskeyRegistrationViewModel(
                requestId: "12345678-1234-1234-1234-123456789012",
                rpId: "example.com",
                origin: "https://example.com",
                userName: nil,
                userDisplayName: nil,
                completionHandler: { success in
                    print("Open app completed with success: \(success)")
                },
                cancelHandler: {
                    print("Cancel tapped")
                }
            )
        )
        .preferredColorScheme(.dark)
    }
}
#endif
