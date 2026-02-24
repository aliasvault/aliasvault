import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock wallet context
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();

let mockWalletState = {
  isConnected: false,
  address: null as string | null,
  isConnecting: false,
  error: null as string | null,
  isWalletDetected: true,
  connect: mockConnect,
  disconnect: mockDisconnect,
};

vi.mock('../../context/WalletContext', () => ({
  useWallet: () => mockWalletState,
}));

vi.mock('../../config/networkConfig', () => ({
  CURRENT_NETWORK: 'undeployed',
}));

import { WalletConnect } from '../WalletConnect';

describe('WalletConnect', () => {
  it('shows connect button when not connected', () => {
    mockWalletState = { ...mockWalletState, isConnected: false, address: null, isWalletDetected: true };
    render(<WalletConnect />);
    expect(screen.getByText('Connect Lace Wallet')).toBeDefined();
  });

  it('shows wallet not detected message when Lace is missing', () => {
    mockWalletState = { ...mockWalletState, isWalletDetected: false };
    render(<WalletConnect />);
    expect(screen.getByTestId('wallet-not-detected')).toBeDefined();
  });

  it('shows connected address when wallet is connected', () => {
    mockWalletState = { ...mockWalletState, isConnected: true, address: 'addr_test1qz0x7nqc4hdz_long_address', isWalletDetected: true };
    render(<WalletConnect />);
    expect(screen.getByTestId('wallet-connected')).toBeDefined();
  });

  it('calls connect when button clicked', () => {
    mockWalletState = { ...mockWalletState, isConnected: false, address: null, isWalletDetected: true };
    render(<WalletConnect />);
    fireEvent.click(screen.getByText('Connect Lace Wallet'));
    expect(mockConnect).toHaveBeenCalledWith('undeployed');
  });

  it('shows error message when error exists', () => {
    mockWalletState = { ...mockWalletState, isConnected: false, address: null, isWalletDetected: true, error: 'Connection failed' };
    render(<WalletConnect />);
    expect(screen.getByTestId('wallet-error')).toBeDefined();
    expect(screen.getByText('Connection failed')).toBeDefined();
  });

  it('disables button while connecting', () => {
    mockWalletState = { ...mockWalletState, isConnected: false, isConnecting: true, isWalletDetected: true, error: null };
    render(<WalletConnect />);
    expect(screen.getByText('Connecting...')).toBeDefined();
  });

  it('uses provided networkId instead of CURRENT_NETWORK', () => {
    mockWalletState = { ...mockWalletState, isConnected: false, address: null, isConnecting: false, isWalletDetected: true, error: null };
    render(<WalletConnect networkId="preprod" />);
    fireEvent.click(screen.getByText('Connect Lace Wallet'));
    expect(mockConnect).toHaveBeenCalledWith('preprod');
  });
});
