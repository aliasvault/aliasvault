import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecoveryDetails } from '../RecoveryDetails';

describe('RecoveryDetails', () => {
  const defaultProps = {
    ownerCommitment: 'aabbccdd11223344556677889900aabbccdd11223344556677889900aabbccdd',
    recoveryInitiatedAt: BigInt(Math.floor(Date.now() / 1000) - 3600), // 1 hour ago
    approvalCount: 1,
    threshold: 2,
    recoveryComplete: false,
    hasCurrentGuardianApproved: false,
  };

  it('renders recovery details', () => {
    render(<RecoveryDetails {...defaultProps} />);
    expect(screen.getByTestId('recovery-details')).toBeDefined();
    expect(screen.getByTestId('owner-commitment')).toBeDefined();
    expect(screen.getByTestId('approval-count')).toBeDefined();
    expect(screen.getByTestId('countdown')).toBeDefined();
  });

  it('shows truncated owner commitment', () => {
    render(<RecoveryDetails {...defaultProps} />);
    const el = screen.getByTestId('owner-commitment');
    expect(el.textContent).toContain('aabbccdd11223344');
    expect(el.textContent).toContain('aabbccdd');
  });

  it('shows approval count', () => {
    render(<RecoveryDetails {...defaultProps} />);
    expect(screen.getByTestId('approval-count').textContent).toContain('1 of 2 required');
  });

  it('shows "you approved" when guardian has approved', () => {
    render(<RecoveryDetails {...defaultProps} hasCurrentGuardianApproved={true} />);
    expect(screen.getByTestId('approval-count').textContent).toContain('(you approved)');
  });

  it('shows Pending status when below threshold', () => {
    render(<RecoveryDetails {...defaultProps} />);
    expect(screen.getByTestId('recovery-status').textContent).toBe('Pending');
  });

  it('shows Completed status', () => {
    render(<RecoveryDetails {...defaultProps} recoveryComplete={true} />);
    expect(screen.getByTestId('recovery-status').textContent).toBe('Completed');
  });

  it('shows countdown timer with valid format', () => {
    render(<RecoveryDetails {...defaultProps} />);
    const countdown = screen.getByTestId('countdown').textContent!;
    // Should show HH:MM:SS format (recovery is 1h old, 71h remaining)
    expect(countdown).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('shows "No active recovery" when recoveryInitiatedAt is 0n', () => {
    render(<RecoveryDetails {...defaultProps} recoveryInitiatedAt={0n} />);
    expect(screen.getByTestId('recovery-status').textContent).toBe('No active recovery');
    expect(screen.getByTestId('countdown').textContent).toBe('N/A');
  });

  it('shows "Expired (claimable)" when countdown has expired', () => {
    // Set recoveryInitiatedAt to >72h ago so the countdown is expired
    const longAgo = BigInt(Math.floor(Date.now() / 1000) - 260000); // ~72.2 hours ago
    render(
      <RecoveryDetails
        {...defaultProps}
        recoveryInitiatedAt={longAgo}
        approvalCount={2}
        threshold={2}
      />,
    );
    expect(screen.getByTestId('countdown').textContent).toBe('Expired (claimable)');
    expect(screen.getByTestId('recovery-status').textContent).toBe('Claimable');
  });

  it('shows "Approved (waiting for time-lock)" when threshold met but not expired', () => {
    render(
      <RecoveryDetails
        {...defaultProps}
        approvalCount={2}
        threshold={2}
      />,
    );
    expect(screen.getByTestId('recovery-status').textContent).toBe('Approved (waiting for time-lock)');
  });
});
