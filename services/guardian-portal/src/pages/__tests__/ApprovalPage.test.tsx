import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mock all services
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
  hasApproved: vi.fn(),
  approveRecovery: vi.fn(),
  GUARDIAN_THRESHOLD: 2,
}));

vi.mock('../../config/networkConfig', () => ({
  getNetworkConfig: vi.fn().mockReturnValue({
    networkId: 'undeployed',
    indexerUrl: 'http://localhost:8088',
    wsIndexerUrl: 'ws://localhost:8088',
    nodeUrl: 'http://localhost:9944',
    proofServerUrl: 'http://localhost:6300',
  }),
  CURRENT_NETWORK: 'undeployed',
}));

vi.mock('@aliasvault/vault-sync', () => ({
  bytesToHex: vi.fn((arr: Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')),
  hexToUint8Array: vi.fn((hex: string) => {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return arr;
  }),
}));

// Mock wallet context to control isConnected independently
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

// Mock wallet detection for WalletProvider
Object.defineProperty(window, 'midnight', {
  value: { mnLace: {} },
  writable: true,
  configurable: true,
});

import { ApprovalPage } from '../ApprovalPage';
import { fetchRecoveryMetadata } from '../../services/ipfsService';
import { loadGuardianKeys } from '../../services/guardianKeyService';
import { joinContract, getContractState, isGuardian, hasApproved } from '../../services/midnightService';

const mockFetchMetadata = vi.mocked(fetchRecoveryMetadata);
const mockLoadKeys = vi.mocked(loadGuardianKeys);
const mockJoinContract = vi.mocked(joinContract);
const mockGetContractState = vi.mocked(getContractState);
const mockIsGuardian = vi.mocked(isGuardian);
const mockHasApproved = vi.mocked(hasApproved);

const testMetadata = {
  version: 1 as const,
  contractAddress: 'contract-001',
  networkId: 'undeployed',
  vaultOwnerCommitment: 'aabb',
};

const testKeys = {
  guardianKeyHex: 'aa'.repeat(32),
  rsaPublicKey: { kty: 'RSA' as const, n: 'test-n', e: 'AQAB' },
  rsaPrivateKey: { kty: 'RSA' as const, n: 'test-n', e: 'AQAB', d: 'test-d' },
  commitment: 'bb'.repeat(32),
};

const mockHandle = { deployTxData: { public: {} }, callTx: {} } as ReturnType<typeof joinContract> extends Promise<infer T> ? T : never;

function renderWithRouter(cid: string) {
  return render(
    <MemoryRouter initialEntries={[`/approve/${cid}`]}>
      <Routes>
        <Route path="/approve/:cid" element={<ApprovalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ApprovalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected = false;
  });

  it('shows loading state initially', () => {
    mockFetchMetadata.mockReturnValue(new Promise(() => {})); // Never resolves
    renderWithRouter('bafytest123');
    expect(screen.getByTestId('loading')).toBeDefined();
  });

  it('shows error when metadata fetch fails', async () => {
    mockFetchMetadata.mockRejectedValue(new Error('CIDv0 detected'));
    renderWithRouter('QmInvalid');

    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeDefined();
    });
    expect(screen.getByText('CIDv0 detected')).toBeDefined();
  });

  it('shows wallet connect after metadata loaded', async () => {
    mockFetchMetadata.mockResolvedValue(testMetadata);

    renderWithRouter('bafytest123');

    await waitFor(() => {
      expect(screen.getByText('Approve Recovery')).toBeDefined();
    });
    expect(screen.getByText('Connect your wallet to continue.')).toBeDefined();
  });

  it('shows no-keys message when guardian keys not found', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(null);

    renderWithRouter('bafytest456');

    await waitFor(() => {
      expect(screen.getByTestId('no-keys')).toBeDefined();
    });
    expect(screen.getByText('Guardian Keys Not Found')).toBeDefined();
  });

  it('shows not-guardian when commitment is not registered', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle);
    mockIsGuardian.mockReturnValue(false);

    renderWithRouter('bafytest789');

    await waitFor(() => {
      expect(screen.getByTestId('not-guardian')).toBeDefined();
    });
    expect(screen.getByText('Not a Registered Guardian')).toBeDefined();
  });

  it('shows ready state with already-approved guardian', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle);
    mockIsGuardian.mockReturnValue(true);
    mockHasApproved.mockReturnValue(true);
    mockGetContractState.mockReturnValue({
      owner: new Uint8Array(32),
      guardianCount: 2n,
      recoveryInitiatedAt: BigInt(Math.floor(Date.now() / 1000) - 3600),
      sharesCidHash: new Uint8Array(32),
      recoveryComplete: false,
      approvalCount: 1,
    });

    renderWithRouter('bafyready1');

    await waitFor(() => {
      expect(screen.getByText('You have already approved this recovery')).toBeDefined();
    });
  });

  it('shows no-active-recovery when recovery not initiated', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle);
    mockIsGuardian.mockReturnValue(true);
    mockHasApproved.mockReturnValue(false);
    mockGetContractState.mockReturnValue({
      owner: new Uint8Array(32),
      guardianCount: 2n,
      recoveryInitiatedAt: 0n,
      sharesCidHash: new Uint8Array(32),
      recoveryComplete: false,
      approvalCount: 0,
    });

    renderWithRouter('bafynorecovery');

    await waitFor(() => {
      expect(screen.getByText('No active recovery request')).toBeDefined();
    });
  });

  it('shows recovery-complete disabled reason', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockResolvedValue(mockHandle);
    mockIsGuardian.mockReturnValue(true);
    mockHasApproved.mockReturnValue(false);
    mockGetContractState.mockReturnValue({
      owner: new Uint8Array(32),
      guardianCount: 2n,
      recoveryInitiatedAt: BigInt(Math.floor(Date.now() / 1000) - 3600),
      sharesCidHash: new Uint8Array(32),
      recoveryComplete: true,
      approvalCount: 2,
    });

    renderWithRouter('bafycomplete');

    await waitFor(() => {
      expect(screen.getByText('Recovery already completed')).toBeDefined();
    });
  });

  it('shows error when joinContract fails', async () => {
    mockIsConnected = true;
    mockFetchMetadata.mockResolvedValue(testMetadata);
    mockLoadKeys.mockReturnValue(testKeys);
    mockJoinContract.mockRejectedValue(new Error('Network timeout'));

    renderWithRouter('bafyjoinfail');

    await waitFor(() => {
      expect(screen.getByTestId('error')).toBeDefined();
    });
    expect(screen.getByText('Network timeout')).toBeDefined();
  });
});
