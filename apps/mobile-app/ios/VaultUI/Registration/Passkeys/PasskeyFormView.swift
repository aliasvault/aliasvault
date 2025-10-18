import SwiftUI

private let locBundle = Bundle.vaultUI

/// Form view for creating or replacing a passkey
struct PasskeyFormView: View {
    @ObservedObject var viewModel: PasskeyRegistrationViewModel
    let isReplaceMode: Bool
    let replacingPasskeyId: UUID?

    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var isTitleFocused: Bool

    var replacingPasskey: PasskeyWithCredentialInfo? {
        guard let id = replacingPasskeyId else { return nil }
        return viewModel.existingPasskeys.first(where: { $0.id == id })
    }

    var isTitleValid: Bool {
        !viewModel.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ZStack {
            // Background color
            (colorScheme == .dark ? ColorConstants.Dark.background : ColorConstants.Light.background)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                ScrollView {
                    VStack(spacing: 16) {
                        // Notice section
                        if isReplaceMode {
                            // Warning and explanation for replacing
                            if let passkey = replacingPasskey {
                                VStack(spacing: 12) {
                                    HStack(spacing: 12) {
                                        Image(systemName: "info.circle.fill")
                                            .foregroundColor(ColorConstants.Light.primary)
                                        Text(String(localized: "replace_passkey_explanation", bundle: locBundle))
                                            .font(.caption)
                                            .foregroundColor(colorScheme == .dark ? ColorConstants.Dark.textMuted : ColorConstants.Light.textMuted)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                                .padding(.horizontal)
                                .padding(.top, 8)
                            }
                        } else {
                            // Informational notice for creating new
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
                            .padding(.top, 8)
                        }

                        // Editable title field
                        PasskeyTitleInput(title: $viewModel.displayName, focusState: $isTitleFocused)
                            .padding(.top, 8)

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
                    }
                }

                // Action button
                Button(action: {
                    viewModel.createPasskey()
                }, label: {
                    HStack {
                        Image(systemName: "key.fill")
                        Text(isReplaceMode
                            ? String(localized: "confirm_replace", bundle: locBundle)
                            : String(localized: "create_passkey_button_confirm", bundle: locBundle))
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(isTitleValid ? ColorConstants.Light.primary : Color.gray)
                    .foregroundColor(.white)
                    .cornerRadius(8)
                })
                .disabled(!isTitleValid)
                .padding(.horizontal)
                .padding(.bottom, 20)
            }
            .opacity(viewModel.isLoading ? 0.3 : 1.0)
            .disabled(viewModel.isLoading)

            // Loading overlay
            if viewModel.isLoading {
                LoadingOverlayView(message: viewModel.loadingMessage)
            }
        }
        .navigationTitle(isReplaceMode
            ? String(localized: "replace_passkey_title", bundle: locBundle)
            : String(localized: "create_passkey_title", bundle: locBundle))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            // Auto-focus the title field
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                isTitleFocused = true
            }
        }
    }
}
