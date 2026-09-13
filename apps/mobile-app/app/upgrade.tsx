import { VaultVersionIncompatibleError } from '@aliasvault/client/api/errors/VaultVersionIncompatibleError';
import { AppInfo } from '@aliasvault/client/platform/AppInfo';
import { VaultSqlGenerator } from '@aliasvault/vault';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, KeyboardAvoidingView, Platform, ScrollView, Dimensions, TouchableWithoutFeedback, Keyboard, Text } from 'react-native';

import { AppErrorCode, extractErrorCode, formatErrorWithCode, getErrorTranslationKey } from '@/utils/types/errors/AppErrorCodes';

import { useColors } from '@/hooks/useColorScheme';
import { useLogout } from '@/hooks/useLogout';

import Logo from '@/assets/images/logo.svg';
import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { Avatar } from '@/components/ui/Avatar';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

import type { VaultVersion } from '@aliasvault/vault';

/** What the page is currently showing. */
type Stage = 'classifying' | 'consent' | 'upgrading' | 'success';

/**
 * Which upgrade the page is serving. All three land the vault on the current storage model; they differ in what
 * they cost the user, which is what decides whether the page asks first.
 */
enum UpgradeKind {
  /**
   * The legacy sqlite-blob upgrade chain (VAULT_VERSIONS, frozen at 2.0.0), applied as SQL against the local
   * vault. Asks first, and shows which vault version it moves the user to.
   *
   * TODO: delete this branch together with requiresLegacySqliteBlobMigration once all users have migrated.
   */
  LegacySqliteBlob = 'legacy-sqlite-blob',

  /**
   * A rebuild of the local database onto the current schema. Purely local and invisible to the rest of the
   * account. Runs unattended.
   */
  SchemaRebuild = 'schema-rebuild',

  /**
   * The one-way move of the account itself onto the manifest storage format and the account key hierarchy. The
   * push that completes it signs out every client that predates the format. Asks first, and says so.
   */
  StorageFormat = 'storage-format',
}

/** The migration kind the native engine reports for the storage format move (see NativeVaultManager.getVaultMigrationStatus). */
const MIGRATION_STATUS_STORAGE_FORMAT_UPGRADE = 'storage-format-upgrade';

/** Engine failures that end the session instead of a retry on this page. */
const LOGOUT_ERROR_CODES: ReadonlySet<AppErrorCode> = new Set([
  AppErrorCode.SESSION_EXPIRED,
  AppErrorCode.AUTHENTICATION_FAILED,
  AppErrorCode.PASSWORD_CHANGED,
  AppErrorCode.CLIENT_VERSION_NOT_SUPPORTED,
  AppErrorCode.SERVER_VERSION_NOT_SUPPORTED,
  AppErrorCode.VAULT_VERSION_INCOMPATIBLE,
]);

/**
 * The vault upgrade gate.
 *
 * A single screen for every reason the local vault cannot be opened yet, in the order they apply: first the
 * legacy sqlite-blob chain that brings a pre-2.0.0 vault to 2.0.0, then the manifest migration that puts it on
 * the current storage model. When both are pending they run back to back here, so the user sees one upgrade.
 *
 * This is a hard gate: until it finishes, the local database is still on the old schema and every other page
 * would query columns that do not exist yet. Upgrade or sign out are the only two ways out.
 */
export default function UpgradeScreen() : React.ReactNode {
  const app = useApp();
  const { username } = app;
  const { logoutUserInitiated, logoutForced } = useLogout();
  const webApi = useWebApi();
  const dbContext = useDb();
  const { sqliteClient } = dbContext;
  const [stage, setStage] = useState<Stage>('classifying');
  const [kind, setKind] = useState<UpgradeKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<VaultVersion | null>(null);
  const [latestVersion, setLatestVersion] = useState<VaultVersion | null>(null);
  const colors = useColors();
  const { t } = useTranslation();
  const [upgradeStatus, setUpgradeStatus] = useState(() => t('upgrade.status.preparingUpgrade'));
  const { showAlert, showConfirm } = useDialog();
  const hasStarted = useRef(false);

  /**
   * Load version information from the database, which the legacy chain shows the user before it runs.
   */
  const loadVersionInfo = useCallback(async () => {
    if (!sqliteClient) {
      return;
    }
    const current = await sqliteClient.getDatabaseVersion();
    const latest = await sqliteClient.getLatestDatabaseVersion();
    setCurrentVersion(current);
    setLatestVersion(latest);
  }, [sqliteClient]);

  /**
   * Continue into the vault once the whole upgrade has landed.
   */
  const finish = useCallback((): void => {
    dbContext.setDatabaseAvailable();
    router.replace('/(tabs)/items');
  }, [dbContext]);

  /**
   * Show a failed step on the consent screen, where the same button retries. Failures that end the session log out instead.
   * @param code - the error code
   * @param detail - the technical detail, shown under the translated message when it adds something
   */
  const failStep = useCallback(async (code: AppErrorCode, detail: string | null): Promise<void> => {
    const message = formatErrorWithCode(t(getErrorTranslationKey(code)), code);
    if (LOGOUT_ERROR_CODES.has(code)) {
      await app.logout(message);
      return;
    }
    setError(message);
    setErrorDetail(detail && detail !== message ? detail : null);
    setStage('consent');
  }, [app, t]);

  /**
   * Run the manifest migration natively, then continue into the vault.
   * @param migrationKind - what the pending migration does, which decides what is shown afterwards
   */
  const runManifestMigration = useCallback(async (migrationKind: UpgradeKind): Promise<void> => {
    setError(null);
    setErrorDetail(null);
    setKind(migrationKind);
    setStage('upgrading');
    setUpgradeStatus(t('upgrade.upgrading'));

    const result = await NativeVaultManager.migrateVaultManifest();

    if (!result.success) {
      console.error('[Upgrade] Vault manifest migration failed:', result);
      await failStep(extractErrorCode(result.error ?? '') ?? AppErrorCode.UNKNOWN_ERROR, result.errorMessage);
      return;
    }

    if (!result.pushed) {
      // Local vault is migrated and usable; the upload stays pending and the next sync picks it up.
      console.warn('[Upgrade] Vault manifest migration completed locally but has not reached the server yet.');
    }

    // The native store holds a rebuilt vault, so re-open it before any page queries the new schema.
    await dbContext.unlockVault();
    await dbContext.refreshSyncState();

    try {
      await NativeVaultManager.registerCredentialIdentities();
    } catch (err) {
      console.warn('[Upgrade] Failed to register credential identities:', err);
    }

    /*
     * Only the storage format move leaves the user with something to do: their other devices need updating.
     * A schema rebuild changed nothing they can see, so it opens the vault without comment.
     */
    if (migrationKind === UpgradeKind.StorageFormat) {
      setStage('success');
      return;
    }

    finish();
  }, [dbContext, failStep, finish, t]);

  /**
   * Ask the native engine what the manifest migration would do, and either prompt the user or run it.
   */
  const startManifestUpgrade = useCallback(async (): Promise<void> => {
    const pending = await NativeVaultManager.getVaultMigrationStatus();

    if (pending === MIGRATION_STATUS_STORAGE_FORMAT_UPGRADE) {
      setKind(UpgradeKind.StorageFormat);
      setStage('consent');
      return;
    }

    // A local schema rebuild, or nothing left to do at all: both are safe to run unattended.
    await runManifestMigration(UpgradeKind.SchemaRebuild);
  }, [runManifestMigration]);

  /**
   * Walk the legacy sqlite-blob upgrade chain against the local vault. The chain brings the vault to 2.0.0, the
   * point at which the manifest migration becomes applicable, so that is classified right after; its push carries
   * the chain's changes along.
   */
  const performLegacyUpgrade = useCallback(async (): Promise<void> => {
    if (!sqliteClient || !currentVersion || !latestVersion) {
      showAlert(t('common.error'), t('upgrade.alerts.unableToGetVersionInfo'));
      return;
    }

    // Ensure vault is unlocked before upgrade
    if (!(await NativeVaultManager.isVaultUnlocked())) {
      try {
        await NativeVaultManager.unlockVault();
      } catch (err) {
        console.error('Failed to unlock vault for upgrade:', err);
        showAlert(t('common.error'), t('auth.errors.enterPassword'));
        return;
      }
    }

    setError(null);
    setErrorDetail(null);
    setStage('upgrading');
    setUpgradeStatus(t('upgrade.status.preparingUpgrade'));

    try {
      // Get upgrade SQL commands from vault library
      const upgradeResult = new VaultSqlGenerator().getUpgradeVaultSql(currentVersion.revision, latestVersion.revision);

      if (!upgradeResult.success) {
        throw new Error(upgradeResult.error ?? t('upgrade.alerts.upgradeFailed'));
      }

      /*
       * IMPORTANT: Do NOT wrap migration SQL in beginTransaction/commitTransaction!
       * The migration SQL contains PRAGMA foreign_keys statements that MUST be executed
       * outside of any transaction to take effect. The SQL handles its own transactions.
       */
      setUpgradeStatus(t('upgrade.status.applyingDatabaseMigrations'));
      for (let i = 0; i < upgradeResult.sqlCommands.length; i++) {
        setUpgradeStatus(t('upgrade.status.applyingMigration', { current: i + 1, total: upgradeResult.sqlCommands.length }));
        try {
          await NativeVaultManager.executeRaw(upgradeResult.sqlCommands[i]);
        } catch (err) {
          console.error(`Error executing SQL command ${i + 1}:`, upgradeResult.sqlCommands[i], err);
          const detail = err instanceof Error ? err.message : 'Unknown error';
          throw new Error(`${t('upgrade.alerts.failedToApplyMigration', { current: i + 1, total: upgradeResult.sqlCommands.length })}\n\nDetails: ${detail}`);
        }
      }

      if (upgradeResult.sqlCommands.length > 0) {
        // Persist the upgraded database as a pending change; the manifest migration push that follows carries it.
        setUpgradeStatus(t('upgrade.status.committingChanges'));
        await NativeVaultManager.persistAndMarkDirty();
        await dbContext.unlockVault();
      }

      await startManifestUpgrade();
    } catch (err) {
      console.error('Upgrade failed:', err);
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
      setStage('consent');
    }
  }, [sqliteClient, currentVersion, latestVersion, dbContext, showAlert, startManifestUpgrade, t]);

  /**
   * Work out what this vault needs and route to the matching stage. Order matters: a pre-2.0.0 vault has to walk
   * the sqlite-blob chain before the manifest migration can be classified at all.
   */
  useEffect(() => {
    if (!sqliteClient || hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    /**
     * Classify the pending upgrade and show or run it.
     */
    const classify = async (): Promise<void> => {
      try {
        if (await dbContext.requiresLegacySqliteBlobMigration()) {
          setKind(UpgradeKind.LegacySqliteBlob);
          await loadVersionInfo();
          setStage('consent');
          return;
        }

        await startManifestUpgrade();
      } catch (err) {
        if (err instanceof VaultVersionIncompatibleError) {
          await logoutForced();
          return;
        }
        console.error('Failed to determine the pending vault upgrade:', err);
        setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
        setStage('consent');
      }
    };

    void classify();
  }, [sqliteClient, dbContext, loadVersionInfo, startManifestUpgrade, logoutForced, t]);

  /**
   * Handle the upgrade button, which runs whichever upgrade this vault is waiting on.
   */
  const handleUpgrade = async (): Promise<void> => {
    if (kind !== UpgradeKind.LegacySqliteBlob) {
      await runManifestMigration(kind ?? UpgradeKind.StorageFormat);
      return;
    }

    // Check if this is a self-hosted instance and show warning if needed
    if (await webApi.isSelfHosted()) {
      showConfirm(
        t('upgrade.alerts.selfHostedServer'),
        t('upgrade.alerts.selfHostedWarning'),
        t('upgrade.alerts.continueUpgrade'),
        performLegacyUpgrade
      );
      return;
    }

    await performLegacyUpgrade();
  };

  /**
   * Handle the logout - uses the shared useLogout hook which
   * checks for unsynced changes and shows appropriate confirmation dialog.
   */
  const handleLogout = async () : Promise<void> => {
    await logoutUserInitiated();
  };

  /**
   * Show native dialog with version description.
   */
  const showVersionDialog = (): void => {
    showAlert(
      t('upgrade.whatsNew'),
      `${t('upgrade.whatsNewDescription')}\n\n${latestVersion?.description ?? t('upgrade.noDescriptionAvailable')}`
    );
  };

  const styles = StyleSheet.create({
    appName: {
      color: colors.text,
      fontSize: 32,
      fontWeight: 'bold',
      textAlign: 'center',
    },
    avatarContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      marginBottom: 16,
    },
    button: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      height: 50,
      justifyContent: 'center',
      marginBottom: 16,
      width: '100%',
    },
    buttonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
    },
    container: {
      flex: 1,
    },
    content: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      padding: 20,
      width: '100%',
    },
    currentVersionValue: {
      color: colors.primary,
    },
    errorDetail: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 4,
    },
    errorText: {
      color: colors.red,
      fontSize: 14,
      marginBottom: 16,
    },
    gradientContainer: {
      height: Dimensions.get('window').height * 0.4,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    headerSection: {
      paddingBottom: 24,
      paddingHorizontal: 16,
      paddingTop: 24,
    },
    helpButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 20,
      height: 24,
      justifyContent: 'center',
      marginLeft: 8,
      width: 24,
    },
    helpButtonText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: 'bold',
    },
    keyboardAvoidingView: {
      flex: 1,
    },
    latestVersionValue: {
      color: colors.greenBackground,
    },
    loadingContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
    },
    logoContainer: {
      alignItems: 'center',
      marginBottom: 8,
    },
    logoutButton: {
      alignSelf: 'center',
      justifyContent: 'center',
      marginTop: 16,
    },
    logoutButtonText: {
      color: colors.red,
      fontSize: 16,
    },
    mainContent: {
      flex: 1,
      justifyContent: 'center',
      paddingBottom: 40,
      paddingHorizontal: 20,
    },
    scrollContent: {
      flexGrow: 1,
    },
    subtitle: {
      color: colors.text,
      fontSize: 14,
      marginBottom: 24,
      opacity: 0.7,
      textAlign: 'center',
    },
    successIcon: {
      alignItems: 'center',
      marginBottom: 16,
    },
    successText: {
      color: colors.text,
      fontSize: 14,
      marginBottom: 24,
      opacity: 0.7,
      textAlign: 'center',
    },
    successTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '600',
      marginBottom: 12,
      textAlign: 'center',
    },
    username: {
      color: colors.text,
      fontSize: 18,
      opacity: 0.8,
      textAlign: 'center',
    },
    versionContainer: {
      backgroundColor: colors.background,
      borderRadius: 8,
      marginBottom: 16,
      padding: 16,
    },
    versionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      marginBottom: 12,
    },
    versionLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '500',
      opacity: 0.7,
    },
    versionRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    versionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      textAlign: 'center',
    },
    versionValue: {
      color: colors.text,
      fontSize: 16,
      fontWeight: 'bold',
    },
    warningContainer: {
      backgroundColor: colors.background,
      borderRadius: 8,
      marginBottom: 16,
      padding: 16,
    },
    warningText: {
      color: colors.text,
      fontSize: 14,
      opacity: 0.8,
    },
  });

  if (stage === 'classifying' || stage === 'upgrading') {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.loadingContainer}>
          <LoadingIndicator status={stage === 'upgrading' ? upgradeStatus : t('upgrade.status.preparingUpgrade')} />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <LinearGradient
              colors={[colors.loginHeader, colors.background]}
              style={styles.gradientContainer}
            />
            <View style={styles.mainContent}>
              <View style={styles.headerSection}>
                <View style={styles.logoContainer}>
                  <Logo width={80} height={80} />
                  <Text style={styles.appName}>{t('upgrade.title')}</Text>
                </View>
              </View>
              {stage === 'success' ? (
                <View style={styles.content}>
                  <View style={styles.successIcon}>
                    <MaterialIcons name="check-circle" size={48} color={colors.greenBackground} />
                  </View>
                  <ThemedText style={styles.successTitle}>{t('upgrade.successTitle')}</ThemedText>
                  <ThemedText style={styles.successText}>{t('upgrade.successOtherDevices')}</ThemedText>
                  <RobustPressable style={styles.button} onPress={finish}>
                    <ThemedText style={styles.buttonText}>{t('common.continue')}</ThemedText>
                  </RobustPressable>
                </View>
              ) : (
                <View style={styles.content}>
                  <View style={styles.avatarContainer}>
                    <Avatar />
                    <ThemedText style={styles.username}>{username}</ThemedText>
                  </View>
                  <ThemedText style={styles.subtitle}>{t('upgrade.subtitle')}</ThemedText>

                  {error && (
                    <View>
                      <ThemedText style={styles.errorText}>{error}</ThemedText>
                      {errorDetail && <ThemedText style={styles.errorDetail}>{errorDetail}</ThemedText>}
                    </View>
                  )}

                  {kind === UpgradeKind.LegacySqliteBlob && (
                    <View style={styles.versionContainer}>
                      <View style={styles.versionHeader}>
                        <ThemedText style={styles.versionTitle}>{t('upgrade.versionInformation')}</ThemedText>
                        <RobustPressable
                          style={styles.helpButton}
                          onPress={showVersionDialog}
                        >
                          <ThemedText style={styles.helpButtonText}>?</ThemedText>
                        </RobustPressable>
                      </View>
                      <View style={styles.versionRow}>
                        <ThemedText style={styles.versionLabel}>{t('upgrade.yourVault')}</ThemedText>
                        <ThemedText style={[styles.versionValue, styles.currentVersionValue]}>
                          {currentVersion?.compatibleUpToVersion ?? '...'}
                        </ThemedText>
                      </View>
                      <View style={styles.versionRow}>
                        <ThemedText style={styles.versionLabel}>{t('upgrade.newVersion')}</ThemedText>
                        <ThemedText style={[styles.versionValue, styles.latestVersionValue]}>
                          {latestVersion?.releaseVersion ?? '...'}
                        </ThemedText>
                      </View>
                    </View>
                  )}

                  {kind === UpgradeKind.StorageFormat && (
                    <View style={styles.warningContainer}>
                      <ThemedText style={styles.warningText}>{t('upgrade.otherDevicesWarning', { version: AppInfo.API_VERSION })}</ThemedText>
                    </View>
                  )}

                  <RobustPressable
                    style={styles.button}
                    onPress={handleUpgrade}
                  >
                    <ThemedText style={styles.buttonText}>{t('upgrade.upgrade')}</ThemedText>
                  </RobustPressable>

                  <RobustPressable
                    style={styles.logoutButton}
                    onPress={handleLogout}
                  >
                    <ThemedText style={styles.logoutButtonText}>{t('upgrade.logout')}</ThemedText>
                  </RobustPressable>
                </View>
              )}
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}
