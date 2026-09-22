import { FaviconService } from '@aliasvault/client/items/FaviconService';
import { usesWebsiteLogo } from '@aliasvault/client/items/ItemLogoView';
import { LogoKinds } from '@aliasvault/models/vault';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import type { LogoKind, LogoSelection } from '@aliasvault/models/vault';

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
  websiteSource: string | null;
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
  const [isResolvePending, setIsResolvePending] = useState(!isExistingItem);
  const [resolvedFaviconSource, setResolvedFaviconSource] = useState<string | null>(null);
  const [websiteSource, setWebsiteSource] = useState<string | null>(null);

  const resolvedSourceRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const hasInitialisedRef = useRef(false);
  const fetchedRef = useRef(new Map<string, Uint8Array | null>());
  const fetchInFlightRef = useRef<Promise<unknown> | null>(null);
  const usesWebsiteIcon = logoSelection ? usesWebsiteLogo(logoSelection) : (currentLogoKind ?? LogoKinds.Favicon) === LogoKinds.Favicon;

  /**
   * Resolve the favicon for the URL the item currently has.
   * @param force Fetch from the server even when the vault already holds this domain's icon
   */
  const resolveFromWebsite = useCallback(async (force: boolean): Promise<void> => {
    const sqliteClient = dbContext?.sqliteClient;
    if (!sqliteClient) {
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsFetchingLogo(true);
    try {
      const target = await FaviconService.resolveTarget(url);
      if (requestId !== requestIdRef.current) {
        return;
      }

      const source = target?.source ?? null;
      resolvedSourceRef.current = source;
      setResolvedFaviconSource(source);
      setLogoSelection({ Kind: LogoKinds.Favicon });

      if (!target) {
        onLogoBytesChange(undefined);
        return;
      }

      const stored = await FaviconService.getStoredFavicon(target, sqliteClient.logos);
      if (requestId !== requestIdRef.current) {
        return;
      }
      onLogoBytesChange(stored ?? undefined);
      if (stored && !force) {
        return;
      }

      while (fetchInFlightRef.current) {
        await fetchInFlightRef.current;
        if (requestId !== requestIdRef.current) {
          return;
        }
      }

      if (!force && fetchedRef.current.has(target.source)) {
        const cached = fetchedRef.current.get(target.source);
        if (cached) {
          onLogoBytesChange(cached);
        }
        return;
      }

      const request = FaviconService.fetchFavicon(target, sqliteClient.logos, webApi, { ignoreStored: true });
      fetchInFlightRef.current = request;
      const result = await request.finally(() => {
        if (fetchInFlightRef.current === request) {
          fetchInFlightRef.current = null;
        }
      });
      fetchedRef.current.set(target.source, result.success && result.imageData ? result.imageData : null);
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (result.success && result.imageData) {
        onLogoBytesChange(result.imageData);
        setLogoSelection(force ? { Kind: LogoKinds.Favicon, Data: result.imageData } : { Kind: LogoKinds.Favicon });
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

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async (): Promise<void> => {
      const source = (await FaviconService.resolveTarget(url))?.source ?? null;
      if (cancelled) {
        return;
      }
      setWebsiteSource(source);

      const isFirstRun = !hasInitialisedRef.current;
      hasInitialisedRef.current = true;
      if (isFirstRun && isExistingItem) {
        resolvedSourceRef.current = source;
        setIsResolvePending(false);
        return;
      }

      if (!usesWebsiteIcon || resolvedSourceRef.current === source) {
        setIsResolvePending(false);
        return;
      }

      if (isFirstRun) {
        void resolveFromWebsite(false);
        setIsResolvePending(false);
        return;
      }

      setIsResolvePending(true);
      timer = setTimeout(() => {
        void resolveFromWebsite(false);
        setIsResolvePending(false);
      }, URL_SETTLE_MS);
    })();

    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isExistingItem, isReady, resolveFromWebsite, url, usesWebsiteIcon]);

  /**
   * Apply a favicon the user picked from the built-in catalog.
   */
  const selectLogo = useCallback((selection: LogoSelection): void => {
    requestIdRef.current++;
    setIsFetchingLogo(false);
    setIsResolvePending(false);
    setLogoSelection(selection);
  }, []);

  /**
   * Fetch the website's favicon on request, replacing a favicon that has gone stale.
   */
  const fetchLogoFromWebsite = useCallback((): Promise<void> => resolveFromWebsite(true), [resolveFromWebsite]);

  return { logoSelection, isFetchingLogo: isFetchingLogo || isResolvePending, resolvedFaviconSource, websiteSource, selectLogo, fetchLogoFromWebsite };
};

export default useItemLogo;
