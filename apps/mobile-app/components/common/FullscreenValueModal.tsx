import { MaterialIcons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/hooks/useColorScheme';

/** Separators the passphrase generator can join words with. */
const PASSPHRASE_SEPARATORS = ['-', ' ', '_', '.'];

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

type FullscreenValueModalProps = {
  visible: boolean;
  value: string;
  /** Show the value as numbered character cells, for reading a password out loud or typing it over. */
  showCharacters?: boolean;
  onClose: () => void;
}

/**
 * Full screen view of a single field value. Only the close button (or Android back) dismisses it, so a phone handed to someone else stays open.
 * It is the only screen that may rotate to landscape; the app is locked to portrait again when it unmounts.
 */
const FullscreenValueModal: React.FC<FullscreenValueModalProps> = ({ visible, value, showCharacters = false, onClose }) : React.ReactNode => {
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    return () : void => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  /*
   * The modal gets its own SafeAreaProvider: the app's provider measures the root view, which stays portrait while the modal rotates,
   * so its insets would be the portrait ones in landscape.
   */
  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaProvider>
        <FullscreenValueContent value={value} showCharacters={showCharacters} onClose={onClose} />
      </SafeAreaProvider>
    </Modal>
  );
};

/**
 * Content of the full screen value modal.
 */
const FullscreenValueContent: React.FC<Omit<FullscreenValueModalProps, 'visible'>> = ({ value, showCharacters = false, onClose }) : React.ReactNode => {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  /** The window width at which the email address did not fit on one line, so it is shown split at the '@'. */
  const [emailSplitWidth, setEmailSplitWidth] = useState<number | null>(null);

  const atIndex = value.lastIndexOf('@');
  const isEmail = !showCharacters && atIndex > 0 && atIndex < value.length - 1 && !/\s/.test(value);
  const splitEmail = isEmail && emailSplitWidth === width;
  const passphrase = showCharacters ? splitPassphrase(value) : null;

  /**
   * Side padding of the header row. On iOS the landscape side insets reserve room for the Dynamic Island, which sits mid-height,
   * so the header at the top only needs to clear the rounded corner; Android insets are system bars and are kept in full.
   */
  const getHeaderSideInset = (inset: number) : number => Platform.OS === 'ios' ? Math.max(16, inset / 2) : inset + 16;

  /**
   * Color for a single character, so digits and symbols stand out from letters.
   */
  const getCharColor = (char: string) : string => /\p{L}/u.test(char) ? colors.text : colors.primary;

  const styles = StyleSheet.create({
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
    closeButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 24,
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    closeText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      marginLeft: 6,
    },
    container: {
      backgroundColor: colors.background,
      flex: 1,
      paddingBottom: insets.bottom + 16,
      paddingTop: insets.top + 12,
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingLeft: getHeaderSideInset(insets.left),
      paddingRight: getHeaderSideInset(insets.right),
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: 16,
      paddingLeft: insets.left + 16,
      paddingRight: insets.right + 16,
    },
    textValue: {
      color: colors.text,
      fontSize: 40,
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button">
          <MaterialIcons name="close" size={22} color={colors.text} />
          <Text style={styles.closeText}>{t('common.close')}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {passphrase ? (
          <View style={styles.wordList}>
            {passphrase.words.map((word, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <Text style={styles.wordSeparator}>{passphrase.separator === ' ' ? '\u2423' : passphrase.separator}</Text>}
                <View style={[styles.wordRow, styles.charCellAlt]}>
                  <Text style={styles.wordIndex}>{idx + 1}</Text>
                  <Text style={styles.charValue}>
                    {Array.from(word).map((char, charIdx) => <Text key={charIdx} style={{ color: getCharColor(char) }}>{char}</Text>)}
                  </Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        ) : showCharacters ? (
          <View style={styles.charGrid}>
            {Array.from(value).map((char, idx) => (
              <View key={idx} style={[styles.charCell, idx % 2 === 0 && styles.charCellAlt]}>
                <Text style={[styles.charValue, { color: getCharColor(char) }]}>{char}</Text>
                <Text style={styles.charIndex}>{idx + 1}</Text>
              </View>
            ))}
          </View>
        ) : splitEmail ? (
          <Text style={styles.textValue} selectable>{value.slice(0, atIndex)}{'\n'}{value.slice(atIndex)}</Text>
        ) : (
          <Text style={styles.textValue} selectable onTextLayout={(e) => isEmail && e.nativeEvent.lines.length > 1 && setEmailSplitWidth(width)}>{value}</Text>
        )}
      </ScrollView>
    </View>
  );
};

export default FullscreenValueModal;
