import SwiftUI
import AuthenticationServices
import VaultModels

private let locBundle = Bundle.vaultUI

/// Credential provider view
public struct CredentialProviderView: View {
    @ObservedObject public var viewModel: CredentialProviderViewModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: CredentialProviderViewModel) {
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
                        ProgressView(String(localized: "loading_credentials", bundle: locBundle))
                            .progressViewStyle(.circular)
                            .scaleEffect(1.5)
                        Spacer()
                    } else {
                        ScrollView {
                            if viewModel.filteredCredentials.isEmpty {
                                VStack(spacing: 20) {
                                    Image(systemName: "magnifyingglass")
                                        .font(.system(size: 50))
                                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)

                                    Text(String(localized: "no_credentials_found", bundle: locBundle))
                                        .font(.headline)
                                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)

                                    Text(String(localized: "no_credentials_match", bundle: locBundle))
                                        .font(.subheadline)
                                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)
                                        .multilineTextAlignment(.center)

                                    if !viewModel.isChoosingTextToInsert {
                                        VStack(spacing: 12) {
                                            Button(action: {
                                                var urlString = "net.aliasvault.app://credentials/add-edit-page"
                                                if let serviceUrl = viewModel.serviceUrl {
                                                    let encodedUrl = serviceUrl.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                                                    urlString += "?serviceUrl=\(encodedUrl)"
                                                }
                                                if let url = URL(string: urlString) {
                                                    UIApplication.shared.open(url, options: [:], completionHandler: nil)
                                                }
                                            }, label: {
                                                HStack {
                                                    Image(systemName: "plus.circle.fill")
                                                    Text(String(localized: "create_new_credential", bundle: locBundle))
                                                }
                                                .padding()
                                                .frame(maxWidth: .infinity)
                                                .background(ColorConstants.Light.primary)
                                                .foregroundColor(.white)
                                                .cornerRadius(8)
                                            })
                                        }
                                        .padding(.horizontal, 40)
                                    }
                                }
                                .padding(.top, 60)
                            } else {
                                LazyVStack(spacing: 8) {
                                    ForEach(viewModel.filteredCredentials, id: \.service) { credential in
                                        CredentialCardWithSelection(
                                            credential: credential,
                                            isChoosingTextToInsert: viewModel.isChoosingTextToInsert,
                                            onSelect: { username, password in
                                                viewModel.handleSelection(username: username, password: password)
                                            },
                                            onCopy: {
                                                viewModel.cancel()
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
            .navigationTitle(viewModel.isChoosingTextToInsert ? String(localized: "select_text_to_insert", bundle: locBundle) : String(localized: "select_credential", bundle: locBundle))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(String(localized: "cancel", bundle: locBundle)) {
                        viewModel.cancel()
                    }
                    .foregroundColor(ColorConstants.Light.primary)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack {
                        Button(action: {
                            var urlString = "net.aliasvault.app://credentials/add-edit-page"
                            if let serviceUrl = viewModel.serviceUrl {
                                let encodedUrl = serviceUrl.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                                urlString += "?serviceUrl=\(encodedUrl)"
                            }
                            if let url = URL(string: urlString) {
                                UIApplication.shared.open(url, options: [:], completionHandler: nil)
                            }
                        }, label: {
                            Image(systemName: "plus")
                            .foregroundColor(ColorConstants.Light.primary)
                        })
                    }
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

// MARK: - CredentialCardWithSelection

private struct CredentialCardWithSelection: View {
    let credential: Credential
    let isChoosingTextToInsert: Bool
    let onSelect: (String, String) -> Void
    let onCopy: () -> Void

    @State private var showSelectionSheet = false
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        CredentialCard(credential: credential, action: {
            if isChoosingTextToInsert {
                showSelectionSheet = true
            } else {
                // For normal autofill, determine the best identifier and fill immediately
                let username = credential.username?.trimmingCharacters(in: .whitespacesAndNewlines)
                let email = credential.alias?.email?.trimmingCharacters(in: .whitespacesAndNewlines)
                let hasUsername = !(username?.isEmpty ?? true)
                let hasEmail = !(email?.isEmpty ?? true)

                // Prefer username over email if both exist, or use whichever is available
                let identifier: String
                if hasUsername {
                    identifier = username!
                } else if hasEmail {
                    identifier = email!
                } else {
                    identifier = ""
                }

                // Fill both username and password immediately for normal autofill
                onSelect(identifier, credential.password?.value ?? "")
            }
        }, onCopy: onCopy)
        .confirmationDialog(
            String(localized: "select_text_to_insert", bundle: locBundle),
            isPresented: $showSelectionSheet,
            titleVisibility: .visible
        ) {
            if let username = credential.username, !username.isEmpty {
                Button(String(localized: "username_prefix", bundle: locBundle) + username) {
                    onSelect(username, "")
                }
            }

            if let email = credential.alias?.email, !email.isEmpty {
                Button(String(localized: "email_prefix", bundle: locBundle) + email) {
                    onSelect(email, "")
                }
            }

            Button(String(localized: "password", bundle: locBundle)) {
                onSelect(credential.password?.value ?? "", "")
            }

            Button(String(localized: "cancel", bundle: locBundle), role: .cancel) {}
        } message: {
            Text(String(localized: "select_text_to_insert_message", bundle: locBundle))
        }
    }
}

// MARK: - ViewModel

public class CredentialProviderViewModel: ObservableObject {
    @Published var credentials: [Credential] = []
    @Published var filteredCredentials: [Credential] = []
    @Published var searchText = ""
    @Published var isLoading = true
    @Published var showError = false
    @Published var errorMessage = ""
    @Published public var isChoosingTextToInsert = false
    @Published public var serviceUrl: String?

    private let loader: () async throws -> [Credential]
    private let selectionHandler: (String, String) -> Void
    private let cancelHandler: () -> Void

    public init(
        loader: @escaping () async throws -> [Credential],
        selectionHandler: @escaping (String, String) -> Void,
        cancelHandler: @escaping () -> Void,
        serviceUrl: String? = nil
    ) {
        self.loader = loader
        self.selectionHandler = selectionHandler
        self.cancelHandler = cancelHandler
        self.serviceUrl = serviceUrl
        if let url = serviceUrl {
            self.searchText = url
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
            errorMessage = String(localized: "credentials_load_error", bundle: locBundle)
            showError = true
        }
    }

    func filterCredentials() {
        filteredCredentials = CredentialFilter.filterCredentials(credentials, searchText: searchText)
    }

    func handleSelection(username: String, password: String) {
        selectionHandler(username, password)
    }

    func cancel() {
        cancelHandler()
    }

    func dismissError() {
        showError = false
    }
}

// MARK: - Preview Helpers
extension Service {
    static var preview: Service {
        Service(
            id: UUID(),
            name: "Example Service",
            url: "https://example.com",
            logo: nil,
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false
        )
    }
}

extension Password {
    static var preview: Password {
        Password(
            id: UUID(),
            credentialId: UUID(),
            value: "password123",
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false
        )
    }
}

extension Alias {
    static var preview: Alias {
        Alias(
            id: UUID(),
            gender: "Not specified",
            firstName: "John",
            lastName: "Doe",
            nickName: "JD",
            birthDate: Date(),
            email: "john@example.com",
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false
        )
    }
}

extension Credential {
    static var preview: Credential {
        Credential(
            id: UUID(),
            alias: .preview,
            service: .preview,
            username: "johndoe",
            notes: "Sample credential",
            password: .preview,
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false
        )
    }
}

// Preview setup
public class PreviewCredentialProviderViewModel: CredentialProviderViewModel {
    init() {
        let previewCredentials = [
            .preview,
            Credential(
                id: UUID(),
                alias: .preview,
                service: Service(
                    id: UUID(),
                    name: "Another Service",
                    url: "https://another.com",
                    logo: nil,
                    createdAt: Date(),
                    updatedAt: Date(),
                    isDeleted: false
                ),
                username: "anotheruser",
                notes: "Another sample credential",
                password: .preview,
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            )
        ]

        super.init(
            loader: {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                return previewCredentials
            },
            selectionHandler: { _, _ in },
            cancelHandler: {},
            serviceUrl: nil
        )

        credentials = previewCredentials
        filteredCredentials = previewCredentials
        isLoading = false
    }
}

public struct CredentialProviderView_Previews: PreviewProvider {
    static func makePreview(isChoosing: Bool, colorScheme: ColorScheme) -> some View {
        let viewModel = PreviewCredentialProviderViewModel()
        viewModel.isChoosingTextToInsert = isChoosing
        return CredentialProviderView(viewModel: viewModel)
            .environment(\.colorScheme, colorScheme)
    }

    public static var previews: some View {
        Group {
            makePreview(isChoosing: false, colorScheme: .light)
                .previewDisplayName("Light - Normal")
            makePreview(isChoosing: false, colorScheme: .dark)
                .previewDisplayName("Dark - Normal")
            makePreview(isChoosing: true, colorScheme: .light)
                .previewDisplayName("Light - Insert Text Mode")
            makePreview(isChoosing: true, colorScheme: .dark)
                .previewDisplayName("Dark - Insert Text Mode")
        }
    }
}
