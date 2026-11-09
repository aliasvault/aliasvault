import { Buffer } from 'buffer';

import { decryptEmail, decryptEmailAttachment, type DecryptedEmail } from '@aliasvault/client/email/EmailDecryption';
import { decodeEmailSource, extractEmailAttachment, type ParsedEmailAttachment } from '@aliasvault/client/rust/RustCore';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Paths } from 'expo-file-system';
import { useLocalSearchParams, useRouter, useNavigation, Stack } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type TextStyle, ActivityIndicator, Linking, Text, TextInput, Platform, Pressable, ScrollView, RefreshControl } from 'react-native';
import ContextMenu, { type ContextMenuAction } from 'react-native-context-menu-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import ConversionUtility from '@/utils/ConversionUtility';
import type { DisplayItem } from '@/utils/DisplayItem';
import emitter from '@/utils/EventEmitter';
import { getFileForFilename } from '@/utils/FileUtility';
import { itemRoute } from '@/utils/ItemRoute';
import { isServerUnreachable } from '@/utils/ServerReachability';

import { useAttachmentViewer } from '@/hooks/useAttachmentViewer';
import { useColors } from '@/hooks/useColorScheme';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { IconSymbolName } from '@/components/ui/IconSymbolName';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';

import type { Email } from '@aliasvault/models/webapi';

/**
 * Read-only text the user can partly select and copy (a selectable Text on iOS only copies all of it).
 */
function SelectableText({ text, style }: { text: string; style: StyleProp<TextStyle> }): React.ReactNode {
  if (Platform.OS === 'ios') {
    return <TextInput multiline editable={false} scrollEnabled={false} style={style} value={text} />;
  }
  return <Text selectable style={style}>{text}</Text>;
}

/**
 * Email details screen.
 */
export default function EmailDetailsScreen() : React.ReactNode {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const navigation = useNavigation();
  const dbContext = useDb();
  const webApi = useWebApi();
  const colors = useColors();
  const { t } = useTranslation();
  const { openAttachment, viewerElement } = useAttachmentViewer();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  // The source bytes stay in a ref, out of state; decrypted only records whether there are any.
  const [decrypted, setDecrypted] = useState<(Omit<DecryptedEmail, 'sourceBytes'> & { hasSource: boolean }) | null>(null);
  const sourceBytesRef = useRef<Uint8Array | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMetadataMaximized, setMetadataMaximized] = useState(false);
  const [viewMode, setViewMode] = useState<'html' | 'plain' | 'source'>('html');
  const [associatedItem, setAssociatedItem] = useState<DisplayItem | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const email = decrypted?.email ?? null;
  const htmlBody = decrypted?.htmlBody ?? null;
  const textBody = decrypted?.textBody ?? null;
  const hasSource = decrypted?.hasSource ?? false;

  /**
   * Load the email.
   */
  const loadEmail = useCallback(async () : Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      if (!dbContext?.sqliteClient || !id) {
        return;
      }

      // Check if we are in offline mode
      if (dbContext.isOffline) {
        setError(t('emails.offlineMessage'));
        setIsLoading(false);
        return;
      }

      const response = await webApi.get<Email>(`Email/${id}`);

      // Decrypt email locally using public/private key pairs
      const encryptionKeys = await dbContext.sqliteClient.encryptionKeys.getAll();
      const decryptedEmail = await decryptEmail(response, encryptionKeys);
      const { sourceBytes, ...parsedEmail } = decryptedEmail;
      sourceBytesRef.current = sourceBytes;
      setDecrypted({ ...parsedEmail, hasSource: sourceBytes !== null });
      setSourceText(null);

      // Look up associated item
      if (decryptedEmail.email.toLocal && decryptedEmail.email.toDomain) {
        const emailAddress = `${decryptedEmail.email.toLocal}@${decryptedEmail.email.toDomain}`;
        const match: { Id: string; ManifestId?: string } | null = await dbContext.sqliteClient.items.findIdByEmail(emailAddress);
        const item = match?.ManifestId ? await dbContext.sqliteClient.items.getById({ Id: match.Id, ManifestId: match.ManifestId }) : null;
        setAssociatedItem(item);
      }

      // Set initial view mode based on content: prefer HTML, fall back to plain, then source.
      if (decryptedEmail.htmlBody) {
        setViewMode('html');
      } else if (decryptedEmail.textBody) {
        setViewMode('plain');
      } else if (decryptedEmail.sourceBytes) {
        setViewMode('source');
      }
    } catch (err) {
      if (await isServerUnreachable()) {
        await dbContext.setIsOffline(true);
        setError(t('emails.offlineMessage'));
        return;
      }

      /*
       * Suppress errors while vault has unsynced changes
       * Network errors during sync can trigger false positives
       */
      if (dbContext.shouldSuppressEmailErrors()) {
        setIsLoading(false);
        return;
      }

      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setIsLoading(false);
    }
  }, [dbContext, id, webApi, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadEmail is async; setState only fires after data is fetched
    loadEmail();
  }, [id, loadEmail]);

  /*
   * The raw source is decoded on demand, the first time the source view is opened.
   */
  useEffect(() => {
    const sourceBytes = sourceBytesRef.current;
    if (viewMode !== 'source' || sourceText !== null || !decrypted?.hasSource || !sourceBytes) {
      return;
    }
    decodeEmailSource(sourceBytes)
      .then(decoded => setSourceText(Buffer.from(decoded).toString('utf8')))
      .catch(err => setError(err instanceof Error ? err.message : t('common.errors.unknownError')));
  }, [viewMode, sourceText, decrypted, t]);

  /**
   * Handle the delete button press.
   */
  const handleDelete = useCallback(() : void => {
    setShowDeleteConfirm(true);
  }, []);

  /**
   * Confirm and execute email deletion.
   */
  const confirmDelete = useCallback(async () : Promise<void> => {
    try {
      // Delete the email from the server.
      await webApi.delete(`Email/${id}`);

      // Refresh the emails list in the index screen.
      emitter.emit('refreshEmails');

      // Go back to the emails list screen.
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
    }
    setShowDeleteConfirm(false);
  }, [id, router, webApi, t]);

  /**
   * Hide delete confirmation dialog.
   */
  const hideDeleteConfirm = useCallback((): void => {
    setShowDeleteConfirm(false);
  }, []);

  /**
   * Handle the download attachment button press: the bytes come out of the parsed source, a detached part is
   * fetched and decrypted first.
   */
  const handleDownloadAttachment = async (attachment: ParsedEmailAttachment, index: number) : Promise<void> => {
    try {
      const sourceBytes = sourceBytesRef.current;
      if (!dbContext?.sqliteClient || !email || !sourceBytes) {
        setError(t('common.errors.unknownError'));
        return;
      }

      const encryptionKeys = await dbContext.sqliteClient.encryptionKeys.getAll();
      const encryptedPart = attachment.detached ? await webApi.downloadBlob(`Email/${email.id}/parts/${attachment.partIndex}`) : null;
      const detachedBody = encryptedPart ? await decryptEmailAttachment(encryptedPart, email, encryptionKeys) : undefined;
      const decryptedBytes = await extractEmailAttachment(sourceBytes, index, detachedBody);

      const tempFile = getFileForFilename(Paths.cache, attachment.filename);
      if (tempFile.exists) {
        tempFile.delete();
      }
      tempFile.create();
      await tempFile.write(decryptedBytes);

      try {
        await openAttachment({
          filePath: tempFile.uri,
          fileName: attachment.filename,
          mimeType: attachment.mimeType,
        });
      } finally {
        if (tempFile.exists) {
          tempFile.delete();
        }
      }
    } catch (err) {
      console.error('handleDownloadAttachment error', err);
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
    }
  };

  /**
   * Open links tapped inside the email body in the external browser.
   */
  const handleShouldStartLoadWithRequest = useCallback((request: WebViewNavigation): boolean => {
    const url = request.url;

    // The email body is injected as static HTML which has no URL of its own, so let that load through.
    if (!url || url === 'about:blank' || url.startsWith('data:') || url.startsWith('file://')) {
      return true;
    }

    Linking.openURL(url).catch(() => {
      // Ignore links the OS has no handler for.
    });

    // Block the navigation so one-time links are only ever opened once, by the external browser.
    return false;
  }, []);

  /**
   * Handle the open item button press.
   */
  const handleOpenItem = () : void => {
    if (associatedItem) {
      router.push(itemRoute(associatedItem));
    }
  };

  // Only offer the formats the parsed source actually holds.
  const availableModes = useMemo<Array<'html' | 'plain' | 'source'>>(() => {
    const modes: Array<'html' | 'plain' | 'source'> = [];
    if (htmlBody) {
      modes.push('html');
    }
    if (textBody) {
      modes.push('plain');
    }
    if (hasSource) {
      modes.push('source');
    }
    return modes;
  }, [htmlBody, textBody, hasSource]);

  const formatLabels = useMemo<Record<'html' | 'plain' | 'source', string>>(() => ({
    html: t('emails.formatHtml'),
    plain: t('emails.formatPlain'),
    source: t('emails.formatSource'),
  }), [t]);

  const styles = StyleSheet.create({
    attachment: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 6,
      flexDirection: 'row',
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    attachmentName: {
      color: colors.textMuted,
      fontSize: 13,
      marginLeft: 6,
    },
    attachments: {
      borderTopColor: colors.accentBorder,
      borderTopWidth: 1,
      gap: 4,
      paddingBottom: Platform.OS === 'ios' ? insets.bottom + 8 : 8,
      paddingHorizontal: 12,
      paddingTop: 8,
    },
    attachmentsTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 6,
    },
    centerContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: 20,
    },
    container: {
      flex: 1,
    },
    divider: {
      backgroundColor: colors.accentBorder,
      height: 1,
      marginVertical: 2,
    },
    dividerLast: {
      marginBottom: 0,
    },
    emptyText: {
      color: colors.textMuted,
      opacity: 0.7,
      textAlign: 'center',
    },
    errorText: {
      color: colors.errorBackground,
      textAlign: 'center',
    },
    headerRightButton: {
      padding: 10,
      paddingRight: 10,
    },
    inlineError: {
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    metadataContainer: {
      padding: 2,
      paddingBottom: 0,
    },
    metadataItem: {
      alignItems: 'center',
      alignSelf: 'center',
      flexDirection: 'row',
    },
    metadataItemIcon: {
      marginRight: 4,
    },
    metadataHeading: {
      color: colors.text,
      fontSize: 13,
      fontWeight: 'bold',
      marginBottom: 0,
      marginTop: 0,
      paddingBottom: 0,
      paddingTop: 0,
    },
    metadataLabel: {
      paddingBottom: 4,
      paddingLeft: 5,
      paddingTop: 4,
      width: 60,
    },
    metadataRow: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      padding: 2,
    },
    metadataSubject: {
      fontWeight: 'bold',
      textAlign: 'center',
    },
    metadataText: {
      color: colors.text,
      fontSize: 13,
      marginBottom: 0,
      marginTop: 0,
      paddingBottom: 0,
      paddingTop: 0,
    },
    metadataValue: {
      flex: 1,
      paddingBottom: 4,
      paddingLeft: 5,
      paddingTop: 4,
    },
    plainText: {
      backgroundColor: '#ffffff',
      color: '#000000',
      flex: 1,
      fontSize: 15,
      padding: 16,
    },
    refreshContainer: {
      alignItems: 'center',
      flexGrow: 1,
      justifyContent: 'center',
      padding: 20,
    },
    sourceText: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 12,
    },
    textContainer: {
      backgroundColor: '#ffffff',
      flex: 1,
    },
    webView: {
      flex: 1,
    },
  });

  // Header menu on Android. On iOS the same entries live in one native menu (the toolbar below), which the iPhone Duo bar rail picks up.
  useEffect(() => {
    if (Platform.OS === 'ios') {
      return;
    }
    // The Android menu has no checkmarks, so the active format is shown disabled.
    const entries: Array<{ action: ContextMenuAction; key: 'details' | 'delete' | 'html' | 'plain' | 'source' }> = [
      { action: { title: isMetadataMaximized ? t('common.hideDetails') : t('common.showDetails') }, key: 'details' },
      ...(availableModes.length > 1 ? availableModes.map(mode => ({ action: { title: formatLabels[mode], disabled: viewMode === mode }, key: mode })) : []),
      { action: { title: t('common.delete'), destructive: true }, key: 'delete' },
    ];

    /**
     * Runs the header menu entry at the given index.
     */
    const handleMenuPress = (index: number): void => {
      const key = entries[index]?.key;
      if (key === 'details') {
        setMetadataMaximized(prev => !prev);
      } else if (key === 'delete') {
        handleDelete();
      } else if (key) {
        setViewMode(key);
      }
    };

    navigation.setOptions({
      /**
       * Header right button.
       */
      headerRight: () => (
        <ContextMenu actions={entries.map(entry => entry.action)} onPress={(event) => handleMenuPress(event.nativeEvent.index)} dropdownMenuMode>
          <Pressable onPress={() => undefined} style={styles.headerRightButton} android_ripple={{ color: colors.accentBorder, borderless: true, radius: 22 }} accessibilityRole="button" accessibilityLabel={t('common.moreOptions')}>
            <MaterialIcons name="more-vert" size={24} color={colors.primary} />
          </Pressable>
        </ContextMenu>
      ),
    });
  }, [navigation, handleDelete, colors.primary, colors.accentBorder, styles.headerRightButton, availableModes, formatLabels, viewMode, isMetadataMaximized, t]);

  if (isLoading) {
    return (
      <ThemedView style={styles.centerContainer}>
        <Stack.Screen options={{ title: t('emails.emailDetails') }} />
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  // A failed load stays pull-to-refreshable; errors on a loaded email show inline below.
  if (error && !email) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: t('emails.emailDetails') }} />
        <ScrollView
          contentContainerStyle={styles.refreshContainer}
          alwaysBounceVertical={true}
          refreshControl={<RefreshControl refreshing={false} onRefresh={loadEmail} colors={[colors.primary]} tintColor={colors.primary} />}
        >
          <ThemedText style={styles.errorText}>{t('common.error')}: {error}</ThemedText>
        </ScrollView>
      </ThemedView>
    );
  }

  if (!email) {
    return (
      <ThemedView style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>{t('emails.emailNotFound')}</ThemedText>
      </ThemedView>
    );
  }

  // The details (subject, date, from, to) are hidden until opened from the header; the subject is the screen title.
  let metadataView = null;
  if (isMetadataMaximized) {
    metadataView = (
      <View style={styles.metadataContainer}>
        <View style={styles.metadataRow}>
          <View style={styles.metadataValue}>
            <SelectableText style={[styles.metadataText, styles.metadataSubject]} text={email.subject} />
            {associatedItem && (
              <View>
                <RobustPressable
                  onPress={handleOpenItem}
                  style={styles.metadataItem}
                >
                  <IconSymbol size={16} name={IconSymbolName.Key} color={colors.primary} style={styles.metadataItemIcon} />
                  <ThemedText style={[styles.metadataText, { color: colors.primary }]}>
                    {associatedItem.Name}
                  </ThemedText>
                </RobustPressable>
              </View>
            )}
          </View>
        </View>
        <View style={styles.divider} />

        <View style={styles.metadataRow}>
          <View style={styles.metadataLabel}>
            <ThemedText style={styles.metadataHeading}>{t('emails.date')}</ThemedText>
          </View>
          <View style={styles.metadataValue}>
            <SelectableText style={styles.metadataText} text={new Date(email.dateSystem).toLocaleString()} />
          </View>
        </View>
        <View style={styles.divider} />

        <View style={styles.metadataRow}>
          <View style={styles.metadataLabel}>
            <ThemedText style={styles.metadataHeading}>{t('emails.from')}</ThemedText>
          </View>
          <View style={styles.metadataValue}>
            <SelectableText style={styles.metadataText} text={`${email.fromDisplay} (${email.fromLocal}@${email.fromDomain})`} />
          </View>
        </View>
        <View style={styles.divider} />

        <View style={styles.metadataRow}>
          <View style={styles.metadataLabel}>
            <ThemedText style={styles.metadataHeading}>{t('emails.to')}</ThemedText>
          </View>
          <View style={styles.metadataValue}>
            <SelectableText style={styles.metadataText} text={`${email.toLocal}@${email.toDomain}`} />
          </View>
        </View>
        <View style={[styles.divider, styles.dividerLast]} />
      </View>
    );
  }

  let emailView = null;
  if (viewMode === 'html' && htmlBody) {
    // Sanitize HTML
    const sanitizedHtml = ConversionUtility.sanitizeHtmlForEmailViewing(htmlBody);
    emailView = (
      <WebView
        style={styles.webView}
        source={{ html: sanitizedHtml }}
        scrollEnabled={true}
        javaScriptEnabled={false}
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
      />
    );
  } else {
    const isSource = viewMode === 'source';
    const text = (isSource ? sourceText ?? t('common.loading') : textBody) ?? '';
    const textStyle = [
      styles.plainText,
      isSource ? styles.sourceText : null,
    ];
    emailView = (
      <View style={styles.textContainer}>
        {Platform.OS === 'ios' ? (
          <TextInput
            multiline
            editable={false}
            selectTextOnFocus={true}
            style={textStyle}
            value={text}
          />
        ) : (
          <Text selectable style={textStyle}>
            {text}
          </Text>
        )}
      </View>
    );
  }

  return (
    <>
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: email.subject || email.fromDisplay || t('emails.emailDetails') }} />
        {Platform.OS === 'ios' && (
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={t('emails.emailDetails')}>
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction icon="info.circle" isOn={isMetadataMaximized} onPress={() => setMetadataMaximized(prev => !prev)}>{t('common.showDetails')}</Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
              {availableModes.length > 1 && (
                <Stack.Toolbar.Menu inline title={t('emails.formatSwitchTitle')}>
                  {availableModes.map((mode) => (
                    <Stack.Toolbar.MenuAction key={mode} isOn={viewMode === mode} onPress={() => setViewMode(mode)}>{formatLabels[mode]}</Stack.Toolbar.MenuAction>
                  ))}
                </Stack.Toolbar.Menu>
              )}
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction icon="trash" destructive onPress={handleDelete}>{t('common.delete')}</Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        )}
        {metadataView}
        {error && (
          <View style={styles.inlineError}>
            <ThemedText style={styles.errorText}>{t('common.error')}: {error}</ThemedText>
          </View>
        )}
        {emailView}
        {decrypted && decrypted.attachments.length > 0 && (
          <View style={styles.attachments}>
            <ThemedText style={styles.attachmentsTitle}>{t('common.attachments')}</ThemedText>
            {decrypted.attachments.map((attachment, index) => (
              <RobustPressable
                key={`${index}-${attachment.filename}`}
                style={styles.attachment}
                onPress={() => handleDownloadAttachment(attachment, index)}
              >
                <Ionicons name="attach" size={20} color="#666" />
                <ThemedText style={styles.attachmentName}>
                  {attachment.filename} ({Math.ceil(attachment.size / 1024)} {t('emails.sizeKB')})
                </ThemedText>
              </RobustPressable>
            ))}
          </View>
        )}
      </ThemedView>

      {viewerElement}

      <ConfirmDialog
        isVisible={showDeleteConfirm}
        title={t('emails.deleteEmail')}
        message={t('emails.deleteEmailConfirm')}
        buttons={[
          {
            text: t('common.cancel'),
            style: 'cancel',
            onPress: hideDeleteConfirm,
          },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: confirmDelete,
          },
        ]}
        onClose={hideDeleteConfirm}
      />
    </>
  );
}