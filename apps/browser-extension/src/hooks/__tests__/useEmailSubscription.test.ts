import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject, Subscription } from 'rxjs';
import { setupEmailSubscription } from '../useEmailSubscription';

describe('setupEmailSubscription', () => {
  let stateSubject: Subject<{ data: unknown }>;
  let mockPublicDataProvider: { contractStateObservable: ReturnType<typeof vi.fn> };
  const mockLedger = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stateSubject = new Subject();
    mockPublicDataProvider = {
      contractStateObservable: vi.fn(() => stateSubject.asObservable()),
    };
  });

  it('subscribes to contract state observable', () => {
    const onEmailCountChange = vi.fn();
    const sub = setupEmailSubscription(
      mockPublicDataProvider,
      'test-contract-address',
      onEmailCountChange,
      mockLedger,
    );

    expect(mockPublicDataProvider.contractStateObservable).toHaveBeenCalledWith(
      'test-contract-address',
      { type: 'latest' },
    );
    expect(sub).toBeInstanceOf(Subscription);

    sub.unsubscribe();
  });

  it('calls onEmailCountChange when emailCount changes', () => {
    const onEmailCountChange = vi.fn();
    mockLedger.mockReturnValue({ emailCount: 3, inboxManifestCid: 'bafytest1' });

    const sub = setupEmailSubscription(
      mockPublicDataProvider,
      'test-contract-address',
      onEmailCountChange,
      mockLedger,
    );

    stateSubject.next({ data: 'mock-state-1' });

    expect(mockLedger).toHaveBeenCalledWith('mock-state-1');
    expect(onEmailCountChange).toHaveBeenCalledWith(3, 'bafytest1');

    sub.unsubscribe();
  });

  it('deduplicates emissions with same emailCount', () => {
    const onEmailCountChange = vi.fn();
    mockLedger
      .mockReturnValueOnce({ emailCount: 1, inboxManifestCid: 'bafytest1' })
      .mockReturnValueOnce({ emailCount: 1, inboxManifestCid: 'bafytest1' })
      .mockReturnValueOnce({ emailCount: 2, inboxManifestCid: 'bafytest2' });

    const sub = setupEmailSubscription(
      mockPublicDataProvider,
      'test-contract-address',
      onEmailCountChange,
      mockLedger,
    );

    stateSubject.next({ data: 'state-1' });
    stateSubject.next({ data: 'state-2' }); // same emailCount, should be filtered
    stateSubject.next({ data: 'state-3' }); // different emailCount

    expect(onEmailCountChange).toHaveBeenCalledTimes(2);
    expect(onEmailCountChange).toHaveBeenNthCalledWith(1, 1, 'bafytest1');
    expect(onEmailCountChange).toHaveBeenNthCalledWith(2, 2, 'bafytest2');

    sub.unsubscribe();
  });

  it('does not emit after unsubscribe (cleanup)', () => {
    const onEmailCountChange = vi.fn();
    mockLedger.mockReturnValue({ emailCount: 5, inboxManifestCid: 'bafytest5' });

    const sub = setupEmailSubscription(
      mockPublicDataProvider,
      'test-contract-address',
      onEmailCountChange,
      mockLedger,
    );

    sub.unsubscribe();

    stateSubject.next({ data: 'state-after-unsub' });
    expect(onEmailCountChange).not.toHaveBeenCalled();
  });
});
