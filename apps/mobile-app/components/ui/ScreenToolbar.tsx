import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';

import { useIsStackRoute } from '@/hooks/useTwoPane';

/**
 * The native header toolbar of a stack route (Stack.Toolbar, with Stack.Toolbar.* items as children); nothing in the
 * primary pane of a two-pane layout, where the screen has no route header.
 */
export function ScreenToolbar(props: ComponentProps<typeof Stack.Toolbar>): React.ReactNode {
  const isStackRoute = useIsStackRoute();
  return isStackRoute ? <Stack.Toolbar {...props} /> : null;
}
