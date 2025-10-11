import SwiftUI
import AuthenticationServices
import VaultModels

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
                        ProgressView(NSLocalizedString("loading_credentials", comment: ""))
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

                                    Text(NSLocalizedString("no_credentials_found", comment: ""))
                                        .font(.headline)
                                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)

                                    Text(NSLocalizedString("no_credentials_match", comment: ""))
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
                                                    Text(NSLocalizedString("create_new_credential", comment: ""))
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
                                        CredentialCard(credential: credential, action: {
                                            viewModel.selectCredential(credential)
                                        }, onCopy: {
                                            viewModel.cancel()
                                        })
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
            .navigationTitle(viewModel.isChoosingTextToInsert ? NSLocalizedString("select_text_to_insert", comment: "") : NSLocalizedString("select_credential", comment: ""))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(NSLocalizedString("cancel", comment: "")) {
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
            .actionSheet(isPresented: $viewModel.showSelectionOptions) {
                // Define all text strings
                guard let credential = viewModel.selectedCredential else {
                    return ActionSheet(title: Text(NSLocalizedString("choose_username", comment: "")), message: Text(NSLocalizedString("no_credential_selected", comment: "")), buttons: [.cancel()])
                }

                var buttons: [ActionSheet.Button] = []

                if viewModel.isChoosingTextToInsert {
                    if let username = credential.username, !username.isEmpty {
                        buttons.append(.default(Text(NSLocalizedString("username_prefix", comment: "") + username)) {
                            viewModel.selectUsername()
                        })
                    }

                    if let email = credential.alias?.email, !email.isEmpty {
                        buttons.append(.default(Text(NSLocalizedString("email_prefix", comment: "") + email)) {
                            viewModel.selectEmail()
                        })
                    }

                    buttons.append(.default(Text(NSLocalizedString("password", comment: ""))) {
                        viewModel.selectPassword()
                    })
                } else {
                    if let username = credential.username, !username.isEmpty {
                        buttons.append(.default(Text("\(username)")) {
                            viewModel.selectUsernamePassword()
                        })
                    }

                    if let email = credential.alias?.email, !email.isEmpty {
                        buttons.append(.default(Text("\(email)")) {
                            viewModel.selectEmailPassword()
                        })
                    }
                }

                buttons.append(.cancel())

                return ActionSheet(
                    title: viewModel.isChoosingTextToInsert ? Text(NSLocalizedString("select_text_to_insert", comment: "")) : Text(NSLocalizedString("choose_username", comment: "")),
                    message: viewModel.isChoosingTextToInsert ? Text(NSLocalizedString("select_text_to_insert_message", comment: "")) : Text(NSLocalizedString("choose_username_message", comment: "")),
                    buttons: buttons
                )
            }
            .alert(NSLocalizedString("error", comment: ""), isPresented: $viewModel.showError) {
                Button(NSLocalizedString("ok", comment: "")) {
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

// MARK: - ViewModel

public class CredentialProviderViewModel: ObservableObject {
    @Published var credentials: [Credential] = []
    @Published var filteredCredentials: [Credential] = []
    @Published var searchText = ""
    @Published var isLoading = true
    @Published var showError = false
    @Published var errorMessage = ""
    @Published var showSelectionOptions = false
    @Published var selectedCredential: Credential?
    @Published public var isChoosingTextToInsert = false
    @Published public var serviceUrl: String?

    @Published var newUsername = ""
    @Published var newPassword = ""
    @Published var newService = ""

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
            errorMessage = NSLocalizedString("credentials_load_error", comment: "")
            showError = true
        }
    }

   func filterCredentials() {
        filteredCredentials = CredentialFilter.filterCredentials(credentials, searchText: searchText)
    }


    func selectCredential(_ credential: Credential) {
        selectedCredential = credential

        // If we're in text insertion mode, always show the selection sheet
        if isChoosingTextToInsert {
            showSelectionOptions = true
            return
        }

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
        selectionHandler(identifier, credential.password?.value ?? "")
    }

    func selectUsername() {
        guard let credential = selectedCredential else { return }
        selectionHandler(credential.username ?? "", "")
        showSelectionOptions = false
    }

    func selectEmail() {
        guard let credential = selectedCredential else { return }
        selectionHandler(credential.alias?.email ?? "", "")
        showSelectionOptions = false
    }

    func selectPassword() {
        guard let credential = selectedCredential else { return }
        selectionHandler(credential.password?.value ?? "", "")
        showSelectionOptions = false
    }

    func selectUsernamePassword() {
        guard let credential = selectedCredential else { return }
        selectionHandler(credential.username ?? "", credential.password?.value ?? "")
        showSelectionOptions = false
    }

    func selectEmailPassword() {
        guard let credential = selectedCredential else { return }
        selectionHandler(credential.alias?.email ?? "", credential.password?.value ?? "")
        showSelectionOptions = false
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
    static func makePreview(isChoosing: Bool, showingSelection: Bool, colorScheme: ColorScheme) -> some View {
        let viewModel = PreviewCredentialProviderViewModel()
        viewModel.isChoosingTextToInsert = isChoosing
        if showingSelection {
            viewModel.selectedCredential = .preview
            viewModel.showSelectionOptions = true
        }
        return CredentialProviderView(viewModel: viewModel)
            .environment(\.colorScheme, colorScheme)
    }

    public static var previews: some View {
        Group {
            makePreview(isChoosing: false, showingSelection: false, colorScheme: .light)
                .previewDisplayName("Light - Normal")
            makePreview(isChoosing: false, showingSelection: false, colorScheme: .dark)
                .previewDisplayName("Dark - Normal")
            makePreview(isChoosing: true, showingSelection: false, colorScheme: .light)
                .previewDisplayName("Light - Insert Text Mode")
            makePreview(isChoosing: true, showingSelection: true, colorScheme: .light)
                .previewDisplayName("Light - Insert Text Mode Selection")
            makePreview(isChoosing: false, showingSelection: true, colorScheme: .light)
                .previewDisplayName("Light - Selection Sheet")
        }
    }
}
