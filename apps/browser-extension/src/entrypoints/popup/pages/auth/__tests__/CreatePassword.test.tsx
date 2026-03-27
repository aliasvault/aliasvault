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
  mockDeriveKeyFromPassword,
  mockSymmetricEncrypt,
  mockInitializeDatabaseFromBlob,
  mockSetSecretKey,
  mockShowLoading,
  mockHideLoading,
  mockSetIsInitialLoading,
} = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  mockStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
  mockNavigate: vi.fn(),
  mockDeriveKeyFromPassword: vi.fn(),
  mockSymmetricEncrypt: vi.fn(),
  mockInitializeDatabaseFromBlob: vi.fn(),
  mockSetSecretKey: vi.fn(),
  mockShowLoading: vi.fn(),
  mockHideLoading: vi.fn(),
  mockSetIsInitialLoading: vi.fn(),
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
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => opts ? `${key}:${JSON.stringify(opts)}` : key }),
}));

vi.mock('@/utils/EncryptionUtility', () => ({
  default: {
    deriveKeyFromPassword: (...args: unknown[]) => mockDeriveKeyFromPassword(...args),
    symmetricEncrypt: (...args: unknown[]) => mockSymmetricEncrypt(...args),
  },
  EncryptionUtility: {
    deriveKeyFromPassword: (...args: unknown[]) => mockDeriveKeyFromPassword(...args),
    symmetricEncrypt: (...args: unknown[]) => mockSymmetricEncrypt(...args),
  },
}));

vi.mock('@/utils/dist/shared/vault-types', () => {
  const mockVaultStore = {
    setSetting: vi.fn(),
    toJson: vi.fn().mockReturnValue('{"version":1,"credentials":{},"settings":{},"encryptionKeys":[]}'),
  };
  return {
    VaultStore: {
      createEmpty: vi.fn().mockReturnValue(mockVaultStore),
      fromJson: vi.fn().mockReturnValue(mockVaultStore),
    },
  };
});

vi.mock('@/services/VaultCidStore', () => ({
  VaultCidStore: {
    setSecretKey: (...args: unknown[]) => mockSetSecretKey(...args),
  },
}));

vi.mock('@/entrypoints/popup/context/DbContext', () => ({
  useDb: () => ({
    initializeDatabaseFromBlob: mockInitializeDatabaseFromBlob,
  }),
}));

vi.mock('@/entrypoints/popup/context/LoadingContext', () => ({
  useLoading: () => ({
    showLoading: mockShowLoading,
    hideLoading: mockHideLoading,
    setIsInitialLoading: mockSetIsInitialLoading,
  }),
}));

vi.mock('@/entrypoints/popup/components/Button', () => ({
  default: ({ children, ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) =>
    <button {...props}>{children}</button>,
}));

vi.mock('@/entrypoints/popup/components/Icons/HeaderIcons', () => ({
  HeaderIcon: () => null,
  HeaderIconType: { EYE: 'EYE', EYE_OFF: 'EYE_OFF' },
}));

// ── Import component after all mocks ──
import CreatePassword from '../../auth/CreatePassword';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.clearAllMocks();
  mockDeriveKeyFromPassword.mockResolvedValue(new Uint8Array(32));
  mockSymmetricEncrypt.mockResolvedValue('encrypted-vault-base64');
  mockSendMessage.mockResolvedValue({ success: true });
  mockInitializeDatabaseFromBlob.mockResolvedValue({});
  mockSetSecretKey.mockResolvedValue(undefined);
  mockStorage.setItem.mockResolvedValue(undefined);
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
    root.render(<CreatePassword />);
  });
}

function getText(): string {
  return container.textContent || '';
}

function getPasswordInput(): HTMLInputElement | null {
  return container.querySelector('#password');
}

function getConfirmInput(): HTMLInputElement | null {
  return container.querySelector('#confirmPassword');
}

function getSubmitButton(): HTMLButtonElement | null {
  return container.querySelector('button[type="submit"]');
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

describe('CreatePassword — Story 6.4d', () => {
  describe('Task 3: UI (AC #3)', () => {
    it('renders password and confirm password inputs', async () => {
      await act(async () => { renderComponent(); });

      expect(getPasswordInput()).not.toBeNull();
      expect(getConfirmInput()).not.toBeNull();
    });

    it('shows heading text', async () => {
      await act(async () => { renderComponent(); });

      expect(getText()).toContain('auth.createMasterPassword');
    });

    it('submit button is disabled when passwords are empty', async () => {
      await act(async () => { renderComponent(); });

      const btn = getSubmitButton()!;
      expect(btn.disabled).toBe(true);
    });

    it('submit button is disabled when password is too short', async () => {
      await act(async () => { renderComponent(); });

      const pw = getPasswordInput()!;
      const confirm = getConfirmInput()!;
      act(() => {
        setInputValue(pw, 'short');
        setInputValue(confirm, 'short');
      });

      const btn = getSubmitButton()!;
      expect(btn.disabled).toBe(true);
    });

    it('submit button is disabled when passwords do not match', async () => {
      await act(async () => { renderComponent(); });

      const pw = getPasswordInput()!;
      const confirm = getConfirmInput()!;
      act(() => {
        setInputValue(pw, 'longpassword123');
        setInputValue(confirm, 'differentpassword');
      });

      const btn = getSubmitButton()!;
      expect(btn.disabled).toBe(true);
    });

    it('submit button is enabled when passwords match and are long enough', async () => {
      await act(async () => { renderComponent(); });

      const pw = getPasswordInput()!;
      const confirm = getConfirmInput()!;
      act(() => {
        setInputValue(pw, 'strongpassword');
        setInputValue(confirm, 'strongpassword');
      });

      const btn = getSubmitButton()!;
      expect(btn.disabled).toBe(false);
    });
  });

  describe('Task 4: Vault initialization on submit (AC #4)', () => {
    async function fillAndSubmit() {
      await act(async () => { renderComponent(); });

      const pw = getPasswordInput()!;
      const confirm = getConfirmInput()!;
      act(() => {
        setInputValue(pw, 'strongpassword');
        setInputValue(confirm, 'strongpassword');
      });

      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    }

    it('derives key from password with Argon2Id', async () => {
      await fillAndSubmit();

      expect(mockDeriveKeyFromPassword).toHaveBeenCalledWith(
        'strongpassword',
        expect.any(String), // hex salt
        'Argon2Id',
        '{"Iterations":2,"MemorySize":19456,"DegreeOfParallelism":1}',
      );
      // Salt should be 64-char hex (32 bytes)
      const salt = mockDeriveKeyFromPassword.mock.calls[0][1] as string;
      expect(salt).toMatch(/^[0-9a-f]{64}$/);
    });

    it('stores params, key, and vault in background (exact order)', async () => {
      await fillAndSubmit();

      const calls = mockSendMessage.mock.calls.map((c: unknown[]) => c[0]);
      const paramIdx = calls.indexOf('STORE_ENCRYPTION_KEY_DERIVATION_PARAMS');
      const keyIdx = calls.indexOf('STORE_ENCRYPTION_KEY');
      const vaultIdx = calls.indexOf('STORE_VAULT');

      expect(paramIdx).toBeGreaterThanOrEqual(0);
      expect(keyIdx).toBeGreaterThan(paramIdx);
      expect(vaultIdx).toBeGreaterThan(keyIdx);
    });

    it('stores params with correct format', async () => {
      await fillAndSubmit();

      const paramsCall = mockSendMessage.mock.calls.find(
        (c: unknown[]) => c[0] === 'STORE_ENCRYPTION_KEY_DERIVATION_PARAMS',
      );
      expect(paramsCall).toBeDefined();
      const params = paramsCall![1] as Record<string, string>;
      expect(params.encryptionType).toBe('Argon2Id');
      expect(params.encryptionSettings).toBe('{"Iterations":2,"MemorySize":19456,"DegreeOfParallelism":1}');
      expect(params.salt).toMatch(/^[0-9a-f]{64}$/);
    });

    it('caches secretKey in VaultCidStore', async () => {
      await fillAndSubmit();

      expect(mockSetSecretKey).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    });

    it('initializes DbContext with encrypted vault', async () => {
      await fillAndSubmit();

      expect(mockInitializeDatabaseFromBlob).toHaveBeenCalledWith(
        'encrypted-vault-base64',
        expect.any(String), // base64 key
      );
    });

    it('navigates to /reinitialize after success', async () => {
      await fillAndSubmit();

      expect(mockNavigate).toHaveBeenCalledWith('/reinitialize', { replace: true });
    });

    it('shows error on failure', async () => {
      mockDeriveKeyFromPassword.mockRejectedValue(new Error('Argon2 failed'));

      await fillAndSubmit();

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(getText()).toContain('Argon2 failed');
    });
  });
});
