/**
 * Email subscription hook — foreground real-time contract state observation.
 * Subscribes to VaultRegistry contractStateObservable() while popup is open.
 * Detects emailCount changes and triggers manifest re-fetch.
 *
 * Uses RxJS pipe with distinctUntilChanged to deduplicate emissions.
 * Only subscribes when user has email feature enabled (emailPublicKey set).
 */

import { useEffect, useRef } from 'react';
import { map, distinctUntilChanged, Subscription } from 'rxjs';

/**
 * Core subscription logic — extracted for testability.
 * Sets up RxJS subscription to contractStateObservable, filters by emailCount changes.
 *
 * @param publicDataProvider - Provider with contractStateObservable method
 * @param contractAddress - VaultRegistry contract address
 * @param onEmailCountChange - Callback when emailCount changes
 * @param ledgerFn - VaultRegistry.ledger function (injected to avoid direct contract import)
 */
export function setupEmailSubscription(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicDataProvider: any,
  contractAddress: string,
  onEmailCountChange: (emailCount: number, manifestCid: string) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ledgerFn?: (data: unknown) => any,
): Subscription {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ledger = ledgerFn ?? ((data: unknown) => data as any);

  return publicDataProvider
    .contractStateObservable(contractAddress, { type: 'latest' })
    .pipe(
      map((state: { data: unknown }) => {
        const ledgerState = ledger(state.data);
        return {
          emailCount: ledgerState.emailCount as number,
          manifestCid: ledgerState.inboxManifestCid as string,
        };
      }),
      distinctUntilChanged((prev: { emailCount: number }, curr: { emailCount: number }) => prev.emailCount === curr.emailCount),
    )
    .subscribe(({ emailCount, manifestCid }: { emailCount: number; manifestCid: string }) => {
      onEmailCountChange(emailCount, manifestCid);
    });
}

interface UseEmailSubscriptionOptions {
  contractService: {
    getPublicDataProvider: () => Promise<unknown>;
    getContractAddress: () => string;
  };
  emailPublicKey: string | null;
  onEmailCountChange: (emailCount: number, manifestCid: string) => void;
}

/**
 * React hook that subscribes to contractStateObservable while inbox page is mounted.
 * Guard: only subscribes if emailPublicKey is set in vault settings.
 */
export function useEmailSubscription({
  contractService,
  emailPublicKey,
  onEmailCountChange,
}: UseEmailSubscriptionOptions): void {
  const subscriptionRef = useRef<Subscription | null>(null);

  useEffect(() => {
    if (!emailPublicKey) return;

    let cancelled = false;

    (async () => {
      const [provider, { VaultRegistry }] = await Promise.all([
        contractService.getPublicDataProvider(),
        import('@aliasvault/contract'),
      ]);
      if (cancelled) return;

      subscriptionRef.current = setupEmailSubscription(
        provider,
        contractService.getContractAddress(),
        onEmailCountChange,
        VaultRegistry.ledger,
      );
    })();

    return () => {
      cancelled = true;
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [contractService, emailPublicKey, onEmailCountChange]);
}
