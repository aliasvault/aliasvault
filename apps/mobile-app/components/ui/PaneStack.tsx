import { memo, useMemo, useState } from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import { Screen, ScreenStack, ScreenStackHeaderCenterView, ScreenStackHeaderConfig, ScreenStackHeaderRightView } from 'react-native-screens';

import { useColors } from '@/hooks/useColorScheme';
import { PaneScreenContext, type PaneHeaderViews, type PaneScreen, type PaneScreenInfo, type PaneStackEntry } from '@/hooks/usePaneStack';

const iosMajorVersion = Platform.OS === 'ios' ? parseInt(String(Platform.Version), 10) : 0;

type PaneStackProps = {
  /** The root screen, which draws its own header. */
  root: React.ReactNode;
  /** The root's title, the back title of the first pushed screen. */
  rootTitle: string;
  screens: PaneStackEntry[];
  /** Called when the native back button or gesture dismissed screens. */
  onDismissed: (count: number) => void;
  titleOf: (screen: PaneScreen) => string;
  renderScreen: (screen: PaneScreen) => React.ReactNode;
};

/**
 * A native navigation stack inside a pane: the pushed screens get the native header, back button and back gesture,
 * while the root keeps its own header.
 */
export const PaneStack = memo(function PaneStack({ root, rootTitle, screens, onDismissed, titleOf, renderScreen }: PaneStackProps): React.ReactNode {
  return (
    <ScreenStack style={styles.stack}>
      <Screen enabled isNativeStack activityState={2} stackPresentation="push" style={StyleSheet.absoluteFill}>
        {root}
        <ScreenStackHeaderConfig hidden />
      </Screen>
      {screens.map((screen, index) => (
        <PaneStackScreen key={screen.key} screen={screen} title={titleOf(screen)} backTitle={index === 0 ? rootTitle : titleOf(screens[index - 1])} onDismissed={onDismissed}>
          {renderScreen(screen)}
        </PaneStackScreen>
      ))}
    </ScreenStack>
  );
});

type PaneStackScreenProps = {
  screen: PaneStackEntry;
  title: string;
  backTitle: string;
  onDismissed: (count: number) => void;
  children: React.ReactNode;
};

/**
 * One pushed screen: its native header, and what the screen's content may ask about itself (see usePaneScreen).
 */
function PaneStackScreen({ screen, title, backTitle, onDismissed, children }: PaneStackScreenProps): React.ReactNode {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const [headerHeight, setHeaderHeight] = useState(0);
  const [headerViews, setHeaderViews] = useState<PaneHeaderViews>({});
  const info = useMemo<PaneScreenInfo>(() => ({ key: screen.key, params: screen.params, headerHeight, setHeaderViews }), [screen.key, screen.params, headerHeight]);

  return (
    <Screen
      enabled
      isNativeStack
      activityState={2}
      stackPresentation="push"
      style={StyleSheet.absoluteFill}
      onDismissed={event => onDismissed(event.nativeEvent.dismissCount)}
      onHeaderHeightChange={event => setHeaderHeight(event.nativeEvent.headerHeight)}
    >
      <PaneScreenContext.Provider value={info}>{children}</PaneScreenContext.Provider>
      <ScreenStackHeaderConfig
        title={title}
        titleColor={colors.text}
        color={colors.primary}
        translucent
        blurEffect={colorScheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        backTitle={backTitle}
        backButtonDisplayMode={iosMajorVersion >= 26 ? 'minimal' : 'default'}
      >
        {headerViews.title ? <ScreenStackHeaderCenterView>{headerViews.title}</ScreenStackHeaderCenterView> : null}
        {headerViews.right ? <ScreenStackHeaderRightView>{headerViews.right}</ScreenStackHeaderRightView> : null}
      </ScreenStackHeaderConfig>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: {
    flex: 1,
  },
});
