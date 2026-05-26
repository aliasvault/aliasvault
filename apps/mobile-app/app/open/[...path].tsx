import { Href, useRouter, useLocalSearchParams, useGlobalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ResolvedTarget,
  openActionRequiresVaultUnlock,
  resolveOpenAction,
} from '@/utils/DeepLinkResolver';

import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedView } from '@/components/themed/ThemedView';
import { useNavigation } from '@/context/NavigationContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Build an Href from a ResolvedTarget, appending any params as a query string.
 */
function buildHref(target: ResolvedTarget): Href {
  if (!target.params || Object.keys(target.params).length === 0) {
    return target.path as Href;
  }
  const qs = new URLSearchParams(target.params).toString();
  return `${target.path}?${qs}` as Href;
}

/**
 * Action-based deep link handler for special actions triggered from outside the app.
 *
 * URL structure: aliasvault://open/[action]/[...params]
 *
 * Supported actions:
 * - mobile-unlock/[requestId] - Mobile device unlock via QR code
 * - __debug__/set-offline/[true|false] - (DEV only) Toggle offline mode for E2E testing
 * - __debug__/set-api-url/[encoded-url] - (DEV only) Set API URL for E2E testing
 *
 * The action→path mapping lives in `utils/DeepLinkResolver` and is shared
 * with the root layout's cold-boot interceptor; this component only handles
 * the warm-start dispatch (vault-unlocked check, debug side effects).
 */
export default function ActionHandler() : React.ReactNode {
  const router = useRouter();
  const params = useGlobalSearchParams();
  const localParams = useLocalSearchParams();
  const { setReturnUrl, bootHandled } = useNavigation();
  const hasNavigated = useRef<boolean>(false);

  useEffect(() => {
    if (hasNavigated.current) {
      return;
    }

    /*
     * Cold-boot: the root _layout already intercepts the initial URL, resolves the
     * deep-link target itself, and redirects through /initialize. So when not booted
     * yet, we stop executing here and trust the root layout to handle the deep link.
     */
    if (!bootHandled) {
      hasNavigated.current = true;
      return;
    }

    const pathSegments = (params.path || localParams.path) as string[] | string | undefined;
    const pathArray = Array.isArray(pathSegments) ? pathSegments : pathSegments ? [pathSegments] : [];

    if (pathArray.length === 0) {
      router.replace('/(tabs)/items');
      hasNavigated.current = true;
      return;
    }

    // Collect query/route params other than `path` itself for the resolver.
    const queryParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (key !== 'path' && typeof value === 'string') {
        queryParams[key] = value;
      }
    }

    /*
     * Claim the effect synchronously so a re-run can't double-dispatch while
     * we're awaiting resolveOpenAction (which awaits debug side effects).
     */
    hasNavigated.current = true;

    (async (): Promise<void> => {
      const target = await resolveOpenAction(pathArray, queryParams);
      if (!target) {
        console.warn('[ActionHandler] Unknown or invalid action:', pathArray.join('/'));
        router.replace('/(tabs)/items');
        return;
      }

      if (openActionRequiresVaultUnlock(pathArray)) {
        /*
         * Vault must be unlocked before the target screen makes sense. If the
         * app was opened (e.g.) via deep link while auto-locked, detour through
         * /reinitialize first and forward to the target via setReturnUrl.
         */
        try {
          const isUnlocked = await NativeVaultManager.isVaultUnlocked();
          if (!isUnlocked) {
            setReturnUrl(target);
            router.replace('/reinitialize');
            return;
          }
        } catch {
          // Error checking vault status, fall through and try navigating anyway.
        }
      }

      router.replace(buildHref(target));
    })();
  }, [params, localParams, router, hasNavigated, setReturnUrl, bootHandled]);

  /*
   * Render loading view while the navigation action is being executed.
   */
  return (
    <ThemedView style={styles.container}>
      <View>
        <LoadingIndicator />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: '40%',
  },
});
