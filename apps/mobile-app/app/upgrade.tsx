import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Alert, KeyboardAvoidingView, Platform, ScrollView, Dimensions, TouchableWithoutFeedback, Keyboard, Text } from 'react-native';

import type { VaultVersion } from '@/utils/dist/shared/vault-sql';
import { VaultSqlGenerator } from '@/utils/dist/shared/vault-sql';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { useVaultSync } from '@/hooks/useVaultSync';

import Logo from '@/assets/images/logo.svg';
import LoadingIndicator from '@/components/LoadingIndicator';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { Avatar } from '@/components/ui/Avatar';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Upgrade screen.
 */
export default function UpgradeScreen() : React.ReactNode {
  const { username } = useAuth();
  const { sqliteClient } = useDb();
  const [isLoading, setIsLoading] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<VaultVersion | null>(null);
  const [latestVersion, setLatestVersion] = useState<VaultVersion | null>(null);
  const [upgradeStatus, setUpgradeStatus] = useState('');
  const colors = useColors();
  const { t } = useTranslation();
  const webApi = useWebApi();
  const { executeVaultMutation, isLoading: isVaultMutationLoading, syncStatus } = useVaultMutate();
  const { syncVault } = useVaultSync();

  // Initialize upgrade status with translation
  useEffect(() => {
    setUpgradeStatus(t('upgrade.status.preparingUpgrade'));
  }, [t]);

  /**
   * Load version information from the database.
   */
  const loadVersionInfo = useCallback(async () => {
    try {
      if (sqliteClient) {
        const current = await sqliteClient.getDatabaseVersion();
        const latest = await sqliteClient.getLatestDatabaseVersion();
        setCurrentVersion(current);
        setLatestVersion(latest);
      }
    } catch (error) {
      console.error('Failed to load version information:', error);
    }
  }, [sqliteClient]);

  useEffect(() => {
    loadVersionInfo();
  }, [loadVersionInfo]);

  /**
   * Handle the vault upgrade.
   */
  const handleUpgrade = async (): Promise<void> => {
    if (!sqliteClient || !currentVersion || !latestVersion) {
      Alert.alert(t('common.error'), t('upgrade.alerts.unableToGetVersionInfo'));
      return;
    }

    // Check if this is a self-hosted instance and show warning if needed
    if (await webApi.isSelfHosted()) {
      Alert.alert(
        t('upgrade.alerts.selfHostedServer'),
        t('upgrade.alerts.selfHostedWarning'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('upgrade.alerts.continueUpgrade'),
            style: 'default',
            /**
             * Continue upgrade.
             */
            onPress: async () : Promise<void> => {
              await performUpgrade();
            }
          }
        ]
      );
    } else {
      await performUpgrade();
    }
  };

  /**
   * Perform the actual vault upgrade.
   */
  const performUpgrade = async (): Promise<void> => {
    if (!sqliteClient || !currentVersion || !latestVersion) {
      Alert.alert(t('common.error'), t('upgrade.alerts.unableToGetVersionInfo'));
      return;
    }

    setIsLoading(true);
    setUpgradeStatus(t('upgrade.status.preparingUpgrade'));

    try {
      // Get upgrade SQL commands from vault-sql shared library
      const vaultSqlGenerator = new VaultSqlGenerator();
      const upgradeResult = vaultSqlGenerator.getUpgradeVaultSql(currentVersion.revision, latestVersion.revision);

      if (!upgradeResult.success) {
        throw new Error(upgradeResult.error ?? t('upgrade.alerts.upgradeFailed'));
      }

      if (upgradeResult.sqlCommands.length === 0) {
        // No upgrade needed, vault is already up to date
        setUpgradeStatus(t('upgrade.status.vaultAlreadyUpToDate'));
        await new Promise(resolve => setTimeout(resolve, 1000));
        await handleUpgradeSuccess();
        return;
      }

      // Use the useVaultMutate hook to handle the upgrade and vault upload
      await executeVaultMutation(async () => {
        // Begin transaction
        setUpgradeStatus(t('upgrade.status.startingDatabaseTransaction'));
        await NativeVaultManager.beginTransaction();

        // Execute each SQL command
        setUpgradeStatus(t('upgrade.status.applyingDatabaseMigrations'));
        for (let i = 0; i < upgradeResult.sqlCommands.length; i++) {
          const sqlCommand = upgradeResult.sqlCommands[i];
          setUpgradeStatus(t('upgrade.status.applyingMigration', { current: i + 1, total: upgradeResult.sqlCommands.length }));

          try {
            await NativeVaultManager.executeRaw(sqlCommand);
          } catch (error) {
            console.error(`Error executing SQL command ${i + 1}:`, sqlCommand, error);
            await NativeVaultManager.rollbackTransaction();
            throw new Error(t('upgrade.alerts.failedToApplyMigration', { current: i + 1, total: upgradeResult.sqlCommands.length }));
          }
        }

        // Commit transaction
        setUpgradeStatus(t('upgrade.status.committingChanges'));
        await NativeVaultManager.commitTransaction();
      }, {
        skipSyncCheck: true, // Skip sync check during upgrade to prevent loop
        /**
         * Handle successful upgrade completion.
         */
        onSuccess: () => {
          void handleUpgradeSuccess();
        },
        /**
         * Handle upgrade error.
         */
        onError: (error: Error) => {
          console.error('Upgrade failed:', error);
          Alert.alert(t('upgrade.alerts.upgradeFailed'), error.message);
        }
      });

    } catch (error) {
      console.error('Upgrade failed:', error);
      Alert.alert(t('upgrade.alerts.upgradeFailed'), error instanceof Error ? error.message : t('upgrade.alerts.unknownErrorDuringUpgrade'));
    } finally {
      setIsLoading(false);
      setUpgradeStatus(t('upgrade.status.preparingUpgrade'));
    }
  };

  /**
   * Handle successful upgrade completion.
   */
  const handleUpgradeSuccess = async () : Promise<void> => {
    try {
      // Sync vault to ensure we have the latest data
      await syncVault({
        /**
         * Handle the status update.
         */
        onStatus: (message) => setUpgradeStatus(message),
        /**
         * Handle successful vault sync and navigate to credentials.
         */
        onSuccess: () => {
          // Navigate to credentials index
          router.replace('/(tabs)/credentials');
        },
        /**
         * Handle sync error and still navigate to credentials.
         */
        onError: (error) => {
          console.error('Sync error after upgrade:', error);
          // Still navigate to credentials even if sync fails
          router.replace('/(tabs)/credentials');
        }
      });
    } catch (error) {
      console.error('Error during post-upgrade sync:', error);
      // Navigate to credentials even if sync fails
      router.replace('/(tabs)/credentials');
    }
  };

  /**
   * Handle the logout.
   */
  const handleLogout = async () : Promise<void> => {
    /*
     * Clear any stored tokens or session data
     * This will be handled by the auth context
     */
    await webApi.logout();
    router.replace('/login');
  };

  /**
   * Show native dialog with version description.
   */
  const showVersionDialog = (): void => {
    Alert.alert(
      t('upgrade.whatsNew'),
      `${t('upgrade.whatsNewDescription')}\n\n${latestVersion?.description ?? t('upgrade.noDescriptionAvailable')}`,
      [
        { text: t('common.ok'), style: 'default' }
      ]
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
  });

  return (
    <ThemedView style={styles.container}>
      {(isLoading || isVaultMutationLoading) ? (
        <View style={styles.loadingContainer}>
          <LoadingIndicator status={syncStatus || upgradeStatus} />
        </View>
      ) : (
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
                <View style={styles.content}>
                  <View style={styles.avatarContainer}>
                    <Avatar />
                    <ThemedText style={styles.username}>{username}</ThemedText>
                  </View>
                  <ThemedText style={styles.subtitle}>{t('upgrade.subtitle')}</ThemedText>
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

                  <RobustPressable
                    style={styles.button}
                    onPress={handleUpgrade}
                    disabled={isLoading || isVaultMutationLoading}
                  >
                    <ThemedText style={styles.buttonText}>
                      {isLoading || isVaultMutationLoading ? (syncStatus || t('upgrade.upgrading')) : t('upgrade.upgrade')}
                    </ThemedText>
                  </RobustPressable>

                  <RobustPressable
                    style={styles.logoutButton}
                    onPress={handleLogout}
                  >
                    <ThemedText style={styles.logoutButtonText}>{t('upgrade.logout')}</ThemedText>
                  </RobustPressable>
                </View>
              </View>
            </ScrollView>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      )}
    </ThemedView>
  );
}