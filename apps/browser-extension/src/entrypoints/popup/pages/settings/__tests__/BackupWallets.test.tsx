/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Mock BackupWalletService
const mockGetBackupWalletStatus = vi.fn();
const mockAddBackupWallet = vi.fn();
const mockRemoveBackupWallet = vi.fn();

vi.mock('@/services/BackupWalletService', () => ({
  getBackupWalletStatus: (...args: unknown[]) => mockGetBackupWalletStatus(...args),
  addBackupWallet: (...args: unknown[]) => mockAddBackupWallet(...args),
  removeBackupWallet: (...args: unknown[]) => mockRemoveBackupWallet(...args),
}));

// Mock VaultCidStore
const mockGetSecretKey = vi.fn();

vi.mock('@/services/VaultCidStore', () => ({
  VaultCidStore: {
    getSecretKey: (...args: unknown[]) => mockGetSecretKey(...args),
  },
}));

import BackupWallets from '../../settings/BackupWallets';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: vault unlocked with a valid secret key
  mockGetSecretKey.mockResolvedValue('aa'.repeat(32));
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
    root.render(<BackupWallets />);
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

function getInput(placeholder: string): HTMLInputElement | null {
  return container.querySelector(`input[placeholder*="${placeholder}"]`);
}

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value',
  )?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Helper: load wallets to get past the contract address screen */
async function loadWalletsWithStatus(wallets: unknown[] = []) {
  mockGetBackupWalletStatus.mockResolvedValue(wallets);
  renderComponent();
  act(() => { setInputValue(getInput('Contract address')!, 'test-contract'); });
  await act(async () => { getButton('Load Backup Wallets')?.click(); });
}

describe('BackupWallets', () => {
  it('renders contract address input initially', () => {
    renderComponent();

    expect(getText()).toContain('VaultRegistry Contract');
    expect(getInput('Contract address')).not.toBeNull();
    expect(getButton('Load Backup Wallets')).not.toBeNull();
  });

  it('disables load button when contract address is empty', () => {
    renderComponent();

    const loadButton = getButton('Load Backup Wallets')!;
    expect(loadButton.disabled).toBe(true);
  });

  it('loads and displays empty wallet list', async () => {
    await loadWalletsWithStatus([]);

    expect(getText()).toContain('Registered Backup Wallets (0)');
    expect(getText()).toContain('No backup wallets registered');
  });

  it('loads and displays wallets with maturation status', async () => {
    const commitment1 = new Uint8Array(32).fill(0xaa);
    const commitment2 = new Uint8Array(32).fill(0xbb);

    await loadWalletsWithStatus([
      { commitment: commitment1, registeredAt: 1n, matured: true, timeRemaining: 0 },
      { commitment: commitment2, registeredAt: BigInt(Math.floor(Date.now() / 1000)), matured: false, timeRemaining: 7200 },
    ]);

    expect(getText()).toContain('Registered Backup Wallets (2)');
    expect(getText()).toContain('Ready');
    expect(getText()).toContain('Matures in');
  });

  it('shows error on load failure', async () => {
    mockGetBackupWalletStatus.mockRejectedValue(new Error('Network error'));
    renderComponent();
    act(() => { setInputValue(getInput('Contract address')!, 'test-contract'); });
    await act(async () => { getButton('Load Backup Wallets')?.click(); });

    expect(getText()).toContain('Network error');
  });

  it('shows add form and security info after loading', async () => {
    await loadWalletsWithStatus([]);

    expect(getText()).toContain('Add Backup Wallet');
    expect(getInput('Backup key')).not.toBeNull();
    expect(getButton('Add Backup Wallet')).not.toBeNull();
    expect(getText()).toContain('72-Hour Maturation Period');
  });

  it('shows error when adding wallet with invalid hex key', async () => {
    await loadWalletsWithStatus([]);

    act(() => { setInputValue(getInput('Backup key')!, 'tooshort'); });
    await act(async () => { getButton('Add Backup Wallet')?.click(); });

    expect(getText()).toContain('64-character hex string');
    expect(mockAddBackupWallet).not.toHaveBeenCalled();
  });

  it('shows error when adding wallet with non-hex characters', async () => {
    await loadWalletsWithStatus([]);

    act(() => { setInputValue(getInput('Backup key')!, 'gg'.repeat(32)); });
    await act(async () => { getButton('Add Backup Wallet')?.click(); });

    expect(getText()).toContain('64-character hex string');
    expect(mockAddBackupWallet).not.toHaveBeenCalled();
  });

  it('calls addBackupWallet service on valid add', async () => {
    mockAddBackupWallet.mockResolvedValue(undefined);
    // After add, reload returns empty list
    mockGetBackupWalletStatus.mockResolvedValue([]);

    await loadWalletsWithStatus([]);

    act(() => { setInputValue(getInput('Backup key')!, 'bb'.repeat(32)); });
    await act(async () => { getButton('Add Backup Wallet')?.click(); });

    expect(mockGetSecretKey).toHaveBeenCalled();
    expect(mockAddBackupWallet).toHaveBeenCalledWith(
      'test-contract',
      expect.any(Uint8Array),
      expect.any(Uint8Array),
    );
  });

  it('shows error when vault not unlocked on add', async () => {
    mockGetSecretKey.mockResolvedValue(null);

    await loadWalletsWithStatus([]);

    act(() => { setInputValue(getInput('Backup key')!, 'cc'.repeat(32)); });
    await act(async () => { getButton('Add Backup Wallet')?.click(); });

    expect(getText()).toContain('secret key unavailable');
    expect(mockAddBackupWallet).not.toHaveBeenCalled();
  });

  it('calls removeBackupWallet service on remove click', async () => {
    const commitment = new Uint8Array(32).fill(0xdd);
    mockRemoveBackupWallet.mockResolvedValue(undefined);

    await loadWalletsWithStatus([
      { commitment, registeredAt: 1n, matured: true, timeRemaining: 0 },
    ]);

    // After remove, reload returns empty list
    mockGetBackupWalletStatus.mockResolvedValue([]);

    // Click the remove button (trash icon)
    const removeButton = container.querySelector('button[title="Remove backup wallet"]') as HTMLButtonElement;
    expect(removeButton).not.toBeNull();

    await act(async () => { removeButton.click(); });

    expect(mockGetSecretKey).toHaveBeenCalled();
    expect(mockRemoveBackupWallet).toHaveBeenCalledWith(
      'test-contract',
      expect.any(Uint8Array),
      expect.any(Uint8Array),
    );
  });

  it('hides contract input after loading', async () => {
    await loadWalletsWithStatus([]);

    expect(getButton('Load Backup Wallets')).toBeNull();
  });
});
