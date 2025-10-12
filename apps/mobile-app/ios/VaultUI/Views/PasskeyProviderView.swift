import SwiftUI
import AuthenticationServices
import VaultModels

private let locBundle = Bundle.vaultUI

/// Passkey provider view for selecting passkeys during authentication
/// TODO: review file
public struct PasskeyProviderView: View {
    @ObservedObject public var viewModel: PasskeyProviderViewModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: PasskeyProviderViewModel) {
        self._viewModel = ObservedObject(wrappedValue: viewModel)
    }

    public var body: some View {
        NavigationView {
            ZStack {
                (colorScheme == .dark ? ColorConstants.Dark.background : ColorConstants.Light.background)
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    SearchBarView(text: $viewModel.searchText)
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                        .background(colorScheme == .dark ? ColorConstants.Dark.background : ColorConstants.Light.background)
                        .onChange(of: viewModel.searchText) { _ in
                            viewModel.filterCredentials()
                        }

                    if viewModel.isLoading {
                        Spacer()
                        ProgressView(String(localized: "loading_passkeys", bundle: locBundle))
                            .progressViewStyle(.circular)
                            .scaleEffect(1.5)
                        Spacer()
                    } else {
                        ScrollView {
                            if viewModel.filteredCredentials.isEmpty {
                                VStack(spacing: 20) {
                                    Image(systemName: "key.fill")
                                        .font(.system(size: 50))
                                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)

                                    Text(String(localized: "no_passkeys_found", bundle: locBundle))
                                        .font(.headline)
                                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)

                                    Text(String(localized: "no_passkeys_match", bundle: locBundle))
                                        .font(.subheadline)
                                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
                                        .multilineTextAlignment(.center)
                                }
                                .padding(.top, 60)
                            } else {
                                LazyVStack(spacing: 8) {
                                    ForEach(viewModel.filteredCredentials, id: \.id) { credential in
                                        PasskeyCredentialCard(
                                            credential: credential,
                                            rpId: viewModel.rpId,
                                            action: {
                                                viewModel.selectCredential(credential)
                                            }
                                        )
                                    }
                                }
                                .padding(.horizontal)
                                .padding(.top, 8)
                            }
                        }
                        .refreshable {
                            await viewModel.loadCredentials()
                        }
                    }
                }
            }
            .navigationTitle(String(localized: "select_passkey", bundle: locBundle))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(String(localized: "cancel", bundle: locBundle)) {
                        viewModel.cancel()
                    }
                    .foregroundColor(ColorConstants.Light.primary)
                }
            }
            .alert(String(localized: "error", bundle: locBundle), isPresented: $viewModel.showError) {
                Button(String(localized: "ok", bundle: locBundle)) {
                    viewModel.dismissError()
                }
            } message: {
                Text(viewModel.errorMessage)
            }
            .task {
                try? await Task.sleep(nanoseconds: 100_000_000)
                await viewModel.loadCredentials()
            }
            .onDisappear {
                viewModel.cancel()
            }
        }
    }
}

// MARK: - Passkey Credential Card

private struct PasskeyCredentialCard: View {
    let credential: Credential
    let rpId: String?
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    // Service logo (favicon) or fallback to passkey icon
                    if let logo = credential.service.logo, !logo.isEmpty,
                       let uiImage = UIImage(data: logo) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 40, height: 40)
                            .cornerRadius(8)
                    } else {
                        // Fallback to passkey icon when favicon is not available
                        ZStack {
                            RoundedRectangle(cornerRadius: 8)
                                .fill(ColorConstants.Light.primary.opacity(0.1))
                                .frame(width: 40, height: 40)
                            Image(systemName: "key.fill")
                                .font(.system(size: 20))
                                .foregroundColor(ColorConstants.Light.primary)
                        }
                        .frame(width: 40, height: 40)
                        .padding()
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text(credential.service.name ?? credential.service.url ?? "Unknown Service")
                            .font(.headline)
                            .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)

                        if let username = credential.username, !username.isEmpty {
                            Text(username)
                                .font(.subheadline)
                                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)
                        } else if let email = credential.alias?.email {
                            Text(email)
                                .font(.subheadline)
                                .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)
                        }

                        // Show passkey count
                        if let passkeys = credential.passkeys, !passkeys.isEmpty {
                            Text("\(passkeys.count) passkey\(passkeys.count > 1 ? "s" : "")")
                                .font(.caption)
                                .foregroundColor(ColorConstants.Light.primary)
                        }
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)
                }
            }
            .padding()
            .background(colorScheme == .dark ? ColorConstants.Dark.accentBackground : ColorConstants.Light.accentBackground)
            .cornerRadius(12)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - ViewModel

public class PasskeyProviderViewModel: ObservableObject {
    @Published var credentials: [Credential] = []
    @Published var filteredCredentials: [Credential] = []
    @Published var searchText = ""
    @Published var isLoading = true
    @Published var showError = false
    @Published var errorMessage = ""
    @Published public var rpId: String?

    private let loader: () async throws -> [Credential]
    private let selectionHandler: (Credential) -> Void
    private let cancelHandler: () -> Void

    public init(
        loader: @escaping () async throws -> [Credential],
        selectionHandler: @escaping (Credential) -> Void,
        cancelHandler: @escaping () -> Void,
        rpId: String? = nil
    ) {
        self.loader = loader
        self.selectionHandler = selectionHandler
        self.cancelHandler = cancelHandler
        self.rpId = rpId
        if let rpId = rpId {
            self.searchText = rpId
        }
    }

    @MainActor
    public func setSearchFilter(_ text: String) {
        self.searchText = text
        self.filterCredentials()
    }

    @MainActor
    func loadCredentials() async {
        isLoading = true
        do {
            credentials = try await loader()
            filterCredentials()
            isLoading = false
        } catch {
            isLoading = false
            errorMessage = String(localized: "passkeys_load_error", bundle: locBundle)
            showError = true
        }
    }

    func filterCredentials() {
        if searchText.isEmpty {
            filteredCredentials = credentials
        } else {
            let lowercasedSearch = searchText.lowercased()
            filteredCredentials = credentials.filter { credential in
                // Filter by service name
                if let serviceName = credential.service.name?.lowercased(),
                   serviceName.contains(lowercasedSearch) {
                    return true
                }
                // Filter by service URL
                if let serviceUrl = credential.service.url?.lowercased(),
                   serviceUrl.contains(lowercasedSearch) {
                    return true
                }
                // Filter by username
                if let username = credential.username?.lowercased(),
                   username.contains(lowercasedSearch) {
                    return true
                }
                // Filter by email
                if let email = credential.alias?.email?.lowercased(),
                   email.contains(lowercasedSearch) {
                    return true
                }
                // Filter by passkey rpId
                if let passkeys = credential.passkeys {
                    return passkeys.contains { passkey in
                        passkey.rpId.lowercased().contains(lowercasedSearch)
                    }
                }
                return false
            }
        }
    }

    func selectCredential(_ credential: Credential) {
        selectionHandler(credential)
    }

    func cancel() {
        cancelHandler()
    }

    func dismissError() {
        showError = false
    }
}

// MARK: - Previews
#if DEBUG
#Preview("Loading State") {
    let viewModel = PasskeyProviderViewModel(
        loader: {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            return []
        },
        selectionHandler: { _ in },
        cancelHandler: { },
        rpId: "example.com"
    )
    return PasskeyProviderView(viewModel: viewModel)
        .preferredColorScheme(.light)
}

#Preview("Light Mode - With Passkeys") {
    let mockPasskey1 = Passkey(
        id: UUID(),
        parentCredentialId: UUID(),
        rpId: "github.com",
        userHandle: Data(),
        userName: "user@example.com",
        publicKey: Data(),
        privateKey: Data(),
        prfKey: nil,
        displayName: "GitHub",
        createdAt: Date(),
        updatedAt: Date(),
        isDeleted: false
    )

    let mockPasskey2 = Passkey(
        id: UUID(),
        parentCredentialId: UUID(),
        rpId: "google.com",
        userHandle: Data(),
        userName: "johndoe@gmail.com",
        publicKey: Data(),
        privateKey: Data(),
        prfKey: nil,
        displayName: "Google",
        createdAt: Date(),
        updatedAt: Date(),
        isDeleted: false
    )

    let mockCredentials = [
        Credential(
            id: UUID(),
            alias: Alias(
                id: UUID(),
                gender: "Not specified",
                firstName: "John",
                lastName: "Doe",
                nickName: "JD",
                birthDate: Date(),
                email: "user@example.com",
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            service: Service(
                id: UUID(),
                name: "GitHub",
                url: "https://github.com",
                logo: nil,
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            username: "johndoe",
            notes: nil,
            password: Password(
                id: UUID(),
                credentialId: UUID(),
                value: "password123",
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            passkeys: [mockPasskey1],
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false
        ),
        Credential(
            id: UUID(),
            alias: Alias(
                id: UUID(),
                gender: "Not specified",
                firstName: "John",
                lastName: "Doe",
                nickName: "JD",
                birthDate: Date(),
                email: "johndoe@gmail.com",
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            service: Service(
                id: UUID(),
                name: "Google",
                url: "https://google.com",
                logo: nil,
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            username: nil,
            notes: nil,
            password: Password(
                id: UUID(),
                credentialId: UUID(),
                value: "password456",
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            passkeys: [mockPasskey2],
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false
        )
    ]

    let viewModel = PasskeyProviderViewModel(
        loader: { mockCredentials },
        selectionHandler: { _ in },
        cancelHandler: { },
        rpId: "github.com"
    )
    viewModel.credentials = mockCredentials
    viewModel.filteredCredentials = mockCredentials
    viewModel.isLoading = false

    return PasskeyProviderView(viewModel: viewModel)
        .preferredColorScheme(.light)
}

#Preview("Dark Mode - With Passkeys") {
    let mockPasskey = Passkey(
        id: UUID(),
        parentCredentialId: UUID(),
        rpId: "github.com",
        userHandle: Data(),
        userName: "user@example.com",
        publicKey: Data(),
        privateKey: Data(),
        prfKey: nil,
        displayName: "GitHub",
        createdAt: Date(),
        updatedAt: Date(),
        isDeleted: false
    )

    let mockCredentials = [
        Credential(
            id: UUID(),
            alias: Alias(
                id: UUID(),
                gender: "Not specified",
                firstName: "John",
                lastName: "Doe",
                nickName: "JD",
                birthDate: Date(),
                email: "user@example.com",
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            service: Service(
                id: UUID(),
                name: "GitHub",
                url: "https://github.com",
                logo: nil,
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            username: "johndoe",
            notes: nil,
            password: nil,
            passkeys: [mockPasskey],
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false
        )
    ]

    let viewModel = PasskeyProviderViewModel(
        loader: { mockCredentials },
        selectionHandler: { _ in },
        cancelHandler: { },
        rpId: "github.com"
    )
    viewModel.credentials = mockCredentials
    viewModel.filteredCredentials = mockCredentials
    viewModel.isLoading = false

    return PasskeyProviderView(viewModel: viewModel)
        .preferredColorScheme(.dark)
}

#Preview("Empty State") {
    let viewModel = PasskeyProviderViewModel(
        loader: { [] },
        selectionHandler: { _ in },
        cancelHandler: { },
        rpId: "example.com"
    )
    viewModel.credentials = []
    viewModel.filteredCredentials = []
    viewModel.isLoading = false

    return PasskeyProviderView(viewModel: viewModel)
        .preferredColorScheme(.light)
}

#Preview("Error State") {
    let viewModel = PasskeyProviderViewModel(
        loader: { [] },
        selectionHandler: { _ in },
        cancelHandler: { },
        rpId: "example.com"
    )
    viewModel.isLoading = false
    viewModel.showError = true
    viewModel.errorMessage = "Failed to load passkeys. Please open the AliasVault app to check for updates."

    return PasskeyProviderView(viewModel: viewModel)
        .preferredColorScheme(.light)
}
#endif
