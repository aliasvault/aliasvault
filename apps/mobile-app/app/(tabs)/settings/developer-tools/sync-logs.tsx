import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Toast from 'react-native-toast-message';

import { copyToClipboard } from '@/utils/ClipboardUtility';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * A persisted sync engine run (recorded by the native layer).
 */
type VaultSyncLogEntry = {
  operation: string;
  startedAt: number;
  durationMs: number;
  success: boolean | null;
  lines: string[];
};

/**
 * The outcome of a run.
 */
function formatOutcome(success: boolean | null): string {
  if (success === null) {
    return 'no result';
  }
  return success ? 'success' : 'failed';
}

/**
 * Header of a run.
 */
function formatHeader(entry: VaultSyncLogEntry): string {
  return `${entry.operation} at ${new Date(entry.startedAt).toLocaleString()}: ${entry.durationMs}ms, ${formatOutcome(entry.success)}`;
}

/**
 * Developer tools: the logs of the recent vault syncs. Note: not required to be translated.
 */
export default function SyncLogsScreen(): React.ReactNode {
  const colors = useColors();
  const [entries, setEntries] = useState<VaultSyncLogEntry[]>([]);

  /**
   * Load the persisted run logs.
   */
  const loadLogs = useCallback(async (): Promise<void> => {
    const json = await NativeVaultManager.getVaultSyncLogs();
    setEntries(JSON.parse(json) as VaultSyncLogEntry[]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLogs();
    }, [loadLogs])
  );

  /**
   * Copy every run's log to the clipboard.
   */
  const handleCopyLogs = useCallback(async (): Promise<void> => {
    if (entries.length === 0) {
      return;
    }
    await copyToClipboard(entries.map((entry) => `${formatHeader(entry)}\n${entry.lines.join('\n')}`).join('\n\n'));

    Toast.show({
      type: 'success',
      text1: 'Sync logs copied',
      position: 'bottom',
      visibilityTime: 2000,
    });
  }, [entries]);

  const styles = StyleSheet.create({
    button: {
      marginTop: 12,
      backgroundColor: colors.primary,
    },
    buttonSecondary: {
      marginTop: 12,
      backgroundColor: colors.accentBackground,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 15,
      marginTop: 24,
      textAlign: 'center',
    },
    entryHeader: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
    },
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 20,
    },
    logText: {
      color: colors.text,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 11,
      lineHeight: 16,
    },
    section: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 16,
      padding: 12,
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.headerText}>
          The last 5 vault syncs on this device, newest first, with the status checks in between.
        </ThemedText>

        <ThemedButton
          style={styles.button}
          title="Copy logs"
          onPress={handleCopyLogs}
        />
        <ThemedButton
          style={styles.buttonSecondary}
          title="Refresh"
          onPress={loadLogs}
        />

        {entries.length === 0 && (
          <ThemedText style={styles.emptyText}>No sync logs recorded yet.</ThemedText>
        )}
        {entries.map((entry) => (
          <View key={`${entry.startedAt}-${entry.operation}`} style={styles.section}>
            <ThemedText style={styles.entryHeader}>{formatHeader(entry)}</ThemedText>
            <ThemedText selectable style={styles.logText}>{entry.lines.join('\n')}</ThemedText>
          </View>
        ))}
      </ThemedScrollView>
    </ThemedContainer>
  );
}
