import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

// Mutable wallet state for per-test control
let mockIsConnected = false;

vi.mock('../../context/WalletContext', () => ({
  WalletProvider: ({ children }: { children: React.ReactNode }) => children,
  useWallet: () => ({
    isConnected: mockIsConnected,
    address: mockIsConnected ? 'addr_test1_mock' : null,
    isConnecting: false,
    error: null,
    isWalletDetected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock('../../services/ipfsService', () => ({
  fetchRecoveryMetadata: vi.fn(),
}));

vi.mock('../../services/guardianKeyService', () => ({
  loadGuardianKeys: vi.fn(),
  getGuardianKeyBytes: vi.fn(() => new Uint8Array(32)),
}));

vi.mock('../../services/midnightService', () => ({
  joinContract: vi.fn(),
  getContractState: vi.fn(),
  isGuardian: vi.fn(),
  GUARDIAN_THRESHOLD: 2,
}));

vi.mock('../../services/shareReleaseService', () => ({
  fetchSharePackage: vi.fn(),
  findGuardianShareIndex: vi.fn(),
  decryptGuardianShare: vi.fn(),
  canReleaseShare: vi.fn(),
}));

vi.mock('../../config/networkConfig', () => ({
  getNetworkConfig: vi.fn(() => ({
    networkId: 'undeployed',
    indexerUrl: 'http://localhost:8088/api/v3/graphql',
    wsIndexerUrl: 'ws://localhost:8088/api/v3/graphql/ws',
    nodeUrl: 'http://localhost:9944',
    proofServerUrl: 'http://localhost:6300',
  })),
}));

vi.mock('@aliasvault/vault-sync', () => ({
  bytesToHex: vi.fn((arr: Uint8Array) =>
    Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join(''),
  ),
  hexToUint8Array: vi.fn((hex: string) => {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return arr;
  }),
}));

import { ReleaseSharePage } from '../ReleaseSharePage';
import { fetchRecoveryMetadata } from '../../services/ipfsService';
import { loadGuardianKeys } from '../../services/guardianKeyService';
import { joinContract, getContractState, isGuardian } from '../../services/midnightService';
import {
  fetchSharePackage,
  findGuardianShareIndex,
  decryptGuardianShare,
  canReleaseShare,
} from '../../services/shareReleaseService';
import type { RecoveryShareFile } from '@aliasvault/vault-sync';

const mockFetchMetadata = vi.mocked(fetchRecoveryMetadata);
const mockLoadKeys = vi.mocked(loadGuardianKeys);
const mockJoinContract = vi.mocked(joinContract);
const mockGetContractState = vi.mocked(getContractState);
const mockIsGuardian = vi.mocked(isGuardian);
const mockFetchSharePackage = vi.mocked(fetchSharePackage);
const mockFindGuardianShareIndex = vi.mocked(findGuardianShareIndex);
const mockDecryptGuardianShare = vi.mocked(decryptGuardianShare);
const mockCanReleaseShare = vi.mocked(canReleaseShare);

const testMetadata = {
  version: 1 as const,
  contractAddress: 'contract-release-001',
  networkId: 'undeployed',
  vaultOwnerCommitment: 'aabbccdd',
  sharesCid: 'bafysharepackagecid123',
};

const testKeys = {
  guardianKeyHex: 'aa'.repeat(32),
  rsaPublicKey: { kty: 'RSA' as const, n: 'test-n', e: 'AQAB' },
  rsaPrivateKey: { kty: 'RSA' as const, n: 'test-n', e: 'AQAB', d: 'test-d' },
  commitment: 'bb'.repeat(32),
};

const testContractState = {
  owner: new Uint8Array(32).fill(0xaa),
  guardianCount: 3n,
  recoveryInitiatedAt: BigInt(Math.floor(Date.now() / 1000) - 300_000),
  sharesCidHash: new Uint8Array(32).fill(0xcc),
  recoveryComplete: false,
  approvalCount: 2,
};

const mockHandle = { deployTxData: { public: {} } } as unknown as ReturnType<typeof joinContract> extends Promise<infer T> ? T : never;

function renderWithRouter(cid: string) {
  return render(
    <MemoryRouter initialEntries={[`/release/${cid}`]}>
      <Routes>
        <Route path="/release/:cid" element={<ReleaseSharePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConnected = false;
});

describe('ReleaseSharePage', () => {
  it('shows loading state initially', () => {
    mockFetchMetadata.mockReturnValue(new Promise(() => {})); // Never resolves
    renderWithRouter('bafytestcid123');
    expect(screen.getByTestId('loading')).toBeDefined();
    expect(screen.getByText('Loading recovery request...')).toBeDefined();
  });

  it('shows error when metadata fetch fails', async () => {
    mockFetchMetadata.mockRejectedValue(new Error('CIDv0 detected'));
    renderWithRouter('bafytestcid123');
    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeDefined();
    });
    expect(screen.getByText('CIDv0 detected')).toBeDefined();
  });

  it('shows wallet connect prompt after metadata loaded', async () => {
    mockFetchMetadata.mockResolvedValue(testMetadata);
    renderWithRouter('bafytestcid123');
    await waitFor(() => {
      expect(screen.getByText('Release Share')).toBeDefined();
    });
    expect(screen.getByText('Connect your wallet to continue.')).toBeDefined();
  });

  it('shows no-keys message when guardian keys not found', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(null);

    renderWithRouter('bafytestcid123');
    await waitFor(() => {
      expect(screen.getByTestId('no-keys')).toBeDefined();
    });
    expect(screen.getByText('Guardian Keys Not Found')).toBeDefined();
  });

  it('shows not-guardian message when commitment not registered', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle as any);
    mockIsGuardian.mockReturnValue(false);

    renderWithRouter('bafytestcid123');
    await waitFor(() => {
      expect(screen.getByTestId('not-guardian')).toBeDefined();
    });
    expect(screen.getByText('Not a Registered Guardian')).toBeDefined();
  });

  it('shows cannot-release reason when time-lock not expired', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle as any);
    mockIsGuardian.mockReturnValue(true);
    mockGetContractState.mockReturnValue(testContractState);
    mockCanReleaseShare.mockReturnValue({
      canRelease: false,
      reason: 'Time-lock not expired: 12h 30m remaining',
    });

    renderWithRouter('bafytestcid123');
    await waitFor(() => {
      expect(screen.getByTestId('cannot-release')).toBeDefined();
    });
    expect(screen.getByText('Time-lock not expired: 12h 30m remaining')).toBeDefined();
  });

  it('shows cannot-release reason when recovery already completed', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle as any);
    mockIsGuardian.mockReturnValue(true);
    mockGetContractState.mockReturnValue({
      ...testContractState,
      recoveryComplete: true,
    });
    mockCanReleaseShare.mockReturnValue({
      canRelease: false,
      reason: 'Recovery already completed',
    });

    renderWithRouter('bafytestcid123');
    await waitFor(() => {
      expect(screen.getByTestId('cannot-release')).toBeDefined();
    });
    expect(screen.getByText('Recovery already completed')).toBeDefined();
  });

  it('shows release button when canRelease is true', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle as any);
    mockIsGuardian.mockReturnValue(true);
    mockGetContractState.mockReturnValue(testContractState);
    mockCanReleaseShare.mockReturnValue({ canRelease: true });

    renderWithRouter('bafytestcid123');
    await waitFor(() => {
      expect(screen.getByTestId('release-button')).toBeDefined();
    });
    expect(screen.getByText('Release My Share')).toBeDefined();
  });

  it('successful share release flow: shows released share JSON', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle as any);
    mockIsGuardian.mockReturnValue(true);
    mockGetContractState.mockReturnValue(testContractState);
    mockCanReleaseShare.mockReturnValue({ canRelease: true });

    const shareFile: RecoveryShareFile = {
      version: 1,
      shareIndex: 1,
      shareHex: 'deadbeef1234',
    };

    const mockSharePackage = {
      version: 2 as const,
      vaultOwnerCommitment: 'aabbccdd',
      threshold: 2,
      totalShares: 3,
      encryptedPassword: 'encdata',
      shares: [
        { index: 0, encryptedShare: 's0' },
        { index: 1, encryptedShare: 's1' },
        { index: 2, encryptedShare: 's2' },
      ],
    };

    mockFetchSharePackage.mockResolvedValue(mockSharePackage);
    mockFindGuardianShareIndex.mockResolvedValue(1);
    mockDecryptGuardianShare.mockResolvedValue(shareFile);

    renderWithRouter('bafytestcid123');

    // Wait for release button
    await waitFor(() => {
      expect(screen.getByTestId('release-button')).toBeDefined();
    });

    // Click release
    fireEvent.click(screen.getByTestId('release-button'));

    // Wait for released state
    await waitFor(() => {
      expect(screen.getByTestId('released')).toBeDefined();
    });

    expect(screen.getByText('Share Released')).toBeDefined();
    expect(screen.getByTestId('share-json')).toBeDefined();
    expect(screen.getByText(/Send this file to the vault owner/)).toBeDefined();
    expect(screen.getByTestId('copy-button')).toBeDefined();
    expect(screen.getByTestId('download-button')).toBeDefined();
  });

  it('copy-to-clipboard button calls navigator.clipboard.writeText', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle as any);
    mockIsGuardian.mockReturnValue(true);
    mockGetContractState.mockReturnValue(testContractState);
    mockCanReleaseShare.mockReturnValue({ canRelease: true });

    const shareFile: RecoveryShareFile = { version: 1, shareIndex: 0, shareHex: 'aabb' };
    mockFetchSharePackage.mockResolvedValue({
      version: 2,
      vaultOwnerCommitment: 'x',
      threshold: 2,
      totalShares: 3,
      encryptedPassword: 'e',
      shares: [{ index: 0, encryptedShare: 's' }],
    });
    mockFindGuardianShareIndex.mockResolvedValue(0);
    mockDecryptGuardianShare.mockResolvedValue(shareFile);

    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

    renderWithRouter('bafytestcid123');
    await waitFor(() => screen.getByTestId('release-button'));
    fireEvent.click(screen.getByTestId('release-button'));
    await waitFor(() => screen.getByTestId('copy-button'));

    fireEvent.click(screen.getByTestId('copy-button'));

    expect(mockWriteText).toHaveBeenCalledWith(JSON.stringify(shareFile, null, 2));
  });

  it('download-as-file button creates a downloadable blob', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle as any);
    mockIsGuardian.mockReturnValue(true);
    mockGetContractState.mockReturnValue(testContractState);
    mockCanReleaseShare.mockReturnValue({ canRelease: true });

    const shareFile: RecoveryShareFile = { version: 1, shareIndex: 2, shareHex: 'ccdd' };
    mockFetchSharePackage.mockResolvedValue({
      version: 2,
      vaultOwnerCommitment: 'x',
      threshold: 2,
      totalShares: 3,
      encryptedPassword: 'e',
      shares: [{ index: 2, encryptedShare: 's' }],
    });
    mockFindGuardianShareIndex.mockResolvedValue(2);
    mockDecryptGuardianShare.mockResolvedValue(shareFile);

    const mockCreateObjectURL = vi.fn(() => 'blob:test');
    const mockRevokeObjectURL = vi.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    const mockClick = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click: mockClick } as unknown as HTMLAnchorElement;
      }
      return originalCreateElement(tag);
    });

    renderWithRouter('bafytestcid123');
    await waitFor(() => screen.getByTestId('release-button'));
    fireEvent.click(screen.getByTestId('release-button'));
    await waitFor(() => screen.getByTestId('download-button'));

    fireEvent.click(screen.getByTestId('download-button'));

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test');

    createElementSpy.mockRestore();
  });

  it('shows error when share release fails', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle as any);
    mockIsGuardian.mockReturnValue(true);
    mockGetContractState.mockReturnValue(testContractState);
    mockCanReleaseShare.mockReturnValue({ canRelease: true });

    mockFetchSharePackage.mockRejectedValue(new Error('IPFS fetch failed'));

    renderWithRouter('bafytestcid123');
    await waitFor(() => screen.getByTestId('release-button'));
    fireEvent.click(screen.getByTestId('release-button'));

    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeDefined();
    });
    expect(screen.getByText('IPFS fetch failed')).toBeDefined();
  });

  it('shows error when contract join fails', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockRejectedValue(new Error('Network timeout'));

    renderWithRouter('bafytestcid123');
    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeDefined();
    });
    expect(screen.getByText('Network timeout')).toBeDefined();
  });
});
