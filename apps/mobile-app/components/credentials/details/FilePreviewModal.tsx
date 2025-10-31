import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Alert
} from 'react-native';
import ImageViewer from 'react-native-image-zoom-viewer';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

type FilePreviewModalProps = {
  visible: boolean;
  /**
   * Close modal handler.
   */
  onClose: () => void;
  fileName: string;
  filePath: string;
  fileExtension: string;
};

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

/**
 * File preview modal component for displaying images and text files.
 */
export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  visible,
  onClose,
  fileName,
  filePath,
  fileExtension,
}) => {
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [fileSize, setFileSize] = useState<string>('');
  const colors = useColors();
  const { t } = useTranslation();

  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
  const textExtensions = ['txt', 'md', 'json', 'csv', 'log', 'xml', 'js', 'ts', 'tsx', 'jsx', 'html', 'css'];

  const isImage = imageExtensions.includes(fileExtension.toLowerCase());
  const isText = textExtensions.includes(fileExtension.toLowerCase());

  /**
   * Get file size formatted string.
   */
  const getFileSize = useCallback(async (): Promise<void> => {
    try {
      const fileInfo = await FileSystem.getInfoAsync(filePath);
      if (fileInfo.exists && 'size' in fileInfo) {
        const size = fileInfo.size;
        if (size < 1024) {
          setFileSize(`${size} B`);
        } else if (size < 1024 * 1024) {
          setFileSize(`${(size / 1024).toFixed(1)} KB`);
        } else {
          setFileSize(`${(size / (1024 * 1024)).toFixed(1)} MB`);
        }
      }
    } catch (error) {
      console.error('Error getting file size:', error);
    }
  }, [filePath]);

  /**
   * Load text file content.
   */
  const loadTextFile = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const content = await FileSystem.readAsStringAsync(filePath);
      setFileContent(content);
    } catch (error) {
      console.error('Error reading text file:', error);
      Alert.alert('Error', 'Could not read file content');
      setFileContent('Error loading file content');
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    if (visible) {
      getFileSize();
      if (isText) {
        loadTextFile();
      } else {
        setLoading(false);
      }
    }
  }, [visible, filePath, isText, loadTextFile, getFileSize]);

  /**
   * Download file to system.
   */
  const downloadFile = async (): Promise<void> => {
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, {
          dialogTitle: `Save ${fileName}`,
        });
      } else {
        Alert.alert(
          t('credentials.fileReady'),
          `${t('credentials.fileSavedTo')}: ${filePath}`
        );
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      Alert.alert('Error', 'Failed to download file');
    }
  };

  const styles = StyleSheet.create({
    closeButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 20,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    downloadButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 20,
      height: 40,
      justifyContent: 'center',
      marginRight: 12,
      width: 40,
    },
    fileInfo: {
      flex: 1,
      marginRight: 12,
    },
    fileName: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 2,
    },
    fileSize: {
      fontSize: 12,
      opacity: 0.7,
    },
    header: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderBottomColor: colors.text + '20',
      borderBottomWidth: 1,
      flexDirection: 'row',
      paddingBottom: 12,
      paddingHorizontal: 20,
      paddingTop: 60,
    },
    headerButtons: {
      flexDirection: 'row',
    },
    image: {
      height: screenHeight * 0.8,
      resizeMode: 'contain',
      width: screenWidth,
    },
    loadingText: {
      fontSize: 16,
      textAlign: 'center',
    },
    modalView: {
      backgroundColor: colors.background,
      flex: 1,
    },
    scrollContainer: {
      flexGrow: 1,
    },
    textContent: {
      fontFamily: 'monospace',
      fontSize: 13,
      lineHeight: 20,
      padding: 20,
    },
    textScrollView: {
      flex: 1,
    },
    unsupportedContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: 40,
    },
    unsupportedSubtext: {
      fontSize: 14,
      opacity: 0.7,
      textAlign: 'center',
    },
    unsupportedText: {
      fontSize: 16,
      marginBottom: 16,
      textAlign: 'center',
    },
  });

  /**
   * Render the file content based on file type.
   */
  const renderContent = (): React.ReactNode => {
    if (loading) {
      return (
        <View style={styles.unsupportedContainer}>
          <ThemedText style={styles.loadingText}>
            {t('common.loading')}...
          </ThemedText>
        </View>
      );
    }

    if (isImage) {
      const imageUrls = [{ url: filePath }];

      return (
        <ImageViewer
          imageUrls={imageUrls}
          enableSwipeDown={false}
          backgroundColor={colors.background}
          /**
           * Handle image load failure.
           */
          onLoadFailure={(): void => Alert.alert('Error', 'Could not load image')}
        />
      );
    }

    if (isText) {
      return (
        <ScrollView style={styles.textScrollView}>
          <ThemedText style={styles.textContent}>
            {fileContent}
          </ThemedText>
        </ScrollView>
      );
    }

    return (
      <View style={styles.unsupportedContainer}>
        <Ionicons name="document-outline" size={80} color={colors.text} />
        <ThemedText style={styles.unsupportedText}>
          {t('credentials.previewNotSupported')}
        </ThemedText>
        <ThemedText style={styles.unsupportedSubtext}>
          {t('credentials.downloadToView')}
        </ThemedText>
      </View>
    );
  };

  return (
    <Modal
      animationType="slide"
      transparent={false}
      visible={visible}
      onRequestClose={onClose}
    >
      <ThemedView style={styles.modalView}>
        <View style={styles.header}>
          <View style={styles.fileInfo}>
            <ThemedText style={styles.fileName} numberOfLines={1}>
              {fileName}
            </ThemedText>
            {fileSize ? (
              <ThemedText style={styles.fileSize}>
                {fileSize}
              </ThemedText>
            ) : null}
          </View>
          <View style={styles.headerButtons}>
            <TouchableOpacity style={styles.downloadButton} onPress={downloadFile}>
              <Ionicons name="download-outline" size={20} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
        {renderContent()}
      </ThemedView>
    </Modal>
  );
};
