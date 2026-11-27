import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent, type TextLayoutEvent } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { clearFullscreenValue, getFullscreenValue } from '@/utils/FullscreenValue';

import { useColors } from '@/hooks/useColorScheme';
import { useHeaderInset } from '@/hooks/useHeaderInset';

import { defaultHeaderOptions } from '@/components/themed/ThemedHeader';
import { ThemedText } from '@/components/themed/ThemedText';
import { RobustPressable } from '@/components/ui/RobustPressable';

/** Separators the passphrase generator can join words with. */
const PASSPHRASE_SEPARATORS = ['-', ' ', '_', '.'];

const MAX_FONT_SIZE = 200;
/** Font size the value is measured at; text size scales linearly from there. */
const MEASURE_FONT_SIZE = 50;
/** Share of the area the text fills, so rounding never pushes it over the edge. */
const FIT_MARGIN = 0.97;

type Size = { width: number; height: number };

/**
 * No header background, for the empty top bar next to the iPhone Duo bar rail.
 */
const noHeaderBackground = () : React.ReactNode => null;

/**
 * Words of a value that a separator splits into 3 or more parts (a passphrase), or null to show it per character.
 */
const splitPassphrase = (value: string) : { words: string[]; separator: string } | null => {
  for (const separator of PASSPHRASE_SEPARATORS) {
    const words = value.split(separator);
    if (words.length >= 3 && words.every((word) => word.length > 0)) {
      return { words, separator };
    }
  }
  return null;
};

/**
 * Full screen view of a single field value, opened by a long press on the field. Only the close button (or Android back) dismisses it,
 * so a phone handed to someone else stays open. It is the only screen that may rotate to landscape; the app is locked to portrait again when it closes.
 */
export default function FullscreenValueScreen() : React.ReactNode {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const { title = '' } = useLocalSearchParams<{ title?: string }>();
  const railEdge = useVerticalBarEdgeIOS();
  const { width, height } = useWindowDimensions();
  const [entry] = useState(getFullscreenValue);

  /*
   * In landscape and next to the iPhone Duo bar rail the top bar is left empty and see-through, so the value gets the full height:
   * only the close button remains, in the rail or in the corner. The bar itself stays, as the close button is one of its items.
   */
  const isBarless = railEdge !== null || width > height;

  useLayoutEffect(() => {
    navigation.setOptions(isBarless
      ? { title: '', headerTransparent: true, headerBackground: noHeaderBackground, headerStyle: { backgroundColor: 'transparent' }, headerShadowVisible: false, scrollEdgeEffects: { top: 'hidden' } }
      : { title, headerTransparent: Platform.OS === 'ios', headerBackground: defaultHeaderOptions.headerBackground, headerStyle: { backgroundColor: colors.accentBackground }, headerShadowVisible: undefined, scrollEdgeEffects: undefined });
  }, [navigation, isBarless, title, colors.accentBackground]);

  useEffect(() => {
    if (!entry) {
      router.back();
      return;
    }
    ScreenOrientation.unlockAsync().catch(() => {});
    return () : void => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      clearFullscreenValue();
    };
  }, [entry, router]);

  // Android shows the close button as a header view; iOS uses a toolbar button, which moves into the iPhone Duo bar rail.
  useLayoutEffect(() => {
    if (Platform.OS === 'ios') {
      return;
    }
    navigation.setOptions({
      /**
       * Header right button.
       */
      headerRight: () => (
        <RobustPressable onPress={() => router.back()} style={styles.headerRightButton}>
          <ThemedText style={{ color: colors.primary }}>{t('common.close')}</ThemedText>
        </RobustPressable>
      ),
    });
  }, [navigation, router, colors.primary, t]);

  /*
   * The screen gets its own SafeAreaProvider: the app's provider measures the root view, which stays portrait while this screen rotates,
   * so its insets would be the portrait ones in landscape.
   */
  return (
    <>
      {Platform.OS === 'ios' && (
        <Stack.Toolbar placement="right">
          {/* A bar item moves into the iPhone Duo rail only when it has a symbol; text-only items stay at the top. */}
          <Stack.Toolbar.Button icon="xmark" onPress={() => router.back()}>{t('common.close')}</Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <SafeAreaProvider style={styles.provider}>
        {entry && <FullscreenValueContent value={entry.value} showCharacters={entry.showCharacters} isBarless={isBarless} />}
      </SafeAreaProvider>
    </>
  );
}

/**
 * The value, as large as the screen allows, or as numbered characters or words for a password.
 */
const FullscreenValueContent: React.FC<{ value: string; showCharacters: boolean; isBarless: boolean }> = ({ value, showCharacters, isBarless }) : React.ReactNode => {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const headerHeight = useHeaderHeight();
  /*
   * A see-through top bar leaves the top to the value, below the status bar that Android keeps in landscape. The scrolling
   * character grid keeps clear of the close button in the corner.
   */
  let topInset = headerInset;
  if (isBarless) {
    topInset = showCharacters ? headerHeight : (Platform.OS === 'android' ? insets.top : 0);
  }
  const [area, setArea] = useState<Size | null>(null);
  /** Size of the value on one line at MEASURE_FONT_SIZE. */
  const [measured, setMeasured] = useState<Size | null>(null);
  const passphrase = showCharacters ? splitPassphrase(value) : null;

  /**
   * Color for a single character, so digits and symbols stand out from letters.
   */
  const getCharColor = (char: string) : string => /\p{L}/u.test(char) ? colors.text : colors.primary;

  /**
   * Record the area the value may fill.
   */
  const onAreaLayout = (event: LayoutChangeEvent) : void => {
    const { width, height } = event.nativeEvent.layout;
    setArea((previous) => (previous?.width === width && previous.height === height ? previous : { width, height }));
  };

  // The value stays on one line, as large as the width (or, in a short landscape area, the height) allows.
  const fontSize = area && measured ? Math.min(MAX_FONT_SIZE, FIT_MARGIN * MEASURE_FONT_SIZE * Math.min(area.width / measured.width, area.height / measured.height)) : null;

  /**
   * Record the size of the value at MEASURE_FONT_SIZE; the shown text is sized from it.
   */
  const onMeasureLayout = (event: TextLayoutEvent) : void => {
    const [line] = event.nativeEvent.lines;
    if (line) {
      setMeasured({ width: line.width, height: line.height });
    }
  };

  const contentStyles = StyleSheet.create({
    charCell: {
      alignItems: 'center',
      borderRadius: 6,
      margin: 2,
      paddingVertical: 6,
      width: 44,
    },
    charCellAlt: {
      backgroundColor: colors.accentBackground,
    },
    charGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
    },
    charIndex: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    charValue: {
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 30,
      fontWeight: '600',
    },
    container: {
      backgroundColor: colors.background,
      flex: 1,
      paddingBottom: insets.bottom + 16,
      paddingLeft: insets.left + 16,
      paddingRight: insets.right + 16,
      paddingTop: topInset + 16,
    },
    fitArea: {
      flex: 1,
      justifyContent: 'center',
    },
    measureText: {
      fontSize: MEASURE_FONT_SIZE,
      left: 0,
      opacity: 0,
      position: 'absolute',
      top: 0,
      width: 10000,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
    },
    textValue: {
      color: colors.text,
      fontWeight: '600',
      textAlign: 'center',
    },
    wordIndex: {
      color: colors.textMuted,
      fontSize: 14,
      marginRight: 12,
      textAlign: 'right',
      width: 24,
    },
    wordList: {
      alignSelf: 'center',
    },
    wordRow: {
      alignItems: 'center',
      borderRadius: 6,
      flexDirection: 'row',
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    wordSeparator: {
      color: colors.textMuted,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 18,
      paddingVertical: 4,
      textAlign: 'center',
    },
  });

  if (!passphrase && !showCharacters) {
    return (
      <View style={contentStyles.container}>
        <View style={contentStyles.fitArea} onLayout={onAreaLayout}>
          {/* Invisible copy of the value, wide enough to never wrap, that measures it. */}
          <Text style={[contentStyles.textValue, contentStyles.measureText]} numberOfLines={1} onTextLayout={onMeasureLayout} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
            {value}
          </Text>
          {fontSize !== null && (
            <Text style={[contentStyles.textValue, { fontSize }]} numberOfLines={1} selectable>
              {value}
            </Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={contentStyles.container}>
      <ScrollView contentContainerStyle={contentStyles.scrollContent}>
        {passphrase ? (
          <View style={contentStyles.wordList}>
            {passphrase.words.map((word, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <Text style={contentStyles.wordSeparator}>{passphrase.separator === ' ' ? '␣' : passphrase.separator}</Text>}
                <View style={[contentStyles.wordRow, contentStyles.charCellAlt]}>
                  <Text style={contentStyles.wordIndex}>{idx + 1}</Text>
                  <Text style={contentStyles.charValue}>
                    {Array.from(word).map((char, charIdx) => <Text key={charIdx} style={{ color: getCharColor(char) }}>{char}</Text>)}
                  </Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        ) : (
          <View style={contentStyles.charGrid}>
            {Array.from(value).map((char, idx) => (
              <View key={idx} style={[contentStyles.charCell, idx % 2 === 0 && contentStyles.charCellAlt]}>
                <Text style={[contentStyles.charValue, { color: getCharColor(char) }]}>{char}</Text>
                <Text style={contentStyles.charIndex}>{idx + 1}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  headerRightButton: {
    padding: 10,
    paddingRight: 0,
  },
  provider: {
    flex: 1,
  },
});
