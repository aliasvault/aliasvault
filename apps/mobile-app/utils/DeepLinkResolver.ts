import NativeVaultManager from '@/specs/NativeVaultManager';

declare const __DEV__: boolean;

export type ResolvedTarget = {
  path: string;
  params?: Record<string, string>;
};

/**
 * Resolve an `open/<action>/...` URL into a final navigation target.
 *
 * Returns null when the action is unrecognised or is missing required params.
 * For `__debug__/...` actions the navigation target is always /(tabs)/items
 * and the associated native side effect is awaited internally before the
 * function resolves — E2E callers can deep-link into a debug action and
 * trust that the resulting state (e.g. offline mode) is applied by the time
 * navigation runs.
 *
 * Used by both the cold-boot interceptor (root layout) and warm-start
 * ActionHandler so the action→path mapping lives in one place.
 */
export async function resolveOpenAction(
  actionSegments: string[],
  queryParams: Record<string, string>,
): Promise<ResolvedTarget | null> {
  const [action, ...rest] = actionSegments;

  switch (action) {
    case 'mobile-unlock': {
      const requestId = rest[0];
      if (!requestId) {
        return null;
      }
      const params: Record<string, string> = {};
      if (queryParams.pk) {
        params.pk = queryParams.pk;
      }
      return {
        path: `/(tabs)/settings/mobile-unlock/${requestId}`,
        params: Object.keys(params).length > 0 ? params : undefined,
      };
    }

    case '__debug__':
      if (!__DEV__) {
        return null;
      }
      try {
        await executeDebugSideEffect(rest);
      } catch (err) {
        console.error('[DeepLinkResolver] debug side effect failed:', err);
      }
      return { path: '/(tabs)/items' };

    default:
      return null;
  }
}

/**
 * Whether an `open/<action>` requires the vault to be unlocked before the
 * resolved target makes sense. Warm-start ActionHandler uses this to decide
 * between navigating directly and detouring through /reinitialize.
 */
export function openActionRequiresVaultUnlock(actionSegments: string[]): boolean {
  return actionSegments[0] === 'mobile-unlock';
}

/**
 * Parse a deep-link URL and resolve into a post-unlock navigation target.
 *
 * - `aliasvault://open/<action>/...` → `resolveOpenAction`
 * - any other path (e.g. `aliasvault://items/abc`) → that route directly
 *
 * Used by the root layout's cold-boot interceptor. The caller is responsible
 * for routing through /initialize before navigating to the returned target.
 * Returns null for invalid, empty, or unrecognised URLs.
 */
export async function resolveDeepLink(url: string | null): Promise<ResolvedTarget | null> {
  if (!url) {
    return null;
  }

  let rawPath = '';
  const queryParams: Record<string, string> = {};
  try {
    const parsed = new URL(url);
    rawPath = `${parsed.host}${parsed.pathname}`.replace(/^\/+/, '');
    parsed.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });
  } catch {
    return null;
  }

  if (!rawPath) {
    return null;
  }

  const segments = rawPath.split('/').filter(Boolean);
  if (segments[0] === 'open') {
    return resolveOpenAction(segments.slice(1), queryParams);
  }

  return {
    path: rawPath,
    params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
  };
}

/**
 * Execute the side effect for a `__debug__/<debugAction>` URL.
 *
 * `debugSegments` is the path segments AFTER `__debug__/`, e.g. for
 * `__debug__/set-offline/true` this receives `['set-offline', 'true']`.
 */
async function executeDebugSideEffect(debugSegments: string[]): Promise<void> {
  if (!__DEV__) {
    return;
  }
  const [debugAction, ...debugParams] = debugSegments;

  switch (debugAction) {
    case 'set-offline': {
      const isOffline = debugParams[0] === 'true';
      console.debug('[DeepLinkResolver] Setting offline mode:', isOffline);
      await NativeVaultManager.setOfflineMode(isOffline);
      return;
    }
    case 'set-api-url': {
      if (debugParams.length === 0) {
        console.error('[DeepLinkResolver] set-api-url requires URL parameter');
        return;
      }
      // Join all remaining segments so unencoded slashes in the URL still work.
      const url = decodeURIComponent(debugParams.join('/'));
      console.debug('[DeepLinkResolver] Setting API URL:', url);
      await NativeVaultManager.setApiUrl(url);
      return;
    }
    default:
      console.warn('[DeepLinkResolver] Unknown debug action:', debugAction);
  }
}
