import { useState } from 'react';

interface ApprovalButtonProps {
  onApprove: () => Promise<void>;
  disabled: boolean;
  disabledReason?: string;
}

export function ApprovalButton({ onApprove, disabled, disabledReason }: ApprovalButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsSubmitting(true);
    setError(null);
    try {
      await onApprove();
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <div data-testid="approval-success">
        <p>Your approval has been recorded on-chain.</p>
      </div>
    );
  }

  return (
    <div data-testid="approval-button-container">
      <button
        data-testid="approve-button"
        onClick={handleClick}
        disabled={disabled || isSubmitting}
        title={disabledReason}
      >
        {isSubmitting ? 'Submitting approval...' : 'Approve Recovery'}
      </button>
      {disabledReason && disabled && <p data-testid="disabled-reason">{disabledReason}</p>}
      {error && <p data-testid="approval-error">{error}</p>}
    </div>
  );
}
