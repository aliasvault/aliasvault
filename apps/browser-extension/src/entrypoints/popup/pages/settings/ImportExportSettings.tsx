import { verifyMasterPassword } from '@aliasvault/client/auth/MasterPasswordCheck';
import { AvexExportService } from '@aliasvault/client/transfer/export/AvexExportService';
import { AvuxExportService } from '@aliasvault/client/transfer/export/AvuxExportService';
import { VAULT_EXPORT_MIME_TYPES, vaultExportFileName, type VaultExportFormat } from '@aliasvault/client/transfer/export/VaultExportFile';
import { downloadBytes } from '@aliasvault/client/utilities/FileDownload';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessage from '@/entrypoints/popup/components/AlertMessage';
import Button from '@/entrypoints/popup/components/Button';
import ConfirmDeleteModal from '@/entrypoints/popup/components/Dialogs/ConfirmDeleteModal';
import ConfirmPasswordModal from '@/entrypoints/popup/components/Dialogs/ConfirmPasswordModal';
import ExportPasswordModal from '@/entrypoints/popup/components/Dialogs/ExportPasswordModal';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { logFailure } from '@/utils/Diagnostics';

/**
 * The export options, in the order they are shown.
 */
const EXPORT_FORMATS: { format: VaultExportFormat; titleKey: string; descriptionKey: string; buttonKey: string; recommended: boolean }[] = [
  { format: 'avex', titleKey: 'importExport.exportAvexTitle', descriptionKey: 'importExport.exportAvexDescription', buttonKey: 'importExport.exportAvexButton', recommended: true },
  { format: 'avux', titleKey: 'importExport.exportAvuxTitle', descriptionKey: 'importExport.exportAvuxDescription', buttonKey: 'importExport.exportAvuxButton', recommended: false },
  { format: 'csv', titleKey: 'importExport.exportCsvTitle', descriptionKey: 'importExport.exportCsvDescription', buttonKey: 'importExport.exportCsvButton', recommended: false },
];

/** The steps of an export: the warning, the master password check, then (for .avex) the export password. */
type ExportStep = 'warning' | 'masterPassword' | 'exportPassword';

/**
 * The import/export settings page: the vault exports, and a pointer to the web app for imports.
 */
const ImportExportSettings: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { setIsInitialLoading, showLoading, hideLoading } = useLoading();
  const [pendingExport, setPendingExport] = useState<{ format: VaultExportFormat; step: ExportStep } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  /**
   * The export bytes of a format, read from the vault.
   */
  const buildExport = async (format: VaultExportFormat, exportPassword: string | null): Promise<Uint8Array> => {
    const sqliteClient = dbContext.sqliteClient;
    if (!sqliteClient) {
      throw new Error('Vault is not available');
    }
    if (format === 'csv') {
      return sqliteClient.importExport.exportToCsv();
    }
    const avuxBytes = AvuxExportService.exportToAvux(sqliteClient.importExport.getExportData());
    return format === 'avux' ? avuxBytes : AvexExportService.encryptToAvex(avuxBytes, exportPassword ?? '');
  };

  /**
   * Build the export and hand it to the browser as a download.
   */
  const runExport = async (format: VaultExportFormat, exportPassword: string | null): Promise<void> => {
    setSuccessMessage(null);
    setErrorMessage(null);
    showLoading(t('importExport.exportingVaultMessage'));
    try {
      downloadBytes(vaultExportFileName(format), await buildExport(format, exportPassword), VAULT_EXPORT_MIME_TYPES[format]);
      setSuccessMessage(t('importExport.exportSuccessMessage'));
    } catch (error) {
      logFailure('Error exporting vault', error);
      setErrorMessage(t('common.errors.unknownErrorTryAgain'));
    } finally {
      hideLoading();
    }
  };

  /**
   * The master password was entered: check it, then export (or ask for the export password first for .avex).
   */
  const handleMasterPasswordConfirmed = async (password: string): Promise<void> => {
    const format = pendingExport?.format;
    if (!format) {
      return;
    }

    let isValid: boolean;
    try {
      isValid = await verifyMasterPassword(password);
    } catch (error) {
      logFailure('Error verifying master password', error);
      throw new Error(t('importExport.passwordVerificationFailed'));
    }
    if (!isValid) {
      throw new Error(t('importExport.passwordIncorrect'));
    }

    if (format === 'avex') {
      setPendingExport({ format, step: 'exportPassword' });
      return;
    }

    setPendingExport(null);
    await runExport(format, null);
  };

  /**
   * The export password was entered: create the .avex export.
   */
  const handleExportPasswordSubmitted = async (exportPassword: string): Promise<void> => {
    setPendingExport(null);
    await runExport('avex', exportPassword);
  };

  const pendingFormat = pendingExport?.format ?? null;

  return (
    <div className="space-y-6">
      <PageTitle>{t('settings.importExport')}</PageTitle>

      {successMessage && <AlertMessage type="success" message={successMessage} />}
      {errorMessage && <AlertMessage type="error" message={errorMessage} />}

      <section>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
          <p className="font-medium text-gray-900 dark:text-white mb-2">{t('settings.importSectionTitle')}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('settings.importWebNote')}</p>
        </div>
      </section>

      <section>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div>
            <p className="font-medium text-gray-900 dark:text-white mb-2">{t('settings.exportSectionTitle')}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('importExport.exportSectionDescription')}</p>
          </div>

          {EXPORT_FORMATS.map(option => (
            <div key={option.format} className={`p-3 rounded-lg border ${option.recommended ? 'border-2 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10' : 'border-gray-200 dark:border-gray-700'}`}>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{t(option.titleKey)}</p>
                {option.recommended && <span className="px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-100 bg-amber-100 dark:bg-amber-500/20 rounded">{t('importExport.recommendedLabel')}</span>}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{t(option.descriptionKey)}</p>
              <Button id={`export-${option.format}-button`} onClick={() => setPendingExport({ format: option.format, step: 'warning' })}>{t(option.buttonKey)}</Button>
            </div>
          ))}
        </div>
      </section>

      <ConfirmDeleteModal
        isOpen={pendingExport?.step === 'warning'}
        onClose={() => setPendingExport(null)}
        onConfirm={() => setPendingExport(pendingFormat ? { format: pendingFormat, step: 'masterPassword' } : null)}
        title={t('settings.exportConfirmTitle')}
        message={pendingFormat === 'avex' ? t('importExport.exportEncryptedWarningMessage') : undefined}
        warning={pendingFormat === 'avex' ? undefined : t('importExport.exportWarningMessage')}
        confirmText={t('common.confirm')}
        variant={pendingFormat === 'avex' ? 'primary' : 'danger'}
      />

      <ConfirmPasswordModal
        isOpen={pendingExport?.step === 'masterPassword'}
        onClose={() => setPendingExport(null)}
        onConfirm={handleMasterPasswordConfirmed}
        title={t('importExport.exportPasswordConfirmTitle')}
        message={t('settings.passwordConfirm.exportDescription')}
        confirmText={t('common.confirm')}
        variant="primary"
      />

      <ExportPasswordModal
        isOpen={pendingExport?.step === 'exportPassword'}
        onClose={() => setPendingExport(null)}
        onSubmit={exportPassword => void handleExportPasswordSubmitted(exportPassword)}
      />
    </div>
  );
};

export default ImportExportSettings;
