import { MaterialIcons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View, StyleSheet, TouchableOpacity } from 'react-native';

import type { Item, Attachment } from '@/utils/dist/core/models/vault';
import emitter from '@/utils/EventEmitter';

import { useAttachmentViewer } from '@/hooks/useAttachmentViewer';
import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

type AttachmentSectionProps = {
  item: Item;
};

/**
 * Attachment section component.
 */
export const AttachmentSection: React.FC<AttachmentSectionProps> = ({ item }): React.ReactNode => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const colors = useColors();
  const dbContext = useDb();
  const { t } = useTranslation();
  const { showAlert } = useDialog();
  const { openAttachment, viewerElement } = useAttachmentViewer();

  /**
   * Handle attachment action - preview or download.
   */
  const handleAttachment = async (attachment: Attachment): Promise<void> => {
    try {
      // Sanitize filename
      const sanitizedFilename = attachment.Filename.replace(/[/\\]/g, '_');
      const downloadsDir = new Directory(Paths.document, 'Downloads');
      if (!downloadsDir.exists) {
        downloadsDir.create({ intermediates: true });
      }

      const file = new File(downloadsDir, sanitizedFilename);
      if (file.exists) {
        file.delete();
      }
      file.create();

      if (typeof attachment.Blob === 'string') {
        file.write(attachment.Blob, { encoding: 'base64' });
      } else {
        file.write(attachment.Blob as unknown as Uint8Array);
      }

      await openAttachment({ filePath: file.uri, fileName: sanitizedFilename });
    } catch (error) {
      console.error('Error handling attachment:', error);
      showAlert('Error', 'Failed to process attachment');
    }
  };

  /**
   * Load the attachments.
   */
  const loadAttachments = useCallback(async (): Promise<void> => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    try {
      const attachmentList = await dbContext.sqliteClient.settings.getAttachmentsForItem(item.Id);
      setAttachments(attachmentList);
    } catch (error) {
      console.error('Error loading attachments:', error);
    }
  }, [item.Id, dbContext?.sqliteClient]);

  useEffect((): (() => void) => {
    loadAttachments();

    const itemChangedSub = emitter.addListener('credentialChanged', async (changedId: string) => {
      if (changedId === item.Id) {
        await loadAttachments();
      }
    });

    return () => {
      itemChangedSub.remove();
    };
  }, [item.Id, dbContext?.sqliteClient, loadAttachments]);

  if (attachments.length === 0) {
    return null;
  }

  const styles = StyleSheet.create({
    attachmentDate: {
      fontSize: 12,
    },
    attachmentInfo: {
      flex: 1,
    },
    attachmentItem: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    attachmentName: {
      fontSize: 14,
      fontWeight: '500',
      marginBottom: 2,
    },
    container: {
      paddingTop: 16,
    },
    content: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      marginTop: 8,
      padding: 12,
    },
    downloadIcon: {
      marginLeft: 12,
    },
  });

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">
        {t('items.attachments')}
      </ThemedText>
      {attachments.map(attachment => (
        <TouchableOpacity
          key={attachment.Id}
          style={styles.content}
          onPress={() => handleAttachment(attachment)}
        >
          <View style={styles.attachmentItem}>
            <View style={styles.attachmentInfo}>
              <ThemedText style={styles.attachmentName}>
                {attachment.Filename}
              </ThemedText>
              <ThemedText style={styles.attachmentDate} type="subtitle">
                {new Date(attachment.CreatedAt).toLocaleDateString()}
              </ThemedText>
            </View>
            <View style={styles.downloadIcon}>
              <MaterialIcons
                name={"visibility"}
                size={20}
                color={colors.primary}
              />
            </View>
          </View>
        </TouchableOpacity>
      ))}
      {viewerElement}
    </ThemedView>
  );
};
