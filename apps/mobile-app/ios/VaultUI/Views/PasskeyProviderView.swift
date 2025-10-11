import SwiftUI
import AuthenticationServices
import VaultModels

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
                        ProgressView(NSLocalizedString("loading_passkeys", comment: ""))
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

                                    Text(NSLocalizedString("no_passkeys_found", comment: ""))
                                        .font(.headline)
                                        .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.text : ColorConstants.Light.text)

                                    Text(NSLocalizedString("no_passkeys_match", comment: ""))
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
            .navigationTitle(NSLocalizedString("select_passkey", comment: ""))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(NSLocalizedString("cancel", comment: "")) {
                        viewModel.cancel()
                    }
                    .foregroundColor(ColorConstants.Light.primary)
                }
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

// MARK: - Passkey Credential Card

struct PasskeyCredentialCard: View {
    let credential: Credential
    let rpId: String?
    let action: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    // Service logo or icon
                    if let logo = credential.service.logo, !logo.isEmpty,
                       let uiImage = UIImage(data: logo) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 40, height: 40)
                            .cornerRadius(8)
                    } else {
                        Image(systemName: "key.fill")
                            .font(.system(size: 24))
                            .foregroundColor(ColorConstants.Light.primary)
                            .frame(width: 40, height: 40)
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
            errorMessage = NSLocalizedString("passkeys_load_error", comment: "")
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
