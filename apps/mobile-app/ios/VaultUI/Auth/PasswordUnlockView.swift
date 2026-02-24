import SwiftUI
import VaultModels
import UIKit

private let locBundle = Bundle.vaultUI

/// SwiftUI view for password unlock
public struct PasswordUnlockView: View {
    @ObservedObject public var viewModel: PasswordUnlockViewModel
    @Environment(\.colorScheme) var colorScheme
    @FocusState private var isPasswordFocused: Bool

    public init(viewModel: PasswordUnlockViewModel) {
        self._viewModel = ObservedObject(wrappedValue: viewModel)
    }

    private var colors: ColorConstants.Colors.Type {
        ColorConstants.colors(for: colorScheme)
    }

    public var body: some View {
        ZStack {
            // Background gradient
            LinearGradient(
                gradient: Gradient(colors: [
                    colors.primary.opacity(0.1),
                    colors.background
                ]),
                startPoint: .top,
                endPoint: .center
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                // Header with back button
                HStack {
                    Button(
                        action: {
                            viewModel.cancel()
                        },
                        label: {
                            HStack(spacing: 6) {
                                Image(systemName: "chevron.left")
                                    .font(.system(size: 16, weight: .semibold))
                                Text(String(localized: "back", bundle: locBundle))
                                    .font(.system(size: 16))
                            }
                            .foregroundColor(colors.primary)
                        }
                    )
                    .padding(.leading, 16)
                    Spacer()
                }
                .padding(.top, 16)
                .frame(height: 50)

                Spacer()

                // Content
                VStack(spacing: 28) {
                    // AliasVault Logo with animation
                    Image("Logo", bundle: .vaultUI)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 80, height: 80)
                        .shadow(color: colors.primary.opacity(0.2), radius: 10, x: 0, y: 5)
                        .transition(.scale.combined(with: .opacity))

                    // Title
                    Text(viewModel.customTitle ?? String(localized: "unlock_vault", bundle: locBundle))
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(colors.text)
                        .transition(.opacity)

                    // Subtitle
                    Text(viewModel.customSubtitle ?? String(localized: "enter_password_to_unlock", bundle: locBundle))
                        .font(.system(size: 16))
                        .foregroundColor(colors.text.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .transition(.opacity)

                    // Password Field Container
                    VStack(alignment: .leading, spacing: 12) {
                        // Password Field
                        HStack(spacing: 12) {
                            Image(systemName: "lock.fill")
                                .foregroundColor(colors.text.opacity(0.4))
                                .font(.system(size: 16))

                            SecureField(String(localized: "password", bundle: locBundle), text: $viewModel.password)
                                .textFieldStyle(.plain)
                                .font(.system(size: 16))
                                .foregroundColor(colors.text)
                                .focused($isPasswordFocused)
                                .autocapitalization(.none)
                                .disableAutocorrection(true)
                                .submitLabel(.done)
                                .onSubmit {
                                    if !viewModel.password.isEmpty && !viewModel.isProcessing {
                                        Task {
                                            await viewModel.unlock()
                                        }
                                    }
                                }
                        }
                        .padding(16)
                        .background(colors.accentBackground)
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(
                                    isPasswordFocused ? colors.primary.opacity(0.5) : colors.accentBorder,
                                    lineWidth: isPasswordFocused ? 2 : 1
                                )
                        )
                        .shadow(color: isPasswordFocused ? colors.primary.opacity(0.1) : Color.clear, radius: 8, x: 0, y: 4)
                        .animation(.easeInOut(duration: 0.2), value: isPasswordFocused)

                        // Error message with animation
                        if let error = viewModel.error {
                            HStack(spacing: 8) {
                                Image(systemName: "exclamationmark.circle.fill")
                                    .font(.system(size: 14))
                                Text(error)
                                    .font(.system(size: 14))
                            }
                            .foregroundColor(.red)
                            .transition(.move(edge: .top).combined(with: .opacity))
                            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: viewModel.error)
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 8)

                    // Unlock Button with gradient
                    Button(
                        action: {
                            Task {
                                await viewModel.unlock()
                            }
                        },
                        label: {
                            if viewModel.isProcessing {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 54)
                            } else {
                                HStack(spacing: 8) {
                                    Text(String(localized: "unlock", bundle: locBundle))
                                        .font(.system(size: 17, weight: .semibold))
                                    Image(systemName: "arrow.right")
                                        .font(.system(size: 14, weight: .semibold))
                                }
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .frame(height: 54)
                            }
                        }
                    )
                    .background(
                        LinearGradient(
                            gradient: Gradient(colors: [
                                viewModel.password.isEmpty || viewModel.isProcessing ? colors.primary.opacity(0.5) : colors.primary,
                                viewModel.password.isEmpty || viewModel.isProcessing ? colors.primary.opacity(0.4) : colors.primary.opacity(0.8)
                            ]),
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .cornerRadius(12)
                    .shadow(
                        color: (viewModel.password.isEmpty || viewModel.isProcessing) ? Color.clear : colors.primary.opacity(0.3),
                        radius: 8,
                        x: 0,
                        y: 4
                    )
                    .disabled(viewModel.password.isEmpty || viewModel.isProcessing)
                    .padding(.horizontal, 32)
                    .padding(.top, 8)
                    .scaleEffect(viewModel.password.isEmpty || viewModel.isProcessing ? 0.98 : 1.0)
                    .animation(.easeInOut(duration: 0.2), value: viewModel.password.isEmpty)
                    .animation(.easeInOut(duration: 0.2), value: viewModel.isProcessing)
                }

                Spacer()
                Spacer()
            }
        }
        .onAppear {
            // Delay focus slightly to ensure smooth animation
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                isPasswordFocused = true
            }
        }
    }
}
