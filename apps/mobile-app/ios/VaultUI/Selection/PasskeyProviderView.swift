import SwiftUI
import AuthenticationServices
import VaultModels

private let locBundle = Bundle.vaultUI

/// Passkey provider view for selecting passkeys during authentication
public struct PasskeyProviderView: View {
    @ObservedObject public var viewModel: PasskeyProviderViewModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: PasskeyProviderViewModel) {
        self._viewModel = ObservedObject(wrappedValue: viewModel)
    }

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: colorScheme)
    }

    public var body: some View {
        NavigationView {
            ZStack {
                colors.background
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    SearchBarView(text: $viewModel.searchText)
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                        .background(colors.background)
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
                                        .foregroundColor(colors.text)

                                    Text(String(localized: "no_passkeys_found", bundle: locBundle))
                                        .font(.headline)
                                        .foregroundColor(colors.text)

                                    Text(String(localized: "no_passkeys_match", bundle: locBundle))
                                        .font(.subheadline)
                                        .foregroundColor(colors.text)
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
                    .foregroundColor(colors.primary)
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
    let credential: AutofillCredential
    let rpId: String?
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: colorScheme)
    }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    // Service logo (favicon) or fallback to passkey icon
                    if let logo = credential.logo, !logo.isEmpty,
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
                                .fill(colors.primary.opacity(0.1))
                                .frame(width: 40, height: 40)
                            Image(systemName: "key.fill")
                                .font(.system(size: 20))
                                .foregroundColor(colors.primary)
                        }
                        .frame(width: 40, height: 40)
                        .padding()
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text(credential.serviceName ?? credential.serviceUrl ?? "-")
                            .font(.headline)
                            .foregroundColor(colors.text)

                        let identifier = credential.identifier
                        if !identifier.isEmpty {
                            Text(identifier)
                                .font(.subheadline)
                                .foregroundColor(colors.textMuted)
                        }

                        // Show passkey count
                        if credential.hasPasskeys {
                            Text(String(localized: "passkey", bundle: locBundle))
                                .font(.caption)
                                .foregroundColor(colors.primary)
                        }
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .foregroundColor(colors.textMuted)
                }
            }
            .padding()
            .background(colors.accentBackground)
            .cornerRadius(12)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - ViewModel

public class PasskeyProviderViewModel: ObservableObject {
    @Published var credentials: [AutofillCredential] = []
    @Published var filteredCredentials: [AutofillCredential] = []
    @Published var searchText = ""
    @Published var isLoading = true
    @Published var showError = false
    @Published var errorMessage = ""
    @Published public var rpId: String?

    private let loader: () async throws -> [AutofillCredential]
    private let selectionHandler: (AutofillCredential) -> Void
    private let cancelHandler: () -> Void

    public init(
        loader: @escaping () async throws -> [AutofillCredential],
        selectionHandler: @escaping (AutofillCredential) -> Void,
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
        let lowercasedSearch = searchText.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

        if lowercasedSearch.isEmpty {
            filteredCredentials = credentials
            return
        }

        // Split search term into words for AND search
        let searchWords = lowercasedSearch
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }

        if searchWords.isEmpty {
            filteredCredentials = credentials
            return
        }

        // Filter credentials where ALL search words match (each in at least one field)
        filteredCredentials = credentials.filter { credential in
            // Prepare searchable fields including passkey rpIds
            var searchableFields = [
                credential.serviceName?.lowercased() ?? "",
                credential.serviceUrl?.lowercased() ?? "",
                credential.username?.lowercased() ?? "",
                credential.email?.lowercased() ?? "",
                credential.notes?.lowercased() ?? ""
            ]

            // Add passkey rpIds to searchable fields
            if let passkeys = credential.passkeys {
                searchableFields.append(contentsOf: passkeys.map { $0.rpId.lowercased() })
            }

            // All search words must be found (each in at least one field)
            return searchWords.allSatisfy { word in
                searchableFields.contains { field in
                    field.contains(word)
                }
            }
        }
    }

    func selectCredential(_ credential: AutofillCredential) {
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
        parentItemId: UUID(),
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
        parentItemId: UUID(),
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

    let mockCredentials: [AutofillCredential] = [
        AutofillCredential(
            id: UUID(),
            serviceName: "GitHub",
            serviceUrl: "https://github.com",
            logo: nil,
            username: "johndoe",
            email: "user@example.com",
            password: "password123",
            notes: nil,
            passkeys: [mockPasskey1],
            createdAt: Date(),
            updatedAt: Date()
        ),
        AutofillCredential(
            id: UUID(),
            serviceName: "Google",
            serviceUrl: "https://google.com",
            logo: nil,
            username: nil,
            email: "johndoe@gmail.com",
            password: "password456",
            notes: nil,
            passkeys: [mockPasskey2],
            createdAt: Date(),
            updatedAt: Date()
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
        parentItemId: UUID(),
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

    let mockCredentials: [AutofillCredential] = [
        AutofillCredential(
            id: UUID(),
            serviceName: "GitHub",
            serviceUrl: "https://github.com",
            logo: nil,
            username: "johndoe",
            email: "user@example.com",
            password: nil,
            notes: nil,
            passkeys: [mockPasskey],
            createdAt: Date(),
            updatedAt: Date()
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
