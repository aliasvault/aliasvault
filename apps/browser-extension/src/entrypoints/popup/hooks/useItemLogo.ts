import { useCallback, useEffect, useRef, useState } from 'react';

import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import type { LogoKind, LogoSelection } from '@/utils/dist/core/models/vault';
import { LogoKinds } from '@/utils/dist/core/models/vault';
import { FaviconService } from '@/utils/FaviconService';

/**
 * Debounce time for the URL field after typing before its favicon is looked up.
 */
const URL_SETTLE_MS = 600;

type UseItemLogoOptions = {
  url: string | string[] | undefined;
  currentLogoKind?: LogoKind;
  isReady: boolean;
  isExistingItem: boolean;
  onLogoBytesChange: (data?: Uint8Array) => void;
};

type UseItemLogoResult = {
  logoSelection: LogoSelection | undefined;
  isFetchingLogo: boolean;
  resolvedFaviconSource: string | null;
  selectLogo: (selection: LogoSelection) => void;
  fetchLogoFromWebsite: () => Promise<void>;
};

/**
 * Owns the icon shown while adding or editing an item.
 * 
 * @param options The URL to follow, the item's current logo, and where to hand resolved icon bytes
 * @returns The icon choice, its loading state, and the actions the picker triggers
 */
const useItemLogo = ({ url, currentLogoKind, isReady, isExistingItem, onLogoBytesChange }: UseItemLogoOptions): UseItemLogoResult => {
  const dbContext = useDb();
  const webApi = useWebApi();

  const [logoSelection, setLogoSelection] = useState<LogoSelection | undefined>(undefined);
  const [isFetchingLogo, setIsFetchingLogo] = useState(false);
  const [resolvedFaviconSource, setResolvedFaviconSource] = useState<string | null>(null);

  const resolvedSourceRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const hasInitialisedRef = useRef(false);
  const usesWebsiteIcon = logoSelection ? logoSelection.Kind === LogoKinds.Favicon : (currentLogoKind ?? LogoKinds.Favicon) === LogoKinds.Favicon;

  /**
   * Resolve the favicon for the URL the item currently has.
   * @param force Fetch from the server even when the vault already holds this domain's icon
   */
  const resolveFromWebsite = useCallback(async (force: boolean): Promise<void> => {
    const sqliteClient = dbContext?.sqliteClient;
    if (!sqliteClient) {
      return;
    }

    const normalizedUrl = FaviconService.extractFirstValidUrl(url);
    const source = normalizedUrl ? FaviconService.extractSourceFromUrl(normalizedUrl) : 'unknown';
    const previousSource = resolvedSourceRef.current;
    const requestId = ++requestIdRef.current;

    resolvedSourceRef.current = source;
    setResolvedFaviconSource(source === 'unknown' ? null : source);
    setLogoSelection({ Kind: LogoKinds.Favicon });

    // Without a domain there is nothing to fetch from, so automatic means no icon at all.
    if (!normalizedUrl || source === 'unknown') {
      onLogoBytesChange(undefined);
      return;
    }

    // The vault already holds this domain's favicon: show that one.
    if (!force) {
      const stored = FaviconService.getStoredFavicon(normalizedUrl, sqliteClient);
      if (stored) {
        onLogoBytesChange(stored);
        return;
      }
    }

    if (previousSource !== source) {
      onLogoBytesChange(undefined);
    }

    setIsFetchingLogo(true);
    try {
      const result = await FaviconService.fetchFavicon(normalizedUrl, sqliteClient, webApi, { ignoreStored: true });
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (result.success && result.imageData) {
        onLogoBytesChange(result.imageData);
        setLogoSelection(force ? { Kind: LogoKinds.Favicon, Data: result.imageData } : { Kind: LogoKinds.Favicon });
      } else if (previousSource !== source) {
        onLogoBytesChange(undefined);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsFetchingLogo(false);
      }
    }
  }, [dbContext?.sqliteClient, onLogoBytesChange, url, webApi]);

  /**
   * Follow the URL field: once it settles on a different domain, that domain's favicon is resolved.
   */
  useEffect(() => {
    if (!isReady) {
      return;
    }

    const normalizedUrl = FaviconService.extractFirstValidUrl(url);
    const source = normalizedUrl ? FaviconService.extractSourceFromUrl(normalizedUrl) : 'unknown';

    if (!hasInitialisedRef.current) {
      hasInitialisedRef.current = true;
      if (isExistingItem) {
        resolvedSourceRef.current = source;
        return;
      }
    }

    if (!usesWebsiteIcon || resolvedSourceRef.current === source) {
      return;
    }

    const timer = setTimeout(() => void resolveFromWebsite(false), URL_SETTLE_MS);
    return (): void => clearTimeout(timer);
  }, [isExistingItem, isReady, resolveFromWebsite, url, usesWebsiteIcon]);

  /**
   * Apply a favicon the user picked from the built-in catalog.
   */
  const selectLogo = useCallback((selection: LogoSelection): void => {
    requestIdRef.current++;
    setIsFetchingLogo(false);
    setLogoSelection(selection);
  }, []);

  /**
   * Fetch the website's favicon on request, replacing a favicon that has gone stale.
   */
  const fetchLogoFromWebsite = useCallback((): Promise<void> => resolveFromWebsite(true), [resolveFromWebsite]);

  return { logoSelection, isFetchingLogo, resolvedFaviconSource, selectLogo, fetchLogoFromWebsite };
};

export default useItemLogo;
