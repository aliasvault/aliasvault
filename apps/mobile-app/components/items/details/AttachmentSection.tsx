import { Buffer } from 'buffer';

import { MaterialIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { View, StyleSheet, TouchableOpacity } from 'react-native';

import type { Item, Attachment } from '@/utils/dist/core/models/vault';
import emitter from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

import { FilePreviewModal } from './FilePreviewModal';

type AttachmentSectionProps = {
  item: Item;
};

/**
 * Attachment section component.
 */
export const AttachmentSection: React.FC<AttachmentSectionProps> = ({ item }): React.ReactNode => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    path: string;
    extension: string;
  } | null>(null);
  const colors = useColors();
  const dbContext = useDb();
  const { t } = useTranslation();
  const { showAlert } = useDialog();

  /**
   * Handle attachment action - preview or download.
   */
  const handleAttachment = async (attachment: Attachment): Promise<void> => {
    try {
      // Sanitize filename
      const sanitizedFilename = attachment.Filename.replace(/[/\\]/g, '_');
      const fileExtension = sanitizedFilename.split('.').pop()?.toLowerCase() ?? '';
      const downloadsDir = FileSystem.documentDirectory + 'Downloads/';
      const filePath = downloadsDir + sanitizedFilename;

      // Ensure Downloads directory exists
      const dirInfo = await FileSystem.getInfoAsync(downloadsDir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(downloadsDir, { intermediates: true });
      }

      // Always recreate file to ensure fresh data
      const fileInfo = await FileSystem.getInfoAsync(filePath);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(filePath);
      }

      if (typeof attachment.Blob === 'string') {
        await FileSystem.writeAsStringAsync(filePath, attachment.Blob, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else {
        const base64Data = Buffer.from(attachment.Blob as unknown as string, 'base64');
        await FileSystem.writeAsStringAsync(filePath, base64Data.toString(), {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      // Define supported file types
      const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
      const textExtensions = ['txt', 'md', 'json', 'csv', 'log', 'xml', 'js', 'ts', 'tsx', 'jsx', 'html', 'css'];
      const previewableExtensions = [...imageExtensions, ...textExtensions];

      if (previewableExtensions.includes(fileExtension)) {
        // Show preview modal for supported file types
        setSelectedFile({
          name: sanitizedFilename,
          path: filePath,
          extension: fileExtension,
        });
        setPreviewModalVisible(true);
      } else {
        // For other file types, offer download directly
        await downloadFileToSystem(filePath, sanitizedFilename);
      }
    } catch (error) {
      console.error('Error handling attachment:', error);
      showAlert('Error', 'Failed to process attachment');
    }
  };

  /**
   * Download file to system (iOS Files app or Android file manager).
   */
  const downloadFileToSystem = async (filePath: string, filename: string): Promise<void> => {
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        // Use Sharing API to trigger system save dialog
        await Sharing.shareAsync(filePath, {
          dialogTitle: `Save ${filename}`,
          mimeType: getMimeType(filename),
          UTI: getUTI(filename),
        });
      } else {
        showAlert(t('common.success'), `${t('items.fileSavedTo')}: ${filePath}`);
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      showAlert(t('common.error'), t('common.errors.unknownError'));
    }
  };

  /**
   * Get MIME type for file.
   */
  const getMimeType = (filename: string): string => {
    const extension = filename.split('.').pop()?.toLowerCase() ?? '';
    const mimeTypes: Record<string, string> = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain',
      'csv': 'text/csv',
      'xml': 'application/xml',
      'json': 'application/json',
      'zip': 'application/zip',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'bmp': 'image/bmp',
      'webp': 'image/webp',
    };
    return mimeTypes[extension] ?? 'application/octet-stream';
  };

  /**
   * Get UTI (Uniform Type Identifier) for iOS.
   */
  const getUTI = (filename: string): string => {
    const extension = filename.split('.').pop()?.toLowerCase() ?? '';
    const utis: Record<string, string> = {
      'pdf': 'com.adobe.pdf',
      'doc': 'com.microsoft.word.doc',
      'docx': 'org.openxmlformats.wordprocessingml.document',
      'xls': 'com.microsoft.excel.xls',
      'xlsx': 'org.openxmlformats.spreadsheetml.sheet',
      'txt': 'public.plain-text',
      'csv': 'public.comma-separated-values-text',
      'xml': 'public.xml',
      'json': 'public.json',
      'zip': 'public.zip-archive',
      'jpg': 'public.jpeg',
      'jpeg': 'public.jpeg',
      'png': 'public.png',
      'gif': 'com.compuserve.gif',
    };
    return utis[extension] ?? 'public.data';
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

      {selectedFile && (
        <FilePreviewModal
          visible={previewModalVisible}
          onClose={() => {
            setPreviewModalVisible(false);
            setSelectedFile(null);
          }}
          fileName={selectedFile.name}
          filePath={selectedFile.path}
          fileExtension={selectedFile.extension}
        />
      )}
    </ThemedView>
  );
};
