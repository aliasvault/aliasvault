/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// ── Hoisted mock variables ──
const {
  mockSendMessage,
  mockStorage,
  mockNavigate,
  mockSetAuthTokens,
  mockSetIsInitialLoading,
  mockSetHeaderButtons,
} = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  mockStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
  mockNavigate: vi.fn(),
  mockSetAuthTokens: vi.fn(),
  mockSetIsInitialLoading: vi.fn(),
  mockSetHeaderButtons: vi.fn(),
}));

// ── Wallet mock state (mutable so tests can configure before render) ──
const walletState = vi.hoisted(() => ({
  isConnected: false,
  isConnecting: false,
  isSigning: false,
  isVerified: false,
  walletState: null as { address: string; coinPublicKey: string; shieldedAddress: string } | null,
  signatureResult: null,
  error: null as string | null,
  detectWallet: vi.fn(),
  connectWallet: vi.fn(),
  signChallenge: vi.fn(),
  disconnectWallet: vi.fn(),
  clearError: vi.fn(),
}));

// ── Module mocks ──
vi.mock('webext-bridge/popup', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

vi.mock('wxt/utils/storage', () => ({
  storage: mockStorage,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/entrypoints/popup/context/AppContext', () => ({
  useApp: () => ({ setAuthTokens: mockSetAuthTokens }),
}));

vi.mock('@/entrypoints/popup/context/WalletContext', () => ({
  useWallet: () => walletState,
}));

vi.mock('@/entrypoints/popup/context/LoadingContext', () => ({
  useLoading: () => ({
    setIsInitialLoading: mockSetIsInitialLoading,
  }),
}));

vi.mock('@/entrypoints/popup/context/HeaderButtonsContext', () => ({
  useHeaderButtons: () => ({ setHeaderButtons: mockSetHeaderButtons }),
}));

vi.mock('@/entrypoints/popup/utils/PopoutUtility', () => ({
  PopoutUtility: { isPopup: () => true },
}));

vi.mock('@/entrypoints/popup/components/HeaderButton', () => ({
  default: () => null,
}));

vi.mock('@/entrypoints/popup/components/Icons/HeaderIcons', () => ({
  HeaderIcon: () => null,
  HeaderIconType: { EXPAND: 'EXPAND' },
}));

vi.mock('@/entrypoints/popup/config/explorerConfig', () => ({
  getExplorerAddressUrl: () => null,
}));

// ── Import component after all mocks ──
import Login from '../../auth/Login';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function resetWalletState() {
  walletState.isConnected = false;
  walletState.isConnecting = false;
  walletState.isSigning = false;
  walletState.isVerified = false;
  walletState.walletState = null;
  walletState.signatureResult = null;
  walletState.error = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWalletState();
  mockSendMessage.mockResolvedValue({ success: true, notRegistered: true });
  mockSetAuthTokens.mockResolvedValue(undefined);
  mockStorage.setItem.mockResolvedValue(undefined);
  mockStorage.getItem.mockResolvedValue(null);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
});

function renderComponent() {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(<Login />);
  });
}

function getText(): string {
  return container.textContent || '';
}

function findButton(textMatch: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button'))
    .find(b => b.textContent?.includes(textMatch));
}

// ────────────────────────────────────────────────────────────

describe('Login — Story 6.4d', () => {
  describe('Task 1: Auth state after wallet verification (AC #6)', () => {
    it('calls setAuthTokens with wallet address placeholder after verification', async () => {
      walletState.isConnected = true;
      walletState.isVerified = true;
      walletState.walletState = {
        address: 'addr_test_1qz123abc',
        coinPublicKey: 'pk1',
        shieldedAddress: 'shield1',
      };

      await act(async () => { renderComponent(); });

      expect(mockSetAuthTokens).toHaveBeenCalledWith(
        'addr_test_1qz123abc',
        'wallet:addr_test_1qz123abc',
        'wallet:addr_test_1qz123abc',
      );
    });

    it('does not call setAuthTokens when wallet is not verified', async () => {
      walletState.isConnected = true;
      walletState.isVerified = false;
      walletState.walletState = {
        address: 'addr_test_1qz123abc',
        coinPublicKey: 'pk1',
        shieldedAddress: 'shield1',
      };

      await act(async () => { renderComponent(); });

      expect(mockSetAuthTokens).not.toHaveBeenCalled();
    });
  });

  describe('Task 2: New vs returning user detection (AC #1, #2)', () => {
    beforeEach(() => {
      walletState.isConnected = true;
      walletState.isVerified = true;
      walletState.walletState = {
        address: 'addr_test_1qz123abc',
        coinPublicKey: 'pk1',
        shieldedAddress: 'shield1',
      };
    });

    it('shows Continue button when wallet is verified', async () => {
      await act(async () => { renderComponent(); });

      const continueBtn = findButton('auth.continue');
      expect(continueBtn).toBeDefined();
    });

    it('navigates to /create-password for new user (notRegistered)', async () => {
      mockSendMessage.mockResolvedValue({ success: true, notRegistered: true });

      await act(async () => { renderComponent(); });

      const continueBtn = findButton('auth.continue')!;
      await act(async () => { continueBtn.click(); });

      expect(mockSendMessage).toHaveBeenCalledWith('LOAD_VAULT_FROM_BLOCKCHAIN', {}, 'background');
      expect(mockNavigate).toHaveBeenCalledWith('/create-password', { replace: true });
    });

    it('stores blob in session and navigates to /unlock for returning user (encryptedBlob)', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        encryptedBlob: 'base64-encrypted-vault-data',
      });

      await act(async () => { renderComponent(); });

      const continueBtn = findButton('auth.continue')!;
      await act(async () => { continueBtn.click(); });

      expect(mockStorage.setItem).toHaveBeenCalledWith('session:encryptedVault', 'base64-encrypted-vault-data');
      expect(mockNavigate).toHaveBeenCalledWith('/unlock', { replace: true });
    });

    it('navigates to /unlock for returning user (upToDate)', async () => {
      mockSendMessage.mockResolvedValue({ success: true, upToDate: true });

      await act(async () => { renderComponent(); });

      const continueBtn = findButton('auth.continue')!;
      await act(async () => { continueBtn.click(); });

      expect(mockNavigate).toHaveBeenCalledWith('/unlock', { replace: true });
    });

    it('shows error on vault check failure', async () => {
      mockSendMessage.mockResolvedValue({ success: false, error: 'Network error' });

      await act(async () => { renderComponent(); });

      const continueBtn = findButton('auth.continue')!;
      await act(async () => { continueBtn.click(); });

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(getText()).toContain('Network error');
    });

    it('shows error on exception during vault check', async () => {
      mockSendMessage.mockRejectedValue(new Error('Connection timeout'));

      await act(async () => { renderComponent(); });

      const continueBtn = findButton('auth.continue')!;
      await act(async () => { continueBtn.click(); });

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(getText()).toContain('Connection timeout');
    });
  });
});
