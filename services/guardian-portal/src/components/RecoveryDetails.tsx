import { useState, useEffect } from 'react';

interface RecoveryDetailsProps {
  ownerCommitment: string;
  recoveryInitiatedAt: bigint;
  approvalCount: number;
  threshold: number;
  recoveryComplete: boolean;
  hasCurrentGuardianApproved: boolean;
}

function getCountdown(recoveryInitiatedAt: bigint): { hours: number; minutes: number; seconds: number; expired: boolean } {
  const unlockTime = Number(recoveryInitiatedAt) + 259200; // 72 hours in seconds
  const now = Math.floor(Date.now() / 1000);
  const remaining = unlockTime - now;
  if (remaining <= 0) return { hours: 0, minutes: 0, seconds: 0, expired: true };
  return {
    hours: Math.floor(remaining / 3600),
    minutes: Math.floor((remaining % 3600) / 60),
    seconds: remaining % 60,
    expired: false,
  };
}

// Note: AC #7 specifies a "Cancelled" status, but the on-chain contract resets
// recoveryInitiatedAt to 0 on cancellation — indistinguishable from "never started."
// Adding a dedicated `recoveryCancelled` ledger field is deferred to a future story.
// See: guardian-recovery.compact cancelRecovery() circuit.
function getStatusLabel(
  recoveryInitiatedAt: bigint,
  recoveryComplete: boolean,
  approvalCount: number,
  threshold: number,
): string {
  if (recoveryComplete) return 'Completed';
  if (recoveryInitiatedAt === 0n) return 'No active recovery';
  if (approvalCount < threshold) return 'Pending';
  const countdown = getCountdown(recoveryInitiatedAt);
  if (countdown.expired) return 'Claimable';
  return 'Approved (waiting for time-lock)';
}

export function RecoveryDetails({
  ownerCommitment,
  recoveryInitiatedAt,
  approvalCount,
  threshold,
  recoveryComplete,
  hasCurrentGuardianApproved,
}: RecoveryDetailsProps) {
  const [countdown, setCountdown] = useState(getCountdown(recoveryInitiatedAt));

  useEffect(() => {
    if (recoveryInitiatedAt === 0n || recoveryComplete) return;
    const interval = setInterval(() => {
      const next = getCountdown(recoveryInitiatedAt);
      setCountdown(next);
      if (next.expired) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [recoveryInitiatedAt, recoveryComplete]);

  const status = getStatusLabel(recoveryInitiatedAt, recoveryComplete, approvalCount, threshold);

  const initiatedDate = recoveryInitiatedAt > 0n
    ? new Date(Number(recoveryInitiatedAt) * 1000).toLocaleString()
    : 'N/A';

  return (
    <div data-testid="recovery-details">
      <h3>Recovery Request Details</h3>
      <dl>
        <dt>Vault Owner</dt>
        <dd data-testid="owner-commitment" title={ownerCommitment}>
          {ownerCommitment.slice(0, 16)}...{ownerCommitment.slice(-8)}
        </dd>

        <dt>Initiated</dt>
        <dd>{initiatedDate}</dd>

        <dt>Approvals</dt>
        <dd data-testid="approval-count">
          {approvalCount} of {threshold} required
          {hasCurrentGuardianApproved && ' (you approved)'}
        </dd>

        <dt>Time-Lock</dt>
        <dd data-testid="countdown">
          {recoveryComplete || recoveryInitiatedAt === 0n
            ? 'N/A'
            : countdown.expired
              ? 'Expired (claimable)'
              : `${String(countdown.hours).padStart(2, '0')}:${String(countdown.minutes).padStart(2, '0')}:${String(countdown.seconds).padStart(2, '0')}`}
        </dd>

        <dt>Status</dt>
        <dd data-testid="recovery-status">{status}</dd>
      </dl>
    </div>
  );
}
