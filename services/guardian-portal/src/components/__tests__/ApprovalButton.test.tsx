import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApprovalButton } from '../ApprovalButton';

describe('ApprovalButton', () => {
  it('renders approve button', () => {
    render(<ApprovalButton onApprove={vi.fn()} disabled={false} />);
    expect(screen.getByTestId('approve-button')).toBeDefined();
    expect(screen.getByText('Approve Recovery')).toBeDefined();
  });

  it('is disabled when disabled prop is true', () => {
    render(<ApprovalButton onApprove={vi.fn()} disabled={true} disabledReason="Already approved" />);
    const button = screen.getByTestId('approve-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('disabled-reason').textContent).toBe('Already approved');
  });

  it('calls onApprove and shows success on successful approval', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<ApprovalButton onApprove={onApprove} disabled={false} />);

    fireEvent.click(screen.getByTestId('approve-button'));

    await waitFor(() => {
      expect(screen.getByTestId('approval-success')).toBeDefined();
    });
    expect(onApprove).toHaveBeenCalled();
  });

  it('shows error on failed approval', async () => {
    const onApprove = vi.fn().mockRejectedValue(new Error('Proof generation failed'));
    render(<ApprovalButton onApprove={onApprove} disabled={false} />);

    fireEvent.click(screen.getByTestId('approve-button'));

    await waitFor(() => {
      expect(screen.getByTestId('approval-error')).toBeDefined();
    });
    expect(screen.getByText('Proof generation failed')).toBeDefined();
  });

  it('shows submitting state during approval', async () => {
    let resolveApproval: () => void;
    const approvalPromise = new Promise<void>((resolve) => { resolveApproval = resolve; });
    const onApprove = vi.fn().mockReturnValue(approvalPromise);

    render(<ApprovalButton onApprove={onApprove} disabled={false} />);
    fireEvent.click(screen.getByTestId('approve-button'));

    expect(screen.getByText('Submitting approval...')).toBeDefined();
    resolveApproval!();
    await waitFor(() => {
      expect(screen.getByTestId('approval-success')).toBeDefined();
    });
  });
});
