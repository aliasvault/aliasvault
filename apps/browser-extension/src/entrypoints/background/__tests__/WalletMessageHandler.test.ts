import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { fakeBrowser } from 'wxt/testing';

// Mock wxt/utils/storage (pulled in by WalletState via @/services/providers)
vi.mock('wxt/utils/storage', () => ({
  storage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

// Mock WalletState explicitly to assert what the handler persists
vi.mock('@/services/providers/WalletState', () => ({
  setWalletState: vi.fn(),
  getWalletState: vi.fn(),
  clearWalletState: vi.fn(),
}));

// Mock networkConfig so CURRENT_NETWORK resolves deterministically.
vi.mock('@/entrypoints/popup/config/networkConfig', () => ({
  CURRENT_NETWORK: 'preprod',
  getNetworkConfig: () => ({
    networkId: 'preprod',
    indexerUrl: 'https://indexer.test/api/v4/graphql',
    wsIndexerUrl: 'wss://indexer.test/api/v4/graphql/ws',
    nodeUrl: 'https://rpc.test',
    proofServerUrl: 'https://proof.test',
  }),
  getWalletNetworkConfig: vi.fn(),
}));

// fakeBrowser from wxt/testing does not ship a scripting API. Attach one
// before the handler imports resolve `browser.scripting.executeScript`.
const mockExecuteScript = vi.fn();
(fakeBrowser as any).scripting = { executeScript: mockExecuteScript };

import { setWalletState } from '@/services/providers/WalletState';
import {
  handleDetectLaceWallet,
  handleConnectLaceWallet,
  handleSignChallenge,
  handleGetWalletServiceUris,
} from '../WalletMessageHandler';

const mockSetWalletState = setWalletState as unknown as Mock;
// Spy on fakeBrowser.tabs.query so we can control the per-test return value.
const mockTabsQuery = vi.spyOn(fakeBrowser.tabs, 'query');

/**
 * Helpers to run the `func` passed to browser.scripting.executeScript
 * against a fake `window.midnight` shape. Mirrors the MAIN-world behavior.
 */
function runInjectedFunc<TArgs extends unknown[], TResult>(
  fakeMidnight: unknown,
  call: { func: (...args: TArgs) => TResult | Promise<TResult>; args?: TArgs },
): Promise<TResult> {
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = { midnight: fakeMidnight };
  try {
    return Promise.resolve(call.func(...(call.args ?? ([] as unknown as TArgs))));
  } finally {
    (globalThis as any).window = originalWindow;
  }
}

/**
 * Make browser.scripting.executeScript invoke the passed func and wrap the
 * result the way chrome does: [{ result: <return value> }].
 */
function makeExecuteScriptInvoker(fakeMidnight: unknown) {
  return async (call: { func: (...args: unknown[]) => unknown; args?: unknown[] }) => {
    const result = await runInjectedFunc(fakeMidnight, call as any);
    return [{ result }];
  };
}

describe('WalletMessageHandler', () => {
  beforeEach(() => {
    mockTabsQuery.mockReset();
    mockExecuteScript.mockReset();
    mockSetWalletState.mockReset();
    // Default: active tab available on an http page.
    mockTabsQuery.mockResolvedValue([{ id: 42, url: 'https://example.com' }] as any);
  });

  // ---------------------------------------------------------------------------
  // handleDetectLaceWallet
  // ---------------------------------------------------------------------------

  describe('handleDetectLaceWallet', () => {
    it('returns detected=true when window.midnight.mnLace has apiVersion 4.x', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({ mnLace: { apiVersion: '4.0.1' } }),
      );

      const result = await handleDetectLaceWallet();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ detected: true, apiVersion: '4.0.1' });
    });

    it('returns detected=true when wallet is registered under a UUID key (Lace v4+)', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          'some-uuid-abc': { apiVersion: '4.2.0', name: 'Lace' },
        }),
      );

      const result = await handleDetectLaceWallet();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ detected: true, apiVersion: '4.2.0' });
    });

    it('returns detected=false when only a v3.x wallet is present', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({ mnLace: { apiVersion: '3.1.5' } }),
      );

      const result = await handleDetectLaceWallet();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ detected: false });
    });

    it('finds v4 UUID wallet even when mnLace is v3 (regression: selection must not prefer mnLace blindly)', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: { apiVersion: '3.1.5', name: 'Legacy Lace' },
          'uuid-new-v4': { apiVersion: '4.0.1', name: 'Lace' },
        }),
      );

      const result = await handleDetectLaceWallet();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ detected: true, apiVersion: '4.0.1' });
    });

    it('returns detected=false when window.midnight is missing', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker(undefined),
      );

      const result = await handleDetectLaceWallet();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ detected: false });
    });

    it('rejects injection into browser-internal pages', async () => {
      mockTabsQuery.mockResolvedValue([{ id: 7, url: 'chrome://extensions' }] as any);

      const result = await handleDetectLaceWallet();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/regular web page/i);
      expect(mockExecuteScript).not.toHaveBeenCalled();
    });

    it('returns an error when no active tab is available', async () => {
      mockTabsQuery.mockResolvedValue([]);
      const result = await handleDetectLaceWallet();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no active tab/i);
    });

    it('surfaces a friendly error when executeScript throws', async () => {
      mockExecuteScript.mockRejectedValue(new Error('scripting forbidden'));
      const result = await handleDetectLaceWallet();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/failed to check/i);
    });
  });

  // ---------------------------------------------------------------------------
  // handleConnectLaceWallet
  // ---------------------------------------------------------------------------

  describe('handleConnectLaceWallet', () => {
    /**
     * Fake a Lace v4 wallet that returns the canonical v4 shape from
     * getShieldedAddresses() / getUnshieldedAddress() / getConfiguration().
     */
    function makeV4Lace() {
      return {
        mnLace: {
          apiVersion: '4.0.1',
          name: 'Lace',
          connect: vi.fn().mockResolvedValue({
            getShieldedAddresses: vi.fn().mockResolvedValue({
              shieldedAddress: 'mn_shield_addr_bech32m',
              shieldedCoinPublicKey: 'mn_shield-cpk_bech32m',
              shieldedEncryptionPublicKey: 'mn_shield-epk_bech32m',
            }),
            getUnshieldedAddress: vi.fn().mockResolvedValue({
              unshieldedAddress: 'mn_addr_bech32m',
            }),
            getConfiguration: vi.fn().mockResolvedValue({
              indexerUri: 'https://wallet-indexer/api/v4/graphql',
              indexerWsUri: 'wss://wallet-indexer/api/v4/graphql/ws',
              proverServerUri: 'https://wallet-prover',
              substrateNodeUri: 'https://wallet-node',
              networkId: 'preprod',
            }),
          }),
        },
      };
    }

    it('returns v4 wallet shape with coinPublicKey from shieldedCoinPublicKey', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker(makeV4Lace()),
      );

      const result = await handleConnectLaceWallet();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      // Regression guard: coinPublicKey MUST come from shieldedCoinPublicKey,
      // NOT from getUnshieldedAddress() (original bug caught in adversarial review).
      expect(result.data?.coinPublicKey).toBe('mn_shield-cpk_bech32m');
      expect(result.data?.encryptionPublicKey).toBe('mn_shield-epk_bech32m');
      expect(result.data?.shieldedAddress).toBe('mn_shield_addr_bech32m');
      expect(result.data?.unshieldedAddress).toBe('mn_addr_bech32m');
      expect(result.data?.address).toBe('mn_shield_addr_bech32m');
    });

    it('captures serviceConfig including substrateNodeUri', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker(makeV4Lace()),
      );

      const result = await handleConnectLaceWallet();
      expect(result.data?.serviceConfig).toEqual({
        indexerUri: 'https://wallet-indexer/api/v4/graphql',
        indexerWsUri: 'wss://wallet-indexer/api/v4/graphql/ws',
        proverServerUri: 'https://wallet-prover',
        substrateNodeUri: 'https://wallet-node',
      });
    });

    it('persists connection state via setWalletState with the stored tab ID', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker(makeV4Lace()),
      );

      await handleConnectLaceWallet();

      expect(mockSetWalletState).toHaveBeenCalledTimes(1);
      expect(mockSetWalletState).toHaveBeenCalledWith(
        expect.objectContaining({
          coinPublicKey: 'mn_shield-cpk_bech32m',
          encryptionPublicKey: 'mn_shield-epk_bech32m',
          shieldedAddress: 'mn_shield_addr_bech32m',
          unshieldedAddress: 'mn_addr_bech32m',
          activeTabId: 42,
          networkId: 'preprod',
        }),
      );
    });

    it('filters by apiVersion 4.x and ignores v3 wallets under UUID keys', async () => {
      const v4Connect = vi.fn().mockResolvedValue({
        getShieldedAddresses: async () => ({
          shieldedAddress: 'mn_shield_addr',
          shieldedCoinPublicKey: 'mn_cpk',
          shieldedEncryptionPublicKey: 'mn_epk',
        }),
        getUnshieldedAddress: async () => ({ unshieldedAddress: 'mn_addr' }),
        getConfiguration: async () => ({
          indexerUri: 'https://i', indexerWsUri: 'wss://i', proverServerUri: 'https://p', substrateNodeUri: 'https://n', networkId: 'preprod',
        }),
      });

      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          'uuid-old': { apiVersion: '3.1.5', connect: vi.fn() },
          'uuid-new': { apiVersion: '4.0.1', connect: v4Connect },
        }),
      );

      const result = await handleConnectLaceWallet();
      expect(result.success).toBe(true);
      expect(v4Connect).toHaveBeenCalledWith('preprod');
    });

    it('picks v4 UUID wallet even when mnLace is v3 (regression: must not prefer mnLace blindly)', async () => {
      // The real failure mode: a user has legacy v3 Lace AND a new v4 wallet.
      // The old selection `midnight.mnLace ?? find(v4) ?? first` short-circuited
      // on mnLace and called v3's connect() instead of the v4 wallet.
      const v3Connect = vi.fn().mockRejectedValue(new Error('should not be called'));
      const v4Connect = vi.fn().mockResolvedValue({
        getShieldedAddresses: async () => ({
          shieldedAddress: 'mn_v4_shield_addr',
          shieldedCoinPublicKey: 'mn_v4_cpk',
          shieldedEncryptionPublicKey: 'mn_v4_epk',
        }),
        getUnshieldedAddress: async () => ({ unshieldedAddress: 'mn_v4_addr' }),
        getConfiguration: async () => ({
          indexerUri: 'https://i', indexerWsUri: 'wss://i', proverServerUri: 'https://p', substrateNodeUri: 'https://n', networkId: 'preprod',
        }),
      });

      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: { apiVersion: '3.1.5', name: 'Legacy Lace', connect: v3Connect },
          'uuid-new-v4': { apiVersion: '4.0.1', name: 'Lace', connect: v4Connect },
        }),
      );

      const result = await handleConnectLaceWallet();
      expect(result.success).toBe(true);
      expect(v3Connect).not.toHaveBeenCalled();
      expect(v4Connect).toHaveBeenCalledWith('preprod');
      expect(result.data?.coinPublicKey).toBe('mn_v4_cpk');
    });

    it('rejects when only a v3 mnLace is present (no v4 fallback)', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: { apiVersion: '3.1.5', name: 'Legacy Lace', connect: vi.fn() },
        }),
      );

      const result = await handleConnectLaceWallet();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/v4-compatible/i);
    });

    it('returns an error when window.midnight is missing', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker(undefined),
      );
      const result = await handleConnectLaceWallet();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/window\.midnight not found/i);
    });

    it('returns an error when the wallet has no connect() method', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({ mnLace: { apiVersion: '4.0.1', name: 'Broken' } }),
      );
      const result = await handleConnectLaceWallet();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no connect\(\) method/i);
    });

    it('propagates connect() rejection messages (user declined)', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: {
            apiVersion: '4.0.1',
            name: 'Lace',
            connect: vi.fn().mockRejectedValue(new Error('user declined')),
          },
        }),
      );

      const result = await handleConnectLaceWallet();
      expect(result.success).toBe(false);
      expect(result.error).toBe('user declined');
    });

    it('returns an error when the wallet exposes no addresses', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: {
            apiVersion: '4.0.1',
            name: 'Lace',
            connect: vi.fn().mockResolvedValue({
              getShieldedAddresses: async () => null,
              getUnshieldedAddress: async () => null,
              getConfiguration: async () => ({
                indexerUri: 'i', indexerWsUri: 'iw', proverServerUri: 'p', substrateNodeUri: 'n', networkId: 'preprod',
              }),
            }),
          },
        }),
      );
      const result = await handleConnectLaceWallet();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/could not retrieve wallet address/i);
    });
  });

  // ---------------------------------------------------------------------------
  // handleSignChallenge
  // ---------------------------------------------------------------------------

  describe('handleSignChallenge', () => {
    it('returns a signature when v4 signData succeeds', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: {
            apiVersion: '4.0.1',
            connect: vi.fn().mockResolvedValue({
              getShieldedAddresses: async () => ({
                shieldedAddress: 'mn_shield_addr',
                shieldedCoinPublicKey: 'mn_cpk',
                shieldedEncryptionPublicKey: 'mn_epk',
              }),
              signData: vi.fn().mockResolvedValue({
                data: 'chg',
                signature: 'sig-abc-123',
                verifyingKey: 'vkey-xyz-456',
              }),
            }),
          },
        }),
      );

      const result = await handleSignChallenge({ challenge: 'chg' });
      expect(result.success).toBe(true);
      expect(result.data?.signature).toBe('sig-abc-123');
      expect(result.data?.publicKey).toBe('vkey-xyz-456');
      expect(result.data?.challenge).toBe('chg');
    });

    it('passes challenge + v4 SignDataOptions to signData', async () => {
      const signData = vi.fn().mockResolvedValue({
        data: 'chg',
        signature: 'sig',
        verifyingKey: 'vkey',
      });
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: {
            apiVersion: '4.0.1',
            connect: vi.fn().mockResolvedValue({
              getShieldedAddresses: async () => ({
                shieldedAddress: 'mn_shield_addr',
                shieldedCoinPublicKey: 'mn_cpk',
                shieldedEncryptionPublicKey: 'mn_epk',
              }),
              signData,
            }),
          },
        }),
      );

      await handleSignChallenge({ challenge: 'chg' });

      // v4 signature: signData(data: string, { encoding, keyType })
      expect(signData).toHaveBeenCalledWith('chg', { encoding: 'text', keyType: 'unshielded' });
    });

    it('fails with an error when signData throws (no connection-proof fallback)', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: {
            apiVersion: '4.0.1',
            connect: vi.fn().mockResolvedValue({
              getShieldedAddresses: async () => ({
                shieldedAddress: 'mn_shield_addr',
                shieldedCoinPublicKey: 'mn_cpk',
                shieldedEncryptionPublicKey: 'mn_epk',
              }),
              signData: vi.fn().mockRejectedValue(new Error('user rejected')),
            }),
          },
        }),
      );

      const result = await handleSignChallenge({ challenge: 'chg' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/user rejected/);
    });

    it('fails with an error when signData is not a function (no connection-proof fallback)', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: {
            apiVersion: '4.0.1',
            connect: vi.fn().mockResolvedValue({
              getShieldedAddresses: async () => ({
                shieldedAddress: 'mn_shield_addr',
                shieldedCoinPublicKey: 'mn_cpk',
                shieldedEncryptionPublicKey: 'mn_epk',
              }),
              // signData omitted on purpose
            }),
          },
        }),
      );

      const result = await handleSignChallenge({ challenge: 'chg' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/signData|cryptographic/i);
    });

    it('fails with an error when signData returns an empty signature (no fallback)', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: {
            apiVersion: '4.0.1',
            connect: vi.fn().mockResolvedValue({
              getShieldedAddresses: async () => ({
                shieldedAddress: 'mn_shield_addr',
                shieldedCoinPublicKey: 'mn_cpk',
                shieldedEncryptionPublicKey: 'mn_epk',
              }),
              signData: vi.fn().mockResolvedValue({ data: 'chg', signature: '', verifyingKey: '' }),
            }),
          },
        }),
      );

      const result = await handleSignChallenge({ challenge: 'chg' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid signature/i);
    });

    it('returns an error when no challenge is supplied', async () => {
      const result = await handleSignChallenge({ challenge: '' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no challenge/i);
      expect(mockExecuteScript).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // handleGetWalletServiceUris
  // ---------------------------------------------------------------------------

  describe('handleGetWalletServiceUris', () => {
    it('returns the full v4 Configuration shape including substrateNodeUri', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: {
            apiVersion: '4.0.1',
            connect: vi.fn().mockResolvedValue({
              getConfiguration: vi.fn().mockResolvedValue({
                indexerUri: 'https://wallet-indexer/api/v4/graphql',
                indexerWsUri: 'wss://wallet-indexer/api/v4/graphql/ws',
                proverServerUri: 'https://wallet-prover',
                substrateNodeUri: 'https://wallet-node',
                networkId: 'preprod',
              }),
            }),
          },
        }),
      );

      const result = await handleGetWalletServiceUris();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        indexerUri: 'https://wallet-indexer/api/v4/graphql',
        indexerWsUri: 'wss://wallet-indexer/api/v4/graphql/ws',
        proverServerUri: 'https://wallet-prover',
        substrateNodeUri: 'https://wallet-node',
      });
    });

    it('returns empty strings for fields the wallet omits', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: {
            apiVersion: '4.0.1',
            connect: vi.fn().mockResolvedValue({
              getConfiguration: vi.fn().mockResolvedValue({
                indexerUri: 'https://only-indexer',
                // everything else missing
              }),
            }),
          },
        }),
      );

      const result = await handleGetWalletServiceUris();
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        indexerUri: 'https://only-indexer',
        indexerWsUri: '',
        proverServerUri: '',
        substrateNodeUri: '',
      });
    });

    it('surfaces errors from getConfiguration', async () => {
      mockExecuteScript.mockImplementation(
        makeExecuteScriptInvoker({
          mnLace: {
            apiVersion: '4.0.1',
            connect: vi.fn().mockResolvedValue({
              getConfiguration: vi.fn().mockRejectedValue(new Error('wallet offline')),
            }),
          },
        }),
      );

      const result = await handleGetWalletServiceUris();
      expect(result.success).toBe(false);
      expect(result.error).toBe('wallet offline');
    });
  });
});
