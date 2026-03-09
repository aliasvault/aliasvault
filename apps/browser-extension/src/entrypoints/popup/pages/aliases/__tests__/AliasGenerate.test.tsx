/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Mock webext-bridge before any imports that use it
vi.mock('webext-bridge/popup', () => ({
  sendMessage: vi.fn().mockResolvedValue({}),
}));

// Mock wxt storage
vi.mock('wxt/utils/storage', () => ({
  storage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock contexts and hooks
vi.mock('@/entrypoints/popup/context/DbContext', () => ({
  useDb: () => ({
    vaultStore: {
      toJson: () => JSON.stringify({ settings: {}, credentials: {} }),
      setSetting: vi.fn(),
      createCredential: vi.fn().mockResolvedValue('new-id'),
    },
  }),
}));

vi.mock('@/entrypoints/popup/context/LoadingContext', () => ({
  useLoading: () => ({
    setIsInitialLoading: vi.fn(),
  }),
}));

vi.mock('@/entrypoints/popup/hooks/useVaultMutate', () => ({
  useVaultMutate: () => ({
    executeVaultMutation: vi.fn(async (op: () => Promise<void>, opts?: { onSuccess?: () => void }) => {
      await op();
      opts?.onSuccess?.();
    }),
    isLoading: false,
    syncStatus: '',
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

// Mock AliasService (dynamically imported)
const mockCheckAliasAvailable = vi.fn().mockResolvedValue(true);
const mockClaimAlias = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/AliasService', () => ({
  checkAliasAvailable: (...args: unknown[]) => mockCheckAliasAvailable(...args),
  claimAlias: (...args: unknown[]) => mockClaimAlias(...args),
}));

vi.mock('@/services/VaultCidStore', () => ({
  VaultCidStore: {
    getSecretKey: vi.fn().mockResolvedValue('aa'.repeat(32)),
  },
}));

vi.mock('@/services/MidnightContractService', () => ({
  MidnightContractService: vi.fn().mockImplementation(() => ({
    joinVaultRegistry: vi.fn().mockResolvedValue(undefined),
    readMailRelay: vi.fn().mockResolvedValue(new Uint8Array(32)),
    readEmailPublicKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
    setMailRelay: vi.fn().mockResolvedValue(undefined),
    setEmailPublicKey: vi.fn().mockResolvedValue(undefined),
    getContractAddress: vi.fn().mockReturnValue('test-contract-addr'),
  })),
}));

vi.mock('@/config/bridge', () => ({
  BRIDGE_RELAY_COMMITMENT: new Uint8Array(32),
}));

import AliasGenerate from '../../aliases/AliasGenerate';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.clearAllMocks();
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
    root.render(<AliasGenerate />);
  });
}

function getText(): string {
  return container.textContent || '';
}

function getButton(text: string): HTMLButtonElement | null {
  const buttons = container.querySelectorAll('button');
  for (const btn of buttons) {
    if (btn.textContent?.includes(text)) return btn;
  }
  return null;
}

function getInput(id: string): HTMLInputElement | null {
  return container.querySelector(`#${id}`);
}

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value',
  )?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('AliasGenerate', () => {
  it('renders alias input and claim button', () => {
    renderComponent();

    expect(getInput('alias-name')).not.toBeNull();
    expect(getButton('Claim Alias')).not.toBeNull();
  });

  it('claim button is initially disabled', () => {
    renderComponent();

    const claimBtn = getButton('Claim Alias');
    expect(claimBtn?.disabled).toBe(true);
  });

  it('shows validation error for too-short alias', () => {
    renderComponent();

    const input = getInput('alias-name')!;
    act(() => {
      setInputValue(input, 'ab');
    });

    expect(getText()).toContain('at least 3');
  });

  it('auto-lowercases input so uppercase never triggers validation error', () => {
    renderComponent();

    const input = getInput('alias-name')!;
    // "Hello" is lowercased to "hello" by the component — valid, no error
    act(() => {
      setInputValue(input, 'Hello');
    });

    expect(getText()).not.toContain('lowercase');
    expect(getText()).not.toContain('at least 3');
  });

  it('has a random button (refresh icon)', () => {
    renderComponent();

    // The FormInput has a refresh button for random generation
    const buttons = container.querySelectorAll('button');
    // At least 2 buttons: refresh and claim
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows domain suffix for valid alias', () => {
    renderComponent();

    const input = getInput('alias-name')!;
    act(() => {
      setInputValue(input, 'test-alias');
    });

    expect(getText()).toContain('test-alias@alias.id');
  });
});
