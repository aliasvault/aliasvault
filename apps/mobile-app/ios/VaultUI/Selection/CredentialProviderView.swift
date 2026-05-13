import SwiftUI
import AuthenticationServices
import VaultModels
import VaultUtils

private let locBundle = Bundle.vaultUI

/// Credential provider view
public struct CredentialProviderView: View {
    @ObservedObject public var viewModel: CredentialProviderViewModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var toastMessage: String?

    public init(viewModel: CredentialProviderViewModel) {
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
                        ProgressView(String(localized: "loading_items", bundle: locBundle))
                            .progressViewStyle(.circular)
                            .scaleEffect(1.5)
                        Spacer()
                    } else {
                        ScrollView {
                            if viewModel.filteredCredentials.isEmpty {
                                VStack(spacing: 20) {
                                    Image(systemName: "magnifyingglass")
                                        .font(.system(size: 50))
                                        .foregroundColor(colors.text)

                                    Text(String(localized: "no_items_found", bundle: locBundle))
                                        .font(.headline)
                                        .foregroundColor(colors.text)

                                    Text(String(localized: "no_items_match", bundle: locBundle))
                                        .font(.subheadline)
                                        .foregroundColor(colors.text)
                                        .multilineTextAlignment(.center)

                                    if !viewModel.isChoosingTextToInsert {
                                        VStack(spacing: 12) {
                                            Button(action: {
                                                openAutofillActionPicker(serviceUrl: viewModel.serviceUrl)
                                            }, label: {
                                                HStack {
                                                    Image(systemName: "plus.circle.fill")
                                                    Text(String(localized: "open_aliasvault", bundle: locBundle))
                                                }
                                                .padding()
                                                .frame(maxWidth: .infinity)
                                                .background(colors.primary)
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
                                    ForEach(viewModel.filteredCredentials, id: \.id) { credential in
                                        AutofillCredentialCardWithSelection(
                                            credential: credential,
                                            isChoosingTextToInsert: viewModel.isChoosingTextToInsert,
                                            onSelect: { username, password in
                                                viewModel.requestSelection(
                                                    credential: credential,
                                                    username: username,
                                                    password: password
                                                )
                                            },
                                            onCopy: presentToast
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
            .navigationTitle(viewModel.isChoosingTextToInsert ? String(localized: "select_text_to_insert", bundle: locBundle) : String(localized: "select_item", bundle: locBundle))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(String(localized: "cancel", bundle: locBundle)) {
                        viewModel.cancel()
                    }
                    .foregroundColor(colors.primary)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack {
                        Button(action: {
                            openAutofillActionPicker(serviceUrl: viewModel.serviceUrl)
                        }, label: {
                            Image(systemName: "plus")
                            .foregroundColor(colors.primary)
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
            .alert(
                String(localized: "link_url_prompt_title", bundle: locBundle),
                isPresented: linkPromptIsPresented,
                presenting: viewModel.pendingLinkSelection
            ) { _ in
                Button(String(localized: "link_url_prompt_link_action", bundle: locBundle)) {
                    viewModel.confirmLinkAndFill()
                }
                Button(String(localized: "link_url_prompt_skip_action", bundle: locBundle)) {
                    viewModel.declineLinkAndFill()
                }
                Button(String(localized: "cancel", bundle: locBundle), role: .cancel) {
                    viewModel.pendingLinkSelection = nil
                }
            } message: { pending in
                Text(linkPromptMessage(for: pending))
            }
            .overlay {
                if viewModel.isLinkingUrl {
                    ZStack {
                        Color.black.opacity(0.4)
                            .ignoresSafeArea()
                        ProgressView(String(localized: "linking_url", bundle: locBundle))
                            .padding(20)
                            .background(colors.background)
                            .cornerRadius(12)
                    }
                }
            }
            .overlay(alignment: .bottom) {
                if let message = toastMessage {
                    CopyToastView(message: message)
                        .padding(.bottom, 24)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.85), value: toastMessage)
            .task(id: toastMessage) {
                guard toastMessage != nil else { return }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                toastMessage = nil
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

    /// Show the global copy-confirmation toast. Each call resets the
    /// auto-dismiss timer via `.task(id: toastMessage)` on the body.
    private func presentToast(_ message: String) {
        toastMessage = message
    }

    /// Two-way binding that maps the optional pendingLinkSelection to a Bool
    /// for SwiftUI's `alert(_:isPresented:presenting:)` modifier. Setting the
    /// bound value to `false` clears the pending selection on the view-model.
    private var linkPromptIsPresented: Binding<Bool> {
        Binding(
            get: { viewModel.pendingLinkSelection != nil },
            set: { newValue in
                if !newValue {
                    viewModel.pendingLinkSelection = nil
                }
            }
        )
    }

    /// Build the alert message, substituting the requesting URL/app and the
    /// chosen credential's name into the localized template.
    private func linkPromptMessage(for pending: PendingLinkSelection) -> String {
        let template = String(localized: "link_url_prompt_message", bundle: locBundle)
        let serviceUrl = viewModel.serviceUrl ?? ""
        let name = pending.credentialName.isEmpty
            ? String(localized: "untitled_credential", bundle: locBundle)
            : pending.credentialName
        return template
            .replacingOccurrences(of: "{{url}}", with: serviceUrl)
            .replacingOccurrences(of: "{{name}}", with: name)
    }
}

/// Open the React Native "what would you like to do?" picker in the main
/// AliasVault app via deep link. Shared by the empty-state CTA and the
/// toolbar "+" button so iOS and Android land in the same flow.
private func openAutofillActionPicker(serviceUrl: String?) {
    var urlString = "aliasvault://items/autofill-open-app"
    if let serviceUrl = serviceUrl,
       let encodedUrl = serviceUrl.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
        urlString += "?itemUrl=\(encodedUrl)"
    }
    if let url = URL(string: urlString) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }
}

// MARK: - AutofillCredentialCardWithSelection

private struct AutofillCredentialCardWithSelection: View {
    let credential: AutofillCredential
    let isChoosingTextToInsert: Bool
    let onSelect: (String, String) -> Void
    let onCopy: (String) -> Void

    @State private var showSelectionSheet = false
    @State private var totpCode: String?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        AutofillCredentialCard(credential: credential, action: {
            if isChoosingTextToInsert {
                // Generate TOTP code if available
                if let secret = credential.totpSecret {
                    totpCode = TotpGenerator.generateCode(secret: secret)
                }
                showSelectionSheet = true
            } else {
                // For normal autofill, use the credential's identifier property
                let identifier = credential.identifier

                // If the credential has a TOTP secret and the user has the
                // copy-on-fill setting enabled (default), put the current
                // TOTP code on the clipboard so they can paste it into the
                // 2FA field after the autofill completes.
                if credential.hasTotp,
                   let secret = credential.totpSecret,
                   AutofillSettings.shouldCopyTotpOnFill,
                   let code = TotpGenerator.generateCode(secret: secret),
                   !code.isEmpty {
                    UIPasteboard.general.string = code
                }

                // Fill both username and password immediately for normal autofill
                onSelect(identifier, credential.password ?? "")
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

            if let email = credential.email, !email.isEmpty {
                Button(String(localized: "email_prefix", bundle: locBundle) + email) {
                    onSelect(email, "")
                }
            }

            Button(String(localized: "password", bundle: locBundle)) {
                onSelect(credential.password ?? "", "")
            }

            if let code = totpCode, !code.isEmpty {
                Button(String(localized: "totp_code", bundle: locBundle) + ": " + code) {
                    onSelect(code, "")
                }
            }

            Button(String(localized: "cancel", bundle: locBundle), role: .cancel) {}
        } message: {
            Text(String(localized: "select_text_to_insert_message", bundle: locBundle))
        }
    }
}

// MARK: - ViewModel

/// State for the "do you want to link this URL/app to the credential?" alert.
/// Held on the view-model while the alert is visible.
public struct PendingLinkSelection {
    public let credentialId: UUID
    public let credentialName: String
    public let username: String
    public let password: String
}

public class CredentialProviderViewModel: ObservableObject {
    @Published var credentials: [AutofillCredential] = []
    @Published var filteredCredentials: [AutofillCredential] = []
    @Published var searchText = ""
    @Published var isLoading = true
    @Published var showError = false
    @Published var errorMessage = ""
    @Published public var isChoosingTextToInsert = false
    @Published public var serviceUrl: String?
    @Published public var pendingLinkSelection: PendingLinkSelection?
    @Published public var isLinkingUrl = false

    private let loader: () async throws -> [AutofillCredential]
    private let selectionHandler: (String, String) -> Void
    private let cancelHandler: () -> Void

    /// Optional async handler that, given an item ID and the requesting service URL,
    /// appends the URL to that item's `login.url` field and syncs the vault.
    /// When nil, the link-prompt flow is disabled and selection always falls through
    /// directly to `selectionHandler`.
    private let urlLinker: ((UUID, String) async -> Void)?

    public init(
        loader: @escaping () async throws -> [AutofillCredential],
        selectionHandler: @escaping (String, String) -> Void,
        cancelHandler: @escaping () -> Void,
        serviceUrl: String? = nil,
        urlLinker: ((UUID, String) async -> Void)? = nil
    ) {
        self.loader = loader
        self.selectionHandler = selectionHandler
        self.cancelHandler = cancelHandler
        self.serviceUrl = serviceUrl
        self.urlLinker = urlLinker
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
            errorMessage = String(localized: "items_load_error", bundle: locBundle)
            showError = true
        }
    }

    func filterCredentials() {
        // Use RustItemMatcher when iOS provides a URL (autofill context)
        // Use ItemSearchMatcher when user manually types (free-text search)
        if let serviceUrl = serviceUrl, searchText == serviceUrl {
            // iOS provided URL - use Rust matcher for domain-aware matching
            filteredCredentials = RustItemMatcher.filterCredentials(
                credentials,
                searchText: searchText
            )
        } else {
            // User-typed search - use substring matching across all fields
            filteredCredentials = ItemSearchMatcher.filterCredentials(
                credentials,
                searchText: searchText
            )
        }
    }

    /// Called by the credential card when the user taps a credential to fill.
    /// Decides between filling immediately or first prompting the user to
    /// link the requesting URL/app to this credential's URL list.
    @MainActor
    func requestSelection(credential: AutofillCredential, username: String, password: String) {
        // Skip the link-prompt flow when we don't have everything we need
        // (no service URL, no linker injected, or in text-insertion mode).
        guard !isChoosingTextToInsert,
              let serviceUrl = serviceUrl,
              !serviceUrl.isEmpty,
              urlLinker != nil else {
            selectionHandler(username, password)
            return
        }

        // If the requesting URL is already on this credential, we don't need to prompt again.
        // Compare on host only (subdomain + domain) so trailing slashes, paths,
        // query strings, fragments, `www.`, and `http`/`https` differences don't
        // cause us to propose linking a duplicate URL.
        let serviceKey = AutofillUrlNormalizer.comparisonKey(serviceUrl)
        let alreadyLinked = !serviceKey.isEmpty && credential.serviceUrls.contains { existing in
            AutofillUrlNormalizer.comparisonKey(existing) == serviceKey
        }
        if alreadyLinked {
            selectionHandler(username, password)
            return
        }

        pendingLinkSelection = PendingLinkSelection(
            credentialId: credential.id,
            credentialName: credential.serviceName ?? "",
            username: username,
            password: password
        )
    }

    /// User confirmed linking. Append the URL locally + sync, then complete fill.
    @MainActor
    func confirmLinkAndFill() {
        guard let pending = pendingLinkSelection,
              let serviceUrl = serviceUrl,
              let urlLinker = urlLinker else {
            pendingLinkSelection = nil
            return
        }
        pendingLinkSelection = nil
        isLinkingUrl = true

        Task { @MainActor in
            await urlLinker(pending.credentialId, serviceUrl)
            isLinkingUrl = false
            selectionHandler(pending.username, pending.password)
        }
    }

    /// User declined linking. Just complete the fill as-is.
    @MainActor
    func declineLinkAndFill() {
        guard let pending = pendingLinkSelection else {
            return
        }
        pendingLinkSelection = nil
        selectionHandler(pending.username, pending.password)
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
extension AutofillCredential {
    static var preview: AutofillCredential {
        AutofillCredential(
            id: UUID(),
            serviceName: "Example Service",
            serviceUrl: "https://example.com",
            logo: nil,
            username: "johndoe",
            email: "john@example.com",
            password: "password123",
            notes: "Sample credential",
            passkey: nil,
            createdAt: Date(),
            updatedAt: Date()
        )
    }
}

// Preview setup
public class PreviewCredentialProviderViewModel: CredentialProviderViewModel {
    init() {
        let previewCredentials: [AutofillCredential] = [
            .preview,
            AutofillCredential(
                id: UUID(),
                serviceName: "Another Service",
                serviceUrl: "https://another.com",
                logo: nil,
                username: "anotheruser",
                email: "another@example.com",
                password: "password456",
                notes: "Another sample credential",
                passkey: nil,
                createdAt: Date(),
                updatedAt: Date()
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
