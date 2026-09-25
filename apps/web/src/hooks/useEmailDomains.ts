import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDb } from '@/context/DbContext';

/**
 * Domain checks: which addresses AliasVault or SpamOK can receive mail for.
 */
export type EmailDomainChecks = {
  /** Whether the domains are known yet. */
  isLoaded: boolean;
  isSpamOkDomain: (email: string) => boolean;
  isAliasVaultDomain: (email: string) => boolean;
  isAliasVaultSupportedDomain: (email: string) => boolean;
};

/**
 * Whether an address ends in one of the domains.
 */
const endsWithDomain = (email: string, domains: string[]): boolean => {
  const lower = email.toLowerCase();
  return domains.some(domain => lower.endsWith('@' + domain.toLowerCase()));
};

/**
 * The email domains this instance serves, from the vault metadata the sync recorded.
 */
export function useEmailDomains(): EmailDomainChecks {
  const dbContext = useDb();
  const [publicDomains, setPublicDomains] = useState<string[]>([]);
  const [privateDomains, setPrivateDomains] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void dbContext.getVaultMetadata().then((metadata) => {
      if (cancelled) {
        return;
      }
      setPublicDomains(metadata?.publicEmailDomains ?? []);
      setPrivateDomains(metadata?.privateEmailDomains ?? []);
      setIsLoaded(true);
    });
    return (): void => {
      cancelled = true;
    };
  }, [dbContext]);

  const isSpamOkDomain = useCallback((email: string): boolean => endsWithDomain(email, publicDomains), [publicDomains]);
  const isAliasVaultDomain = useCallback((email: string): boolean => endsWithDomain(email, privateDomains), [privateDomains]);
  const isAliasVaultSupportedDomain = useCallback((email: string): boolean => isSpamOkDomain(email) || isAliasVaultDomain(email), [isAliasVaultDomain, isSpamOkDomain]);

  return useMemo(() => ({ isLoaded, isSpamOkDomain, isAliasVaultDomain, isAliasVaultSupportedDomain }), [isAliasVaultDomain, isAliasVaultSupportedDomain, isLoaded, isSpamOkDomain]);
}
