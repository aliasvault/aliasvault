import SwiftUI

private let locBundle = Bundle.vaultUI

/// State of the passkeys/credentials switch shown above the search bar of an embedded picker.
public struct AutofillViewSwitch {
    let showingPasskeys: Binding<Bool>
    let passkeyCount: Int
    let credentialCount: Int
}

/// Segmented control that switches between the passkey list and the credential list.
internal struct AutofillViewSwitchBar: View {
    let viewSwitch: AutofillViewSwitch
    @Environment(\.colorScheme) private var colorScheme

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: colorScheme)
    }

    var body: some View {
        HStack(spacing: 4) {
            segment(String(localized: "passkeys", bundle: locBundle), count: viewSwitch.passkeyCount, showsPasskeys: true)
            segment(String(localized: "credentials", bundle: locBundle), count: viewSwitch.credentialCount, showsPasskeys: false)
        }
        .padding(3)
        .background(colors.accentBackground)
        .cornerRadius(8)
    }

    private func segment(_ text: String, count: Int, showsPasskeys: Bool) -> some View {
        let isSelected = viewSwitch.showingPasskeys.wrappedValue == showsPasskeys
        return Button(action: {
            viewSwitch.showingPasskeys.wrappedValue = showsPasskeys
        }, label: {
            Text(count > 0 ? "\(text) (\(count))" : text)
                .font(.subheadline.weight(isSelected ? .semibold : .regular))
                .foregroundColor(isSelected ? colors.primarySurfaceText : colors.text)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .background(isSelected ? colors.primary : Color.clear)
                .cornerRadius(6)
                .contentShape(Rectangle())
        })
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/*
 * Picker for a request that accepts both a passkey and a password (a site with a pending passkey request).
 */
public struct PasskeyOrCredentialPickerView: View {
    @ObservedObject public var passkeyViewModel: PasskeyProviderViewModel
    @ObservedObject public var credentialViewModel: CredentialProviderViewModel

    @State private var showingPasskeys = true

    public init(passkeyViewModel: PasskeyProviderViewModel, credentialViewModel: CredentialProviderViewModel) {
        self._passkeyViewModel = ObservedObject(wrappedValue: passkeyViewModel)
        self._credentialViewModel = ObservedObject(wrappedValue: credentialViewModel)
    }

    public var body: some View {
        let viewSwitch = AutofillViewSwitch(
            showingPasskeys: $showingPasskeys,
            passkeyCount: passkeyViewModel.filteredCredentials.count,
            credentialCount: credentialViewModel.filteredCredentials.count
        )

        Group {
            if showingPasskeys {
                PasskeyProviderView(viewModel: passkeyViewModel, viewSwitch: viewSwitch)
            } else {
                CredentialProviderView(viewModel: credentialViewModel, viewSwitch: viewSwitch)
            }
        }
        .task {
            try? await Task.sleep(nanoseconds: 100_000_000)
            await passkeyViewModel.loadCredentials()
            await credentialViewModel.loadCredentials()
            showingPasskeys = !passkeyViewModel.filteredCredentials.isEmpty
        }
        .onDisappear {
            passkeyViewModel.cancel()
        }
    }
}
