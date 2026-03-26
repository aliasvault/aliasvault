/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// ── Hoisted mock variables (available before vi.mock factories execute) ──
const {
  mockSendMessage,
  mockStorage,
  mockDeriveKeyFromPassword,
  mockIsPinEnabled,
  mockGetPinLength,
  mockUnlockWithPin,
  mockResetFailedAttempts,
  mockNavigate,
  mockLogout,
  mockSetAuthTokens,
  mockStoreEncryptionKey,
  mockStoreEncryptionKeyDerivationParams,
  mockInitializeDatabaseFromBlob,
  mockInitializeDatabase,
  mockShowLoading,
  mockHideLoading,
  mockSetIsInitialLoading,
  mockWebApiGet,
  mockWebApiGetStatus,
  mockWebApiRevokeTokens,
} = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  mockStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
  mockDeriveKeyFromPassword: vi.fn(),
  mockIsPinEnabled: vi.fn(),
  mockGetPinLength: vi.fn(),
  mockUnlockWithPin: vi.fn(),
  mockResetFailedAttempts: vi.fn(),
  mockNavigate: vi.fn(),
  mockLogout: vi.fn(),
  mockSetAuthTokens: vi.fn(),
  mockStoreEncryptionKey: vi.fn(),
  mockStoreEncryptionKeyDerivationParams: vi.fn(),
  mockInitializeDatabaseFromBlob: vi.fn(),
  mockInitializeDatabase: vi.fn(),
  mockShowLoading: vi.fn(),
  mockHideLoading: vi.fn(),
  mockSetIsInitialLoading: vi.fn(),
  mockWebApiGet: vi.fn(),
  mockWebApiGetStatus: vi.fn(),
  mockWebApiRevokeTokens: vi.fn(),
}));

// ── Module mocks ──
vi.mock('webext-bridge/popup', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

vi.mock('wxt/utils/storage', () => ({
  storage: mockStorage,
}));

vi.mock('@/utils/EncryptionUtility', () => ({
  default: {
    deriveKeyFromPassword: (...args: unknown[]) => mockDeriveKeyFromPassword(...args),
    symmetricDecrypt: vi.fn(),
    symmetricEncrypt: vi.fn(),
  },
  EncryptionUtility: {
    deriveKeyFromPassword: (...args: unknown[]) => mockDeriveKeyFromPassword(...args),
    symmetricDecrypt: vi.fn(),
    symmetricEncrypt: vi.fn(),
  },
}));

vi.mock('@/utils/PinUnlockService', () => ({
  isPinEnabled: () => mockIsPinEnabled(),
  getPinLength: () => mockGetPinLength(),
  unlockWithPin: (...args: unknown[]) => mockUnlockWithPin(...args),
  resetFailedAttempts: () => mockResetFailedAttempts(),
  PinLockedError: class PinLockedError extends Error {},
  IncorrectPinError: class IncorrectPinError extends Error {
    attemptsRemaining = 0;
    constructor(msg: string, attempts: number) { super(msg); this.attemptsRemaining = attempts; }
  },
  InvalidPinFormatError: class InvalidPinFormatError extends Error {},
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/entrypoints/popup/context/AppContext', () => ({
  useApp: () => ({ logout: mockLogout }),
}));

vi.mock('@/entrypoints/popup/context/AuthContext', () => ({
  useAuth: () => ({ setAuthTokens: mockSetAuthTokens }),
}));

vi.mock('@/entrypoints/popup/context/DbContext', () => ({
  useDb: () => ({
    storeEncryptionKey: mockStoreEncryptionKey,
    storeEncryptionKeyDerivationParams: mockStoreEncryptionKeyDerivationParams,
    initializeDatabaseFromBlob: mockInitializeDatabaseFromBlob,
    initializeDatabase: mockInitializeDatabase,
  }),
}));

vi.mock('@/entrypoints/popup/context/LoadingContext', () => ({
  useLoading: () => ({
    showLoading: mockShowLoading,
    hideLoading: mockHideLoading,
    setIsInitialLoading: mockSetIsInitialLoading,
  }),
}));

vi.mock('@/entrypoints/popup/context/HeaderButtonsContext', () => ({
  useHeaderButtons: () => ({ setHeaderButtons: vi.fn() }),
}));

vi.mock('@/entrypoints/popup/context/WebApiContext', () => ({
  useWebApi: () => ({
    get: mockWebApiGet,
    getStatus: mockWebApiGetStatus,
    validateStatusResponse: vi.fn(),
    revokeTokens: mockWebApiRevokeTokens,
  }),
}));

vi.mock('@/entrypoints/popup/utils/PopoutUtility', () => ({
  PopoutUtility: { isPopup: () => true },
}));

vi.mock('@/entrypoints/popup/components/AlertMessage', () => ({
  default: ({ message }: { message: string }) => <div data-testid="alert">{message}</div>,
}));

vi.mock('@/entrypoints/popup/components/Button', () => ({
  default: ({ children, ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) =>
    <button {...props}>{children}</button>,
}));

vi.mock('@/entrypoints/popup/components/Dialogs/MobileUnlockModal', () => ({
  default: (props: Record<string, unknown>) => {
    if (!props.isOpen) return null;
    const onSuccess = props.onSuccess as (result: Record<string, string>) => void;
    return (
      <button
        data-testid="mobile-unlock-trigger"
        onClick={() => onSuccess({
          username: 'test-user',
          token: 'mock-token',
          refreshToken: 'mock-refresh',
          decryptionKey: 'mobile-decryption-key-base64',
          salt: 'mobile-salt',
          encryptionType: 'argon2id',
          encryptionSettings: '{}',
        })}
      >
        Mock Mobile Unlock
      </button>
    );
  },
}));

vi.mock('@/entrypoints/popup/components/HeaderButton', () => ({
  default: () => null,
}));

vi.mock('@/entrypoints/popup/components/Icons/HeaderIcons', () => ({
  HeaderIcon: () => null,
  HeaderIconType: { EXPAND: 'EXPAND', EYE: 'EYE', EYE_OFF: 'EYE_OFF' },
}));

vi.mock('@/entrypoints/popup/components/Unlock/UsernameAvatar', () => ({
  default: () => <div data-testid="avatar">Avatar</div>,
}));

vi.mock('@/utils/Constants', () => ({
  VAULT_LOCKED_DISMISS_UNTIL_KEY: 'local:vaultLockedDismissUntil',
}));

// ── Import component after all mocks ──
import Unlock from '../../auth/Unlock';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.clearAllMocks();
  mockIsPinEnabled.mockResolvedValue(false);
  mockGetPinLength.mockResolvedValue(6);
  mockSendMessage.mockImplementation((msg: string) => {
    if (msg === 'GET_ENCRYPTION_KEY_DERIVATION_PARAMS') {
      return Promise.resolve({ salt: 'salt123', encryptionType: 'argon2id', encryptionSettings: '{}' });
    }
    if (msg === 'LOAD_VAULT_FROM_BLOCKCHAIN') {
      return Promise.resolve({ success: true, encryptedBlob: 'blockchain-blob-base64' });
    }
    return Promise.resolve(null);
  });
  mockStorage.getItem.mockImplementation((key: string) => {
    if (key === 'session:encryptedVault') return Promise.resolve('encrypted-vault-base64');
    return Promise.resolve(null);
  });
  mockStorage.setItem.mockResolvedValue(undefined);
  mockDeriveKeyFromPassword.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  mockInitializeDatabaseFromBlob.mockResolvedValue({});
  mockStoreEncryptionKey.mockResolvedValue(undefined);
  mockStoreEncryptionKeyDerivationParams.mockResolvedValue(undefined);
  mockSetAuthTokens.mockResolvedValue(undefined);
  mockWebApiRevokeTokens.mockResolvedValue(undefined);
  mockResetFailedAttempts.mockResolvedValue(undefined);

  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
});

function renderComponent() {
  act(() => {
    root = createRoot(container);
    root.render(<Unlock />);
  });
}

function getText(): string {
  return container.textContent || '';
}

function getPasswordInput(): HTMLInputElement | null {
  return container.querySelector('#password');
}

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value',
  )?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// ────────────────────────────────────────────────────────────

describe('Unlock — blockchain wiring (Story 6.4a)', () => {
  describe('AC #1: No server health check', () => {
    it('does not call webApi.getStatus on mount', async () => {
      await act(async () => { renderComponent(); });

      expect(mockWebApiGetStatus).not.toHaveBeenCalled();
      expect(mockSetIsInitialLoading).toHaveBeenCalledWith(false);
    });

    it('does not call webApi.getStatus on password submit', async () => {
      await act(async () => { renderComponent(); });

      const input = getPasswordInput()!;
      act(() => { setInputValue(input, 'my-password'); });

      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      expect(mockWebApiGetStatus).not.toHaveBeenCalled();
    });
  });

  describe('AC #2: Password unlock uses blockchain vault', () => {
    it('reads encrypted blob from session storage', async () => {
      await act(async () => { renderComponent(); });

      const input = getPasswordInput()!;
      act(() => { setInputValue(input, 'test-password'); });

      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      expect(mockStorage.getItem).toHaveBeenCalledWith('session:encryptedVault');
      expect(mockInitializeDatabaseFromBlob).toHaveBeenCalledWith('encrypted-vault-base64', expect.any(String));
      expect(mockInitializeDatabase).not.toHaveBeenCalled();
      expect(mockWebApiGet).not.toHaveBeenCalled();
    });

    it('falls back to LOAD_VAULT_FROM_BLOCKCHAIN when session empty', async () => {
      mockStorage.getItem.mockResolvedValue(null);

      await act(async () => { renderComponent(); });

      const input = getPasswordInput()!;
      act(() => { setInputValue(input, 'test-password'); });

      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      expect(mockStorage.getItem).toHaveBeenCalledWith('session:encryptedVault');
      expect(mockSendMessage).toHaveBeenCalledWith('LOAD_VAULT_FROM_BLOCKCHAIN', {}, 'background');
      expect(mockInitializeDatabaseFromBlob).toHaveBeenCalledWith('blockchain-blob-base64', expect.any(String));
    });

    it('navigates to /reinitialize after successful unlock', async () => {
      await act(async () => { renderComponent(); });

      const input = getPasswordInput()!;
      act(() => { setInputValue(input, 'test-password'); });

      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      expect(mockNavigate).toHaveBeenCalledWith('/reinitialize', { replace: true });
    });

    it('shows error when vault unavailable from both session and blockchain', async () => {
      mockStorage.getItem.mockResolvedValue(null);
      mockSendMessage.mockImplementation((msg: string) => {
        if (msg === 'GET_ENCRYPTION_KEY_DERIVATION_PARAMS') {
          return Promise.resolve({ salt: 'salt', encryptionType: 'argon2id', encryptionSettings: '{}' });
        }
        if (msg === 'LOAD_VAULT_FROM_BLOCKCHAIN') {
          return Promise.resolve({ success: false, error: 'No vault' });
        }
        return Promise.resolve(null);
      });

      await act(async () => { renderComponent(); });

      const input = getPasswordInput()!;
      act(() => { setInputValue(input, 'test-password'); });

      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(getText()).toContain('Vault not available');
    });
  });

  describe('AC #3: PIN unlock uses blockchain vault', () => {
    it('uses initializeDatabaseFromBlob for PIN unlock', async () => {
      vi.useFakeTimers();
      try {
        mockIsPinEnabled.mockResolvedValue(true);
        mockGetPinLength.mockResolvedValue(4);
        mockUnlockWithPin.mockResolvedValue('pin-derived-key-base64');

        await act(async () => { renderComponent(); });

        const pinInput = container.querySelector('input[aria-label="PIN input"]') as HTMLInputElement;
        expect(pinInput).not.toBeNull();

        // Simulate entering 4-digit PIN (auto-submits at length)
        await act(async () => {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value',
          )?.set;
          nativeSetter?.call(pinInput, '1234');
          pinInput.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Advance past the component's 50ms delay deterministically
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });

        expect(mockUnlockWithPin).toHaveBeenCalledWith('1234');
        expect(mockInitializeDatabaseFromBlob).toHaveBeenCalledWith('encrypted-vault-base64', 'pin-derived-key-base64');
        expect(mockInitializeDatabase).not.toHaveBeenCalled();
        expect(mockWebApiGet).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('AC #4: Mobile unlock uses blockchain vault', () => {
    it('uses initializeDatabaseFromBlob for mobile unlock', async () => {
      await act(async () => { renderComponent(); });

      // Click "Unlock with Mobile" to open modal
      const mobileBtn = Array.from(container.querySelectorAll('button'))
        .find(b => b.textContent?.includes('auth.unlockWithMobile'));
      expect(mobileBtn).toBeDefined();
      await act(async () => { mobileBtn!.click(); });

      // Click mock trigger to invoke onSuccess
      const trigger = container.querySelector('[data-testid="mobile-unlock-trigger"]') as HTMLButtonElement;
      expect(trigger).not.toBeNull();
      await act(async () => { trigger.click(); });

      expect(mockStorage.getItem).toHaveBeenCalledWith('session:encryptedVault');
      expect(mockInitializeDatabaseFromBlob).toHaveBeenCalledWith('encrypted-vault-base64', 'mobile-decryption-key-base64');
      expect(mockInitializeDatabase).not.toHaveBeenCalled();
      expect(mockWebApiGet).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/reinitialize', { replace: true });
    });
  });

  describe('AC #5: revokeTokens wrapped in try/catch', () => {
    it('mobile unlock succeeds even when revokeTokens fails', async () => {
      mockWebApiRevokeTokens.mockRejectedValue(new Error('Server unavailable'));

      await act(async () => { renderComponent(); });

      // Open mobile modal
      const mobileBtn = Array.from(container.querySelectorAll('button'))
        .find(b => b.textContent?.includes('auth.unlockWithMobile'));
      await act(async () => { mobileBtn!.click(); });

      // Trigger mobile unlock
      const trigger = container.querySelector('[data-testid="mobile-unlock-trigger"]') as HTMLButtonElement;
      await act(async () => { trigger.click(); });

      // revokeTokens failed but unlock still succeeded
      expect(mockWebApiRevokeTokens).toHaveBeenCalled();
      expect(mockInitializeDatabaseFromBlob).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/reinitialize', { replace: true });
    });
  });

  describe('Initialization', () => {
    it('defaults to PIN mode when PIN is enabled', async () => {
      mockIsPinEnabled.mockResolvedValue(true);
      mockGetPinLength.mockResolvedValue(6);

      await act(async () => { renderComponent(); });

      expect(getText()).toContain('auth.enterPinToUnlock');
    });

    it('defaults to password mode when PIN is disabled', async () => {
      mockIsPinEnabled.mockResolvedValue(false);

      await act(async () => { renderComponent(); });

      expect(getText()).toContain('auth.masterPassword');
    });
  });
});
