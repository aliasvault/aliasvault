import { AvexExportService } from '@aliasvault/client/transfer/export/AvexExportService';
import { AvuxExportService } from '@aliasvault/client/transfer/export/AvuxExportService';
import { downloadBytes } from '@aliasvault/client/utilities/FileDownload';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import ExportPasswordModal from '@/components/settings/importexport/ExportPasswordModal';
import ImportServices from '@/components/settings/importexport/ImportServices';
import ResetVaultSection from '@/components/settings/importexport/ResetVaultSection';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import PageContent from '@/components/shared/PageContent';
import PasswordConfirmationModal from '@/components/shared/PasswordConfirmationModal';
import { useAuth } from '@/context/AuthContext';
import { useConfirmModal } from '@/context/ConfirmModalContext';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { verifyMasterPassword } from '@/utils/MasterPasswordCheck';

/**
 * The export formats.
 */
enum ExportType {
  Csv = 'Csv',
  Avux = 'Avux',
  Avex = 'Avex',
}

/**
 * The import/export settings page.
 */
const ImportExport: React.FC = () => {
  const { t } = useTranslation();
  
  usePageTitle(t('settings.importExport'));
  const dbContext = useDb();
  const { username } = useAuth();
  const { showConfirmation } = useConfirmModal();
  const { showLoading, hideLoading } = useLoading();
  const notifications = useNotifications();

  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [showExportPasswordModal, setShowExportPasswordModal] = useState(false);
  const [currentExportType, setCurrentExportType] = useState<ExportType>(ExportType.Csv);

  const isDebugBuild = import.meta.env.DEV;

  /**
   * The export file name: the date and the username.
   */
  const getExportFileName = (extension: string): string => {
    const dateStr = new Date().toISOString().substring(0, 10);
    return `aliasvault-export-${username ?? ''}-${dateStr}.${extension}`;
  };

  /**
   * Ask for confirmation, then for the master password.
   */
  const showExportConfirmation = async (exportType: ExportType): Promise<void> => {
    setCurrentExportType(exportType);
    const confirmMessage = exportType === ExportType.Avex ? t('importExport.exportEncryptedWarningMessage') : t('importExport.exportWarningMessage');

    const confirmed = await showConfirmation(t('settings.exportConfirmTitle'), confirmMessage, t('common.confirm'), t('common.cancel'));
    if (!confirmed) {
      return;
    }

    // Every export requires the master password.
    setPasswordError('');
    setShowPasswordConfirmation(true);
  };

  /**
   * The current vault as .avux bytes, the base of both the .avux and the .avex export.
   */
  const generateAvuxBytes = (): Uint8Array => {
    const sqliteClient = dbContext.sqliteClient;
    if (!sqliteClient) {
      throw new Error('Vault is not available');
    }
    const data = sqliteClient.importExport.getExportData();
    return AvuxExportService.exportToAvux(data.items, data.folders, data.tags, data.itemTags, data.fieldDefinitions, username ?? '');
  };

  /**
   * Export the vault to CSV.
   */
  const exportVaultCsv = async (): Promise<void> => {
    try {
      const sqliteClient = dbContext.sqliteClient;
      if (!sqliteClient) {
        throw new Error('Vault is not available');
      }
      downloadBytes(getExportFileName('csv'), sqliteClient.importExport.exportToCsv(), 'text/csv');
      notifications.addSuccessMessage(t('importExport.exportSuccessMessage'), true);
    } catch (error) {
      console.error('[Export] Error downloading file:', error);
      notifications.addErrorMessage(t('common.errorGeneric'), true);
    }
  };

  /**
   * Export the vault to .avux.
   */
  const exportVaultAvux = async (): Promise<void> => {
    showLoading(t('importExport.exportingVaultMessage'));
    try {
      downloadBytes(getExportFileName('avux'), generateAvuxBytes());
      notifications.addSuccessMessage(t('importExport.exportSuccessMessage'), true);
    } catch (error) {
      console.error('[Export] Error exporting vault to .avux format:', error);
      notifications.addErrorMessage(t('common.errorGeneric'), true);
    } finally {
      hideLoading();
    }
  };

  /**
   * Export the vault to .avex, encrypted with the given password.
   */
  const exportVaultAvex = async (exportPassword: string): Promise<void> => {
    showLoading(t('importExport.exportingVaultMessage'));
    try {
      const avexBytes = await AvexExportService.encryptToAvex(generateAvuxBytes(), exportPassword, username ?? '');
      downloadBytes(getExportFileName('avex'), avexBytes);
      notifications.addSuccessMessage(t('importExport.exportSuccessMessage'), true);
    } catch (error) {
      console.error('[Export] Error exporting vault to .avex format:', error);
      notifications.addErrorMessage(t('common.errorGeneric'), true);
    } finally {
      hideLoading();
    }
  };

  /**
   * Debug only: the raw SQLite vault file as-is.
   */
  const exportVaultSqlite = (): void => {
    showLoading('Exporting SQLite vault...');
    try {
      const sqliteClient = dbContext.sqliteClient;
      if (!sqliteClient) {
        throw new Error('Vault is not available');
      }
      downloadBytes(getExportFileName('sqlite'), sqliteClient.exportToBytes());
    } catch (error) {
      console.error('[Export] Error exporting raw SQLite vault:', error);
      notifications.addErrorMessage(t('common.errorGeneric'), true);
    } finally {
      hideLoading();
    }
  };

  /**
   * Run the export the user picked.
   */
  const handleExportConfirmed = async (): Promise<void> => {
    switch (currentExportType) {
      case ExportType.Csv:
        await exportVaultCsv();
        break;
      case ExportType.Avux:
        await exportVaultAvux();
        break;
      case ExportType.Avex:
        break;
    }
  };

  /**
   * Verify the master password, then export (or ask for the export password first for .avex).
   */
  const handlePasswordSubmitted = async (password: string): Promise<void> => {
    setShowPasswordConfirmation(false);
    setPasswordError('');

    showLoading(t('common.verifyingPassword'));
    try {
      const isValid = await verifyMasterPassword(password);
      hideLoading();

      if (!isValid) {
        setPasswordError(t('importExport.passwordIncorrect'));
        setShowPasswordConfirmation(true);
      } else if (currentExportType === ExportType.Avex) {
        setShowExportPasswordModal(true);
      } else {
        await handleExportConfirmed();
      }
    } catch (error) {
      console.error('[Export] Error verifying password:', error);
      hideLoading();
      setPasswordError(t('importExport.passwordVerificationFailed'));
      setShowPasswordConfirmation(true);
    }
  };

  /**
   * The encryption password was entered: create the .avex export.
   */
  const handleExportPasswordSubmitted = async (exportPassword: string): Promise<void> => {
    setShowExportPasswordModal(false);
    await exportVaultAvex(exportPassword);
  };

  return (
    <>
      <SettingsPageHeader icon="importExport" title={t('settings.importExport')} description={t('importExport.pageDescription')} />

      <PageContent>
        <Card className="2xl:col-span-2">
          <h3 className="mb-4 text-xl font-semibold dark:text-white">{t('importExport.importSectionTitle')}</h3>
          <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">{t('importExport.importSectionDescription')}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <ImportServices />
          </div>
        </Card>

        <Card className="2xl:col-span-2">
          <h3 className="mb-4 text-xl font-semibold dark:text-white">{t('settings.exportConfirmTitle')}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('importExport.exportSectionDescription')}</p>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 border-2 border-orange-200 dark:border-orange-800 rounded-lg bg-orange-50 dark:bg-orange-900/20">
              <div className="flex-1 min-w-0 mr-4">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{t('importExport.exportAvexTitle')}</h4>
                  <span className="px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900 rounded">{t('importExport.recommendedLabel')}</span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300">{t('importExport.exportAvexDescription')}</p>
              </div>
              <Button onClick={() => void showExportConfirmation(ExportType.Avex)}>{t('importExport.exportAvexButton')}</Button>
            </div>

            <div className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
              <div className="flex-1 min-w-0 mr-4">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{t('importExport.exportAvuxTitle')}</h4>
                <p className="text-xs text-gray-600 dark:text-gray-300">{t('importExport.exportAvuxDescription')}</p>
              </div>
              <Button onClick={() => void showExportConfirmation(ExportType.Avux)}>{t('importExport.exportAvuxButton')}</Button>
            </div>

            <div className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
              <div className="flex-1 min-w-0 mr-4">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{t('importExport.exportCsvTitle')}</h4>
                <p className="text-xs text-gray-600 dark:text-gray-300">{t('importExport.exportCsvDescription')}</p>
              </div>
              <Button onClick={() => void showExportConfirmation(ExportType.Csv)}>{t('importExport.exportCsvButton')}</Button>
            </div>

            {isDebugBuild && (
              <div className="flex items-center justify-between p-3 border-2 border-dashed border-yellow-400 dark:border-yellow-600 rounded-lg bg-yellow-50 dark:bg-yellow-900/20">
                <div className="flex-1 min-w-0 mr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Export raw SQLite</h4>
                    <span className="px-1.5 py-0.5 text-xs font-medium text-yellow-800 dark:text-yellow-200 bg-yellow-200 dark:bg-yellow-800 rounded">DEBUG</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300">Downloads the unencrypted SQLite vault file as-is. Anyone with the file can read everything.</p>
                </div>
                <Button onClick={exportVaultSqlite}>Download .sqlite</Button>
              </div>
            )}
          </div>
        </Card>

        <ResetVaultSection />
      </PageContent>

      <PasswordConfirmationModal
        isOpen={showPasswordConfirmation}
        title={t('importExport.exportPasswordConfirmTitle')}
        description={t('settings.passwordConfirm.exportDescription')}
        errorMessage={passwordError}
        onPasswordSubmitted={password => void handlePasswordSubmitted(password)}
        onClose={() => {
          setShowPasswordConfirmation(false);
          setPasswordError('');
        }} />

      <ExportPasswordModal
        isOpen={showExportPasswordModal}
        title={t('importExport.exportEncryptedPasswordTitle')}
        description={t('importExport.exportEncryptedPasswordDescription')}
        onPasswordSubmitted={password => void handleExportPasswordSubmitted(password)}
        onClose={() => setShowExportPasswordModal(false)} />
    </>
  );
};

export default ImportExport;
