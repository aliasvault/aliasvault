/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// ── Hoisted mocks ──
// Note: WXT's vitest plugin unifies `#imports` through `wxt/utils/storage`, so
// mocking `wxt/utils/storage` is what actually wins. Mocking `#imports`
// directly does NOT override the plugin's resolution.
const { mockStorage, mockClearWalletState } = vi.hoisted(() => ({
  mockStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
  mockClearWalletState: vi.fn(),
}));

vi.mock('wxt/utils/storage', () => ({
  storage: mockStorage,
}));

vi.mock('webext-bridge/popup', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('@/services/providers/WalletState', () => ({
  clearWalletState: mockClearWalletState,
}));

import { WalletProvider, useWallet } from '../WalletContext';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function DisconnectButton() {
  const wallet = useWallet();
  return (
    <button data-testid="disconnect" onClick={() => wallet.disconnectWallet()}>
      disconnect
    </button>
  );
}

function renderHarness() {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(
      <WalletProvider>
        <DisconnectButton />
      </WalletProvider>,
    );
  });
}

beforeEach(() => {
  mockClearWalletState.mockReset();
  mockStorage.getItem.mockReset();
  mockStorage.setItem.mockReset();
  mockStorage.removeItem.mockReset();
  mockStorage.getItem.mockResolvedValue(null);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
});

describe('WalletContext — disconnectWallet', () => {
  it('clears BOTH popup-local AND background-session wallet state', async () => {
    await act(async () => { renderHarness(); });

    const btn = container.querySelector<HTMLButtonElement>('[data-testid="disconnect"]');
    expect(btn).toBeTruthy();

    await act(async () => { btn!.click(); });

    // Popup-local store (used by WalletContext itself for display)
    expect(mockStorage.removeItem).toHaveBeenCalledWith('local:walletState');

    // Background session store (used by LaceWalletProxy / LaceMidnightProxy).
    // This is the regression guard: before the fix, disconnect only touched
    // the popup store, leaving stale keys visible to the proxy providers.
    expect(mockClearWalletState).toHaveBeenCalledTimes(1);
  });
});
