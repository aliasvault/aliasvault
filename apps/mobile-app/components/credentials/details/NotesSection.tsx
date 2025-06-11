import { View, Text, StyleSheet, Linking, Pressable } from 'react-native';

import type { Credential } from '@/utils/dist/shared/models/vault';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

type NotesSectionProps = {
  credential: Credential;
};

/**
 * Split text into parts, separating URLs from regular text to make them clickable.
 */
const splitTextAndUrls = (text: string): { type: 'text' | 'url', content: string, url?: string }[] => {
  const urlPattern = /(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/g;

  const parts: { type: 'text' | 'url', content: string, url?: string }[] = [];
  let lastIndex = 0;
  let match;

  while ((match = urlPattern.exec(text)) !== null) {
    // Add text before the URL if it's not empty
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        parts.push({
          type: 'text',
          content: textBefore
        });
      }
    }

    // Add the URL
    const url = match[0];
    const href = url.startsWith('http') ? url : `http://${url}`;
    parts.push({
      type: 'url',
      content: url,
      url: href
    });

    lastIndex = match.index + url.length;
  }

  // Add remaining text if it's not empty
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    if (remainingText.trim()) {
      parts.push({
        type: 'text',
        content: remainingText
      });
    }
  }

  return parts;
};

/**
 * Notes section component.
 */
export const NotesSection: React.FC<NotesSectionProps> = ({ credential }) : React.ReactNode => {
  const colors = useColors();

  if (!credential.Notes) {
    return null;
  }

  const parts = splitTextAndUrls(credential.Notes);

  /**
   * Handle the link press.
   */
  const handleLinkPress = (url: string) : void => {
    Linking.openURL(url);
  };

  const styles = StyleSheet.create({
    link: {
      color: colors.primary,
      fontSize: 14,
      textDecorationLine: 'underline',
    },
    notes: {
      color: colors.text,
      fontSize: 14,
    },
    notesContainer: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      padding: 12,
    },
    section: {
      gap: 8,
      paddingTop: 16,
    },
  });

  return (
    <ThemedView style={styles.section}>
      <ThemedText type="subtitle">Notes</ThemedText>
      <View style={styles.notesContainer}>
        {parts.map((part, index) => {
          if (part.type === 'url') {
            return (
              <Pressable key={index} onPress={() => handleLinkPress(part.url!)}>
                <Text style={styles.link} selectable={true}>
                  {part.content}
                </Text>
              </Pressable>
            );
          }
          return (
            <Text key={index} style={styles.notes} selectable={true}>
              {part.content}
            </Text>
          );
        })}
      </View>
    </ThemedView>
  );
};