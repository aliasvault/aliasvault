import { BulkFaviconService } from '@aliasvault/client/items/BulkFaviconService';
import { selectFaviconTarget, type FaviconTarget } from '@aliasvault/client/rust/RustCore';
import { importCxf, type CxfImportSummary } from '@aliasvault/client/transfer/import/importers/cxf/CxfImporter';
import { VaultImportWriter } from '@aliasvault/client/transfer/import/writers/VaultImportWriter';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import emitter, { type ItemChangedEvent } from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import LoadingOverlay from '@/components/LoadingOverlay';
import { ThemedButton } from '@/components/themed/ThemedButton';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { IconSymbolName } from '@/components/ui/IconSymbolName';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

import type { ImportPreview } from '@aliasvault/client/transfer/import/writers/ImportDuplicateDetection';

/**
 * Where the import stands.
 */
type ImportStep = 'start' | 'receiving' | 'preview' | 'favicons' | 'importing' | 'done';

/**
 * Import credentials another app on this device exported through the credential exchange standard: receive the
 * document natively, preview it, then write it into the vault.
 * @returns The screen component.
 */
export default function CredentialExchangeImportScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const dbContext = useDb();
  const { showAlert } = useDialog();
  const webApi = useWebApi();
  const { executeVaultMutation } = useVaultMutate();
  const [step, setStep] = useState<ImportStep>('start');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [summary, setSummary] = useState<CxfImportSummary | null>(null);
  const [importFolders, setImportFolders] = useState(true);
  const [extractFavicons, setExtractFavicons] = useState(true);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const faviconAbort = useRef<AbortController | null>(null);
  const faviconCandidates = (preview?.credentials ?? []).filter(credential => !credential.FaviconBytes && (credential.ServiceUrls?.length ?? 0) > 0);
  const tokenChecked = useRef(false);

  /**
   * Receive the document from the other app, parse it and build the preview.
   * @param token - The import token the other app's export launched the app with
   */
  const receive = useCallback(async (token: string): Promise<void> => {
    setStep('receiving');
    try {
      const document = await NativeVaultManager.credentialExchangeImport(token);
      const result = await importCxf(document);
      const sqliteClient = dbContext.sqliteClient;
      if (!sqliteClient) {
        throw new Error('Vault is not available');
      }
      const existingItems = await sqliteClient.items.getAll();
      setPreview(await VaultImportWriter.previewImport(sqliteClient, existingItems, result.Credentials));
      setSummary(result.Summary);
      setStep('preview');
    } catch (error) {
      setStep('start');
      console.error('Credential exchange import failed:', error);
      showAlert(t('common.error'), t('importExport.serviceCard.importErrorGeneric'));
    }
  }, [dbContext.sqliteClient, showAlert, t]);

  useEffect(() => {
    if (tokenChecked.current) {
      return;
    }
    tokenChecked.current = true;
    /**
     * The other app's export launches this screen with a one-shot token; start right away when there is one.
     */
    const takeToken = async (): Promise<void> => {
      try {
        const token = await NativeVaultManager.credentialExchangeTakeImportToken();
        if (token) {
          await receive(token);
        }
      } catch (error) {
        console.error('Could not read the credential exchange token:', error);
      }
    };
    void takeToken();
  }, [receive]);

  /**
   * Fetch the favicons of the items that have a URL, one per domain. Returns null when the user cancelled.
   */
  const fetchFavicons = async (): Promise<Map<string, Uint8Array> | null> => {
    const abort = new AbortController();
    faviconAbort.current = abort;
    const targetsBySource = new Map<string, FaviconTarget>();
    for (const credential of faviconCandidates) {
      const target = await selectFaviconTarget(credential.ServiceUrls ?? []);
      if (target && !targetsBySource.has(target.source)) {
        targetsBySource.set(target.source, target);
      }
    }
    setProgress({ current: 0, total: targetsBySource.size });
    setStep('favicons');
    const result = await BulkFaviconService.extractBulk(webApi, [...targetsBySource.values()], current => setProgress({ current, total: targetsBySource.size }), abort.signal);
    return abort.signal.aborted ? null : result.favicons;
  };

  /**
   * Stop the favicon extraction and go back to the preview.
   */
  const cancelFavicons = (): void => {
    faviconAbort.current?.abort();
    setStep('preview');
  };

  /**
   * Write the previewed credentials into the vault and sync, after fetching favicons when asked.
   */
  const handleImport = async (): Promise<void> => {
    const sqliteClient = dbContext.sqliteClient;
    if (!preview || !sqliteClient) {
      return;
    }
    const total = preview.credentials.length + preview.enrichments.length;
    if (total === 0) {
      showAlert(t('common.notice'), t('importExport.serviceCard.noNewCredentials'));
      return;
    }

    try {
      const extractedFavicons = extractFavicons && faviconCandidates.length > 0 ? await fetchFavicons() : new Map<string, Uint8Array>();
      if (!extractedFavicons) {
        return;
      }
      setStep('importing');
      setProgress({ current: 0, total });
      await executeVaultMutation(async () => {
        const folderNameToId = importFolders && preview.folderPaths.length > 0 ? await VaultImportWriter.createOrGetFolders(sqliteClient, preview.folderPaths) : null;
        await VaultImportWriter.importCredentialsToVault(sqliteClient, preview.credentials, {
          folderNameToId,
          enrichments: preview.enrichments,
          importAttachments: false,
          extractedFavicons,
          /**
           * Show how many items were saved so far.
           */
          onProgress: (saved: number, total: number): void => setProgress({ current: saved, total }),
        });
      });
      emitter.emit('itemChanged', {} as ItemChangedEvent);
      setStep('done');
    } catch (error) {
      console.error('Credential exchange import failed to save:', error);
      setStep('preview');
      showAlert(t('common.error'), t('importExport.serviceCard.importErrorGeneric'));
    }
  };

  /**
   * Leave for the vault. Once the tab has switched, the settings stack returns to its home behind it so the settings tab does not keep showing this screen.
   */
  const goToVault = (): void => {
    const unsubscribe = navigation.addListener('blur', () => {
      unsubscribe();
      navigation.dispatch((navigation.getState()?.routes.length ?? 1) > 1 ? { type: 'POP_TO_TOP' } : { type: 'REPLACE', payload: { name: 'index' } });
    });
    router.navigate('/(tabs)/items');
  };

  const styles = StyleSheet.create({
    done: {
      paddingVertical: 24,
    },
    doneIcon: {
      alignSelf: 'center',
    },
    doneText: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 20,
      textAlign: 'center',
    },
    doneTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 8,
      marginTop: 12,
      textAlign: 'center',
    },
    countIcon: {
      marginRight: 10,
    },
    countLabel: {
      color: colors.textMuted,
      flex: 1,
      fontSize: 15,
    },
    countRow: {
      alignItems: 'center',
      flexDirection: 'row',
      paddingVertical: 6,
    },
    countValue: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    note: {
      backgroundColor: colors.tertiary + '20',
      borderRadius: 8,
      marginTop: 12,
      padding: 12,
    },
    noteText: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    section: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 16,
      padding: 16,
    },
    sectionDescription: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 16,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 8,
    },
    switchRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 12,
    },
    switchText: {
      color: colors.text,
      flex: 1,
      fontSize: 15,
      marginRight: 12,
    },
    warning: {
      backgroundColor: colors.warningBackground,
      borderRadius: 8,
      marginTop: 12,
      padding: 12,
    },
    warningText: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
  });

  const iconProps = { size: 18, color: colors.textMuted, style: styles.countIcon };

  /**
   * One count line of the preview summary.
   */
  const countRow = (label: string, value: number, icon: React.ReactNode): React.ReactNode => (
    <View style={styles.countRow} key={label}>
      {icon}
      <ThemedText style={styles.countLabel}>{label}</ThemedText>
      <ThemedText style={styles.countValue}>{value}</ThemedText>
    </View>
  );

  return (
    <>
      {step === 'receiving' && <LoadingOverlay status={t('common.loading')} />}
      {step === 'favicons' && <LoadingOverlay status={t('importExport.serviceCard.extractingFavicons', { current: progress.current, total: progress.total })} onCancel={cancelFavicons} />}
      {step === 'importing' && <LoadingOverlay status={t('importExport.serviceCard.savingCredentials', { current: progress.current, total: progress.total })} />}
      <ThemedContainer>
        <ThemedScrollView>
          {step !== 'preview' && step !== 'done' && (
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>{t('settings.credentialExchange.importTitle')}</ThemedText>
              <ThemedText style={styles.sectionDescription}>{t('settings.credentialExchange.importInstructionsIos')}</ThemedText>
            </View>
          )}

          {step === 'preview' && preview && summary && (
            <>
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>{t('settings.credentialExchange.importTitle')}</ThemedText>
                <ThemedText style={styles.sectionDescription}>{t('importExport.serviceCard.previewInstructions')}</ThemedText>
                {countRow(t('items.title'), preview.credentials.length, <IconSymbol name={IconSymbolName.Key} {...iconProps} />)}
                {countRow(t('common.password'), summary.passwords, <MaterialIcons name="password" {...iconProps} />)}
                {countRow(t('common.passkeys'), summary.passkeys, <MaterialIcons name="vpn-key" {...iconProps} />)}
                {countRow(t('common.twoFactorAuthentication'), summary.totpCodes, <MaterialIcons name="access-time" {...iconProps} />)}
                {countRow(t('common.notes'), summary.notes, <MaterialIcons name="notes" {...iconProps} />)}
                {countRow(t('itemTypes.creditCard.title'), summary.creditCards, <MaterialIcons name="credit-card" {...iconProps} />)}

                {preview.enrichments.length > 0 && (
                  <View style={styles.note}>
                    <ThemedText style={styles.noteText}>{t('importExport.serviceCard.existingItemsUpdateInfo', { count: preview.enrichments.length })}</ThemedText>
                  </View>
                )}
                {preview.duplicateCount > 0 && (
                  <View style={styles.note}>
                    <ThemedText style={styles.noteText}>{t('importExport.serviceCard.duplicateCredentialsWarning', { count: preview.duplicateCount })}</ThemedText>
                  </View>
                )}
                {summary.savedAsCustomFields > 0 && (
                  <View style={styles.note}>
                    <ThemedText style={styles.noteText}>{t('settings.credentialExchange.summaryCustomFields', { count: summary.savedAsCustomFields })}</ThemedText>
                  </View>
                )}
                {summary.unsupported > 0 && (
                  <View style={styles.note}>
                    <ThemedText style={styles.noteText}>{t('settings.credentialExchange.summaryUnsupported', { count: summary.unsupported })}</ThemedText>
                  </View>
                )}
                {summary.failedItems > 0 && (
                  <View style={styles.warning}>
                    <ThemedText style={styles.warningText}>{t('importExport.serviceCard.importPartialFailureWarning', { count: summary.failedItems })}</ThemedText>
                  </View>
                )}
                {preview.folderPaths.length > 0 && (
                  <View style={styles.switchRow}>
                    <ThemedText style={styles.switchText}>
                      {t('importExport.serviceCard.importFoldersLabel')} ({t('importExport.serviceCard.foldersDetected', { count: preview.folderPaths.length })})
                    </ThemedText>
                    <Switch value={importFolders} onValueChange={setImportFolders} trackColor={{ false: colors.accentBorder, true: colors.primary }} />
                  </View>
                )}
                {faviconCandidates.length > 0 && (
                  <View style={styles.switchRow}>
                    <ThemedText style={styles.switchText}>{t('importExport.serviceCard.extractFaviconsLabel')}</ThemedText>
                    <Switch value={extractFavicons} onValueChange={setExtractFavicons} trackColor={{ false: colors.accentBorder, true: colors.primary }} />
                  </View>
                )}
              </View>

              <View style={styles.section}>
                <ThemedButton title={t('importExport.serviceCard.importButton')} onPress={() => void handleImport()} disabled={preview.credentials.length + preview.enrichments.length === 0} testID="credential-exchange-import-button" />
              </View>
            </>
          )}

          {step === 'done' && preview && (
            <View style={[styles.section, styles.done]}>
              <MaterialIcons name="check-circle" size={64} color={colors.success} style={styles.doneIcon} />
              <ThemedText style={styles.doneTitle}>{t('common.success')}</ThemedText>
              <ThemedText style={styles.doneText}>{t('importExport.serviceCard.importSuccessMessage', { count: preview.credentials.length + preview.enrichments.length })}</ThemedText>
              <ThemedButton title={t('common.goToVault')} onPress={goToVault} testID="credential-exchange-import-done-button" />
            </View>
          )}
        </ThemedScrollView>
      </ThemedContainer>
    </>
  );
}
