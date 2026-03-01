/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Mock RecoveryClaimService
const mockGetRecoveryState = vi.fn();
const mockFetchOnChainRecoveryKeyHash = vi.fn();
const mockFetchSharePackageFromIpfs = vi.fn();
const mockExecuteRecoveryClaim = vi.fn();
const mockCallClaimRecoveryOnChain = vi.fn();
const mockValidateImportedShare = vi.fn();

vi.mock('@/services/RecoveryClaimService', () => ({
  getRecoveryState: (...args: unknown[]) => mockGetRecoveryState(...args),
  fetchOnChainRecoveryKeyHash: (...args: unknown[]) => mockFetchOnChainRecoveryKeyHash(...args),
  fetchSharePackageFromIpfs: (...args: unknown[]) => mockFetchSharePackageFromIpfs(...args),
  executeRecoveryClaim: (...args: unknown[]) => mockExecuteRecoveryClaim(...args),
  callClaimRecoveryOnChain: (...args: unknown[]) => mockCallClaimRecoveryOnChain(...args),
  validateImportedShare: (...args: unknown[]) => mockValidateImportedShare(...args),
}));

import ShareClaim from '../ShareClaim';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const defaultProps = {
  guardianContractAddress: 'gr-contract-001',
  vaultRegistryAddress: 'vr-contract-001',
  pinataGateway: 'test-gateway.pinata.cloud',
  sharesCid: 'bafytestshares123',
  secretKey: new Uint8Array(32).fill(0x01),
};

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  // Default: getRecoveryState never resolves (loading state)
  mockGetRecoveryState.mockReturnValue(new Promise(() => {}));
  // Default: validateImportedShare validates like the real function
  mockValidateImportedShare.mockImplementation(async (data: unknown) => {
    const obj = data as Record<string, unknown>;
    if (obj.version !== 1) throw new Error('Invalid version');
    if (typeof obj.shareIndex !== 'number') throw new Error('Missing shareIndex');
    if (typeof obj.shareHex !== 'string') throw new Error('Missing shareHex');
    return { version: 1, shareIndex: obj.shareIndex, shareHex: obj.shareHex };
  });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
});

function renderComponent(props = defaultProps) {
  act(() => {
    root = createRoot(container);
    root.render(<ShareClaim {...props} />);
  });
}

function getByTestId(testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testId}"]`);
}

function getText(): string {
  return container.textContent || '';
}

/** Helper: import a share via the textarea native setter + add button */
async function importShare(shareIndex: number, shareHex: string) {
  const textarea = getByTestId('share-input') as HTMLTextAreaElement;
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set;

  const shareJson = JSON.stringify({ version: 1, shareIndex, shareHex });
  await act(async () => {
    nativeInputValueSetter?.call(textarea, shareJson);
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    getByTestId('add-share-button')?.click();
  });
}

/** Helper: set up mocks and navigate wizard to the display step with recovered password */
async function navigateToDisplayStep(masterPassword = 'recovered-secret-123') {
  mockGetRecoveryState.mockResolvedValue({
    recoveryInitiatedAt: 1000n,
    approvalCount: 2,
    recoveryComplete: false,
    sharesCidHash: new Uint8Array(32),
  });
  mockFetchSharePackageFromIpfs.mockResolvedValue({
    version: 2, threshold: 2, totalShares: 3, encryptedPassword: 'enc', shares: [],
  });
  mockFetchOnChainRecoveryKeyHash.mockResolvedValue(new Uint8Array(32));
  mockExecuteRecoveryClaim.mockResolvedValue({ masterPassword });

  await act(async () => { renderComponent(); });
  act(() => { getByTestId('proceed-button')?.click(); });

  await importShare(0, 'aabb');
  await importShare(1, 'ccdd');

  await act(async () => { getByTestId('recover-button')?.click(); });
}

describe('ShareClaim', () => {
  it('shows loading state initially', () => {
    renderComponent();
    expect(getByTestId('loading')).not.toBeNull();
    expect(getText()).toContain('Loading recovery status');
  });

  it('shows error when contract not found', async () => {
    mockGetRecoveryState.mockResolvedValue(null);
    await act(async () => { renderComponent(); });

    expect(getByTestId('error')).not.toBeNull();
    expect(getText()).toContain('Contract not found');
  });

  it('shows recovery status after loading', async () => {
    mockGetRecoveryState.mockResolvedValue({
      recoveryInitiatedAt: 1000n,
      approvalCount: 2,
      recoveryComplete: false,
      sharesCidHash: new Uint8Array(32),
    });

    await act(async () => { renderComponent(); });

    expect(getByTestId('status-check')).not.toBeNull();
    expect(getText()).toContain('Recovery active: Yes');
    expect(getText()).toContain('Approvals: 2/2');
    expect(getByTestId('proceed-button')).not.toBeNull();
  });

  it('shows already completed message', async () => {
    mockGetRecoveryState.mockResolvedValue({
      recoveryInitiatedAt: 1000n,
      approvalCount: 2,
      recoveryComplete: true,
      sharesCidHash: new Uint8Array(32),
    });

    await act(async () => { renderComponent(); });

    expect(getText()).toContain('Recovery already completed');
    expect(getByTestId('proceed-button')).toBeNull();
  });

  it('shows insufficient approvals message', async () => {
    mockGetRecoveryState.mockResolvedValue({
      recoveryInitiatedAt: 1000n,
      approvalCount: 1,
      recoveryComplete: false,
      sharesCidHash: new Uint8Array(32),
    });

    await act(async () => { renderComponent(); });

    expect(getText()).toContain('Waiting for more guardian approvals');
    expect(getByTestId('proceed-button')).toBeNull();
  });

  it('navigates to import shares step', async () => {
    mockGetRecoveryState.mockResolvedValue({
      recoveryInitiatedAt: 1000n,
      approvalCount: 2,
      recoveryComplete: false,
      sharesCidHash: new Uint8Array(32),
    });

    await act(async () => { renderComponent(); });

    act(() => {
      getByTestId('proceed-button')?.click();
    });

    expect(getByTestId('import-shares')).not.toBeNull();
    expect(getByTestId('share-input')).not.toBeNull();
  });

  it('imports a valid share file and shows it in the list', async () => {
    mockGetRecoveryState.mockResolvedValue({
      recoveryInitiatedAt: 1000n,
      approvalCount: 2,
      recoveryComplete: false,
      sharesCidHash: new Uint8Array(32),
    });

    await act(async () => { renderComponent(); });

    act(() => { getByTestId('proceed-button')?.click(); });

    const textarea = getByTestId('share-input') as HTMLTextAreaElement;
    const shareJson = JSON.stringify({ version: 1, shareIndex: 0, shareHex: 'aabb' });

    // Set textarea value using native setter to trigger React's onChange
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    await act(async () => {
      nativeInputValueSetter?.call(textarea, shareJson);
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      getByTestId('add-share-button')?.click();
    });

    expect(getByTestId('share-item-0')).not.toBeNull();
    expect(getText()).toContain('Share #0');
  });

  it('shows import error for invalid JSON', async () => {
    mockGetRecoveryState.mockResolvedValue({
      recoveryInitiatedAt: 1000n,
      approvalCount: 2,
      recoveryComplete: false,
      sharesCidHash: new Uint8Array(32),
    });

    await act(async () => { renderComponent(); });
    act(() => { getByTestId('proceed-button')?.click(); });

    // Click add with empty input (will fail JSON.parse)
    await act(async () => { getByTestId('add-share-button')?.click(); });

    expect(getByTestId('import-error')).not.toBeNull();
  });

  it('shows password display with masked field, reveal toggle, and auto-clear warning', async () => {
    await navigateToDisplayStep('my-secret-pass');

    // Display step rendered
    expect(getByTestId('display-password')).not.toBeNull();

    // Password field is masked by default
    const passwordField = getByTestId('password-field') as HTMLInputElement;
    expect(passwordField.type).toBe('password');
    expect(passwordField.value).toBe('my-secret-pass');

    // Reveal toggle shows "Show"
    const revealButton = getByTestId('reveal-button');
    expect(revealButton).not.toBeNull();
    expect(revealButton?.textContent).toBe('Show');

    // Click reveal — field becomes text
    act(() => { revealButton?.click(); });
    expect((getByTestId('password-field') as HTMLInputElement).type).toBe('text');
    expect(getByTestId('reveal-button')?.textContent).toBe('Hide');

    // Click again — field becomes password
    act(() => { getByTestId('reveal-button')?.click(); });
    expect((getByTestId('password-field') as HTMLInputElement).type).toBe('password');

    // Auto-clear warning present with countdown
    expect(getByTestId('auto-clear-warning')).not.toBeNull();
    expect(getText()).toContain('cleared from memory in');

    // Copy button present
    expect(getByTestId('copy-password-button')).not.toBeNull();

    // Finalize button present
    expect(getByTestId('finalize-button')).not.toBeNull();
  });

  it('auto-clears password after 60-second countdown expires', async () => {
    vi.useFakeTimers();

    await navigateToDisplayStep('timer-test-pass');
    expect(getByTestId('display-password')).not.toBeNull();

    // Advance 59 seconds — still showing password
    act(() => { vi.advanceTimersByTime(59000); });
    expect(getByTestId('display-password')).not.toBeNull();

    // Advance 2 more seconds — password auto-cleared
    act(() => { vi.advanceTimersByTime(2000); });
    expect(getByTestId('error')).not.toBeNull();
    expect(getText()).toContain('auto-cleared');

    vi.useRealTimers();
  });

  it('copy password button calls navigator.clipboard.writeText', async () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

    await navigateToDisplayStep('copy-test-pass');

    act(() => { getByTestId('copy-password-button')?.click(); });

    expect(mockWriteText).toHaveBeenCalledWith('copy-test-pass');
  });

  it('shows error when required params are missing', async () => {
    await act(async () => {
      renderComponent({
        guardianContractAddress: undefined as any,
        vaultRegistryAddress: 'vr-001',
        pinataGateway: 'gw',
        sharesCid: undefined as any,
        secretKey: null,
      });
    });

    expect(getByTestId('error')).not.toBeNull();
    expect(getText()).toContain('Missing required parameters');
  });

  it('shows error when getRecoveryState rejects', async () => {
    mockGetRecoveryState.mockRejectedValue(new Error('Network error'));

    await act(async () => { renderComponent(); });

    expect(getByTestId('error')).not.toBeNull();
    expect(getText()).toContain('Network error');
  });

  it('shows no active recovery message', async () => {
    mockGetRecoveryState.mockResolvedValue({
      recoveryInitiatedAt: 0n,
      approvalCount: 0,
      recoveryComplete: false,
      sharesCidHash: new Uint8Array(32),
    });

    await act(async () => { renderComponent(); });

    expect(getText()).toContain('No active recovery');
  });
});
