import { File } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { FilePreviewModal } from '@/components/common/FilePreviewModal';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
const TEXT_EXTENSIONS = ['txt', 'md', 'json', 'csv', 'log', 'xml', 'js', 'ts', 'tsx', 'jsx', 'html', 'css'];
const PREVIEWABLE_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...TEXT_EXTENSIONS]);

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  xml: 'application/xml',
  json: 'application/json',
  zip: 'application/zip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
};

const getExtension = (fileName: string): string => fileName.split('.').pop()?.toLowerCase() ?? '';

const resolveMimeType = (fileName: string, explicit?: string): string => {
  if (explicit && explicit !== 'application/octet-stream') {
    return explicit;
  }
  return MIME_TYPES[getExtension(fileName)] ?? explicit ?? 'application/octet-stream';
};

export type OpenAttachmentInput = {
  /** Absolute path to the decrypted file on disk. */
  filePath: string;
  /** Display name (with extension) used for previews and share dialogs. */
  fileName: string;
  /** Optional MIME type hint (e.g. from the server). Falls back to extension-based lookup. */
  mimeType?: string;
};

type ModalState = {
  filePath: string;
  fileName: string;
  fileExtension: string;
  resolve: () => void;
};

/**
 * Hook that opens an attachment using the best-available viewer:
 *   1. In-app preview for images and text files.
 *   2. Android: ACTION_VIEW intent so the OS picks the default viewer (Photos, PDF reader, etc.).
 *   3. Fallback: share sheet (iOS for everything non-previewable, Android when no viewer is registered).
 */
export const useAttachmentViewer = (): {
  openAttachment: (input: OpenAttachmentInput) => Promise<void>;
  viewerElement: React.ReactNode;
} => {
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const modalResolveRef = useRef<(() => void) | null>(null);

  const closeModal = useCallback((): void => {
    setModalState(null);
    modalResolveRef.current?.();
    modalResolveRef.current = null;
  }, []);

  const openAttachment = useCallback(async ({ filePath, fileName, mimeType }: OpenAttachmentInput): Promise<void> => {
    const extension = getExtension(fileName);
    const resolvedMime = resolveMimeType(fileName, mimeType);

    if (PREVIEWABLE_EXTENSIONS.has(extension)) {
      return new Promise<void>((resolve) => {
        modalResolveRef.current = resolve;
        setModalState({ filePath, fileName, fileExtension: extension, resolve });
      });
    }

    if (Platform.OS === 'android') {
      try {
        const contentUri = new File(filePath).contentUri;
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
          type: resolvedMime,
        });
        return;
      } catch {
        // No app registered for this MIME type; fall through to the share sheet.
      }
    }

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(filePath, {
        mimeType: resolvedMime,
        dialogTitle: fileName,
      });
    }
  }, []);

  const viewerElement = modalState ? (
    <FilePreviewModal
      visible={true}
      onClose={closeModal}
      fileName={modalState.fileName}
      filePath={modalState.filePath}
      fileExtension={modalState.fileExtension}
    />
  ) : null;

  return { openAttachment, viewerElement };
};
