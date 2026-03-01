/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Mock BackupWalletService
const mockGetBackupWalletStatus = vi.fn();
const mockExecuteBackupTransfer = vi.fn();
const mockComputeBackupCommitment = vi.fn();

vi.mock('@/services/BackupWalletService', () => ({
  getBackupWalletStatus: (...args: unknown[]) => mockGetBackupWalletStatus(...args),
  executeBackupTransfer: (...args: unknown[]) => mockExecuteBackupTransfer(...args),
  computeBackupCommitment: (...args: unknown[]) => mockComputeBackupCommitment(...args),
}));

import BackupTransfer from '../../recovery/BackupTransfer';

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
    root.render(<BackupTransfer />);
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

describe('BackupTransfer', () => {
  it('renders identify form on initial load', () => {
    renderComponent();

    expect(getText()).toContain('Backup Transfer');
    expect(getInput('contract address')).not.toBeNull();
    expect(getInput('Backup key')).not.toBeNull();
    expect(getButton('Verify Eligibility')).not.toBeNull();
  });

  it('shows error when contract address is empty', async () => {
    renderComponent();

    await act(async () => {
      getButton('Verify Eligibility')?.click();
    });

    expect(getText()).toContain('Contract address is required');
  });

  it('shows error when backup key is invalid length', async () => {
    renderComponent();

    const contractInput = getInput('contract address')!;
    const backupKeyInput = getInput('Backup key')!;

    act(() => {
      setInputValue(contractInput, 'test-contract');
      setInputValue(backupKeyInput, 'tooshort');
    });

    await act(async () => {
      getButton('Verify Eligibility')?.click();
    });

    expect(getText()).toContain('64-character hex string');
  });

  it('shows not-found state when wallet not registered', async () => {
    const backupKeyHex = 'aa'.repeat(32);
    const commitment = new Uint8Array(32).fill(0xbb);
    mockComputeBackupCommitment.mockResolvedValue(commitment);
    mockGetBackupWalletStatus.mockResolvedValue([]);

    renderComponent();

    act(() => {
      setInputValue(getInput('contract address')!, 'test-contract');
      setInputValue(getInput('Backup key')!, backupKeyHex);
    });

    await act(async () => {
      getButton('Verify Eligibility')?.click();
    });

    expect(getText()).toContain('Backup Wallet Not Found');
    expect(getButton('Try Again')).not.toBeNull();
  });

  it('shows not-mature state when wallet has not matured', async () => {
    const backupKeyHex = 'aa'.repeat(32);
    const commitment = new Uint8Array(32).fill(0xbb);
    mockComputeBackupCommitment.mockResolvedValue(commitment);
    mockGetBackupWalletStatus.mockResolvedValue([
      {
        commitment,
        registeredAt: BigInt(Math.floor(Date.now() / 1000)), // registered now
        matured: false,
        timeRemaining: 259200,
      },
    ]);

    renderComponent();

    act(() => {
      setInputValue(getInput('contract address')!, 'test-contract');
      setInputValue(getInput('Backup key')!, backupKeyHex);
    });

    await act(async () => {
      getButton('Verify Eligibility')?.click();
    });

    expect(getText()).toContain('Not Yet Mature');
    expect(getText()).toContain('72-hour maturation period');
    expect(getButton('Back')).not.toBeNull();
  });

  it('shows verified state when wallet has matured', async () => {
    const backupKeyHex = 'aa'.repeat(32);
    const commitment = new Uint8Array(32).fill(0xbb);
    mockComputeBackupCommitment.mockResolvedValue(commitment);
    mockGetBackupWalletStatus.mockResolvedValue([
      {
        commitment,
        registeredAt: 1n,
        matured: true,
        timeRemaining: 0,
      },
    ]);

    renderComponent();

    act(() => {
      setInputValue(getInput('contract address')!, 'test-contract');
      setInputValue(getInput('Backup key')!, backupKeyHex);
    });

    await act(async () => {
      getButton('Verify Eligibility')?.click();
    });

    expect(getText()).toContain('Eligible');
    expect(getText()).toContain('Execute Backup Transfer');
    expect(getInput('New owner commitment')).not.toBeNull();
    expect(getButton('Transfer Ownership')).not.toBeNull();
  });

  it('executes transfer and shows success', async () => {
    const backupKeyHex = 'aa'.repeat(32);
    const commitment = new Uint8Array(32).fill(0xbb);
    mockComputeBackupCommitment.mockResolvedValue(commitment);
    mockGetBackupWalletStatus.mockResolvedValue([
      { commitment, registeredAt: 1n, matured: true, timeRemaining: 0 },
    ]);
    mockExecuteBackupTransfer.mockResolvedValue(undefined);

    renderComponent();

    act(() => {
      setInputValue(getInput('contract address')!, 'test-contract');
      setInputValue(getInput('Backup key')!, backupKeyHex);
    });

    await act(async () => {
      getButton('Verify Eligibility')?.click();
    });

    const newOwnerHex = 'cc'.repeat(32);
    act(() => {
      setInputValue(getInput('New owner commitment')!, newOwnerHex);
    });

    await act(async () => {
      getButton('Transfer Ownership')?.click();
    });

    expect(getText()).toContain('Ownership Transferred');
    expect(mockExecuteBackupTransfer).toHaveBeenCalled();
  });

  it('shows error on transfer failure', async () => {
    const backupKeyHex = 'aa'.repeat(32);
    const commitment = new Uint8Array(32).fill(0xbb);
    mockComputeBackupCommitment.mockResolvedValue(commitment);
    mockGetBackupWalletStatus.mockResolvedValue([
      { commitment, registeredAt: 1n, matured: true, timeRemaining: 0 },
    ]);
    mockExecuteBackupTransfer.mockRejectedValue(new Error('Contract reverted'));

    renderComponent();

    act(() => {
      setInputValue(getInput('contract address')!, 'test-contract');
      setInputValue(getInput('Backup key')!, backupKeyHex);
    });

    await act(async () => {
      getButton('Verify Eligibility')?.click();
    });

    const newOwnerHex = 'cc'.repeat(32);
    act(() => {
      setInputValue(getInput('New owner commitment')!, newOwnerHex);
    });

    await act(async () => {
      getButton('Transfer Ownership')?.click();
    });

    expect(getText()).toContain('Contract reverted');
  });

  it('shows error on verification failure', async () => {
    const backupKeyHex = 'aa'.repeat(32);
    mockComputeBackupCommitment.mockRejectedValue(new Error('Computation failed'));

    renderComponent();

    act(() => {
      setInputValue(getInput('contract address')!, 'test-contract');
      setInputValue(getInput('Backup key')!, backupKeyHex);
    });

    await act(async () => {
      getButton('Verify Eligibility')?.click();
    });

    expect(getText()).toContain('Computation failed');
    expect(getButton('Try Again')).not.toBeNull();
  });

  it('try again resets to identify state', async () => {
    const backupKeyHex = 'aa'.repeat(32);
    mockComputeBackupCommitment.mockResolvedValue(new Uint8Array(32).fill(0xbb));
    mockGetBackupWalletStatus.mockResolvedValue([]);

    renderComponent();

    act(() => {
      setInputValue(getInput('contract address')!, 'test-contract');
      setInputValue(getInput('Backup key')!, backupKeyHex);
    });

    await act(async () => {
      getButton('Verify Eligibility')?.click();
    });

    expect(getText()).toContain('Not Found');

    act(() => {
      getButton('Try Again')?.click();
    });

    // Back to identify state
    expect(getInput('contract address')).not.toBeNull();
    expect(getButton('Verify Eligibility')).not.toBeNull();
  });
});
