import { BulkFaviconService } from '@aliasvault/client/items/BulkFaviconService';
import { selectFaviconTarget } from '@aliasvault/client/rust/RustCore';
import { AvexImportService, AvexDecryptionError } from '@aliasvault/client/transfer/import/importers/aliasvault/AvexImportService';
import { ImportException, ImportStage } from '@aliasvault/client/transfer/import/models/ImportException';
import { detectAndRemoveDuplicates } from '@aliasvault/client/transfer/import/writers/ImportDuplicateDetection';
import { VaultImportWriter } from '@aliasvault/client/transfer/import/writers/VaultImportWriter';
import { yieldToPaint } from '@aliasvault/client/utilities/YieldToPaint';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import LoadingIndicator from '@/components/loading/LoadingIndicator';
import Button from '@/components/shared/Button';
import Modal from '@/components/shared/Modal';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { useVaultMutate, VaultPushFailedError } from '@/hooks/useVaultMutate';
import { delay } from '@/utils/Delay';
import { formatBytes } from '@/utils/FormatBytes';

import type { FaviconTarget } from '@aliasvault/client/rust/RustCore';
import type { ImportedCredential } from '@aliasvault/client/transfer/import/models/ImportedCredential';
import type { ImportFailure } from '@aliasvault/client/transfer/import/models/ImportFailure';
import type { ImportFileResult } from '@aliasvault/client/transfer/import/models/ImportFileResult';

type ImportOptionProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  detail?: string;
};

/**
 * One import option checkbox, with an optional detail in parentheses after the label.
 */
const ImportOption: React.FC<ImportOptionProps> = ({ checked, onChange, label, detail }) => (
  <label className="flex items-center">
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="form-checkbox h-4 w-4 text-primary-600 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700" />
    <span className="ml-2 text-gray-700 dark:text-gray-300">{label}</span>
    {detail && <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">({detail})</span>}
  </label>
);

/**
 * The steps of the import wizard, in order.
 */
enum ImportStep {
  FileUpload = 0,
  PasswordInput = 1,
  Preview = 2,
  Confirm = 3,
}

/** The last step index, for the progress bar. */
const LAST_STEP = ImportStep.Confirm;

/**
 * Browser-memory safety ceiling for the uploaded file, not a server limit: the file is parsed client-side and
 * never uploaded as-is.
 */
const MAX_FILE_SIZE_MB = 1024;

/** How many skipped items the partial-failure callout lists inline; the rest is in "Show details". */
const FAILED_ITEMS_PREVIEW_LIMIT = 10;

/** How many credentials the preview table shows. */
const PREVIEW_ROW_COUNT = 3;

/** Progress state is flushed to the UI every this many saved items. */
const SAVE_PROGRESS_EVERY = 10;

type ImportServiceCardProps = {
  serviceName: string;
  description?: string;
  logoUrl?: string;
  acceptedFileExtensions: string[];
  processFile: (filename: string, fileBytes: Uint8Array) => Promise<ImportFileResult>;
  /** Per-import service custom instructions shown in the file upload step. */
  children?: React.ReactNode;
};

/**
 * One line naming an error: its class name when that says more than "Error", then the message.
 * @param error - the thrown value, which from wasm or a library is not always an Error
 */
const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name && error.name !== 'Error' ? `${error.name}: ${error.message}` : error.message;
  }
  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
};

/**
 * The header lines of a copyable diagnostic block: the service and, when known, the file.
 * @param serviceName - the import service
 * @param filename - the uploaded file name, empty when unknown
 * @param fileSize - the uploaded file size in bytes
 */
const sourceLines = (serviceName: string, filename: string, fileSize: number): string[] => {
  const lines = [`Service: ${serviceName}`];
  if (filename.length > 0) {
    lines.push(`File: ${filename}${fileSize > 0 ? ` (${formatBytes(fileSize)})` : ''}`);
  }
  return lines;
};

/**
 * A copyable, English-only diagnostic block for a fatal import failure, meant to be pasted into a bug report as-is.
 * @param serviceName - the import service
 * @param filename - the uploaded file name
 * @param fileSize - the uploaded file size in bytes
 * @param stage - the stage that failed
 * @param error - the thrown value
 */
const buildErrorPayload = (serviceName: string, filename: string, fileSize: number, stage: ImportStage, error: unknown): string => {
  const lines = [...sourceLines(serviceName, filename, fileSize), `Stage: ${stage.toLowerCase()}`, `Error: ${describeError(error)}`];
  const inner = error instanceof ImportException ? error.innerError : undefined;
  if (inner !== undefined && describeError(inner) !== describeError(error)) {
    lines.push(`Inner: ${describeError(inner)}`);
  }
  return lines.join('\n');
};

/**
 * Import card.
 */
const ImportServiceCard: React.FC<ImportServiceCardProps> = ({ serviceName, description = '', logoUrl = '', acceptedFileExtensions, processFile, children }) => {
  const { t } = useTranslation();
  
  const navigate = useNavigate();
  const dbContext = useDb();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { executeVaultMutationAsync } = useVaultMutate();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<ImportStep>(ImportStep.FileUpload);
  const [importedCredentials, setImportedCredentials] = useState<ImportedCredential[]>([]);

  const [extractFavicons, setExtractFavicons] = useState(true);
  const [importFolders, setImportFolders] = useState(true);
  const [detectedFolderPaths, setDetectedFolderPaths] = useState<string[]>([]);
  const [importAttachments, setImportAttachments] = useState(true);
  const [detectedAttachmentCount, setDetectedAttachmentCount] = useState(0);
  const [detectedAttachmentsTotalSize, setDetectedAttachmentsTotalSize] = useState(0);
  const [duplicateCredentialsCount, setDuplicateCredentialsCount] = useState(0);

  const [isExtractingFavicons, setIsExtractingFavicons] = useState(false);
  const [faviconExtractionProgress, setFaviconExtractionProgress] = useState(0);
  const [totalFaviconsToExtract, setTotalFaviconsToExtract] = useState(0);
  const faviconExtractionAbort = useRef<AbortController | null>(null);
  const extractedFavicons = useRef(new Map<string, Uint8Array>());

  const [isSavingCredentials, setIsSavingCredentials] = useState(false);
  const [credentialSaveProgress, setCredentialSaveProgress] = useState(0);
  const [totalCredentialsToSave, setTotalCredentialsToSave] = useState(0);
  const [isSyncingVault, setIsSyncingVault] = useState(false);

  // Encrypted (.avex) file handling.
  const [decryptionPassword, setDecryptionPassword] = useState('');
  const pendingAvexBytes = useRef<Uint8Array | null>(null);
  const pendingAvexFilename = useRef<string | null>(null);

  // Error reporting.
  const [errorPayload, setErrorPayload] = useState<string | null>(null);
  const [parseFailures, setParseFailures] = useState<ImportFailure[]>([]);
  const [showFailureDetails, setShowFailureDetails] = useState(false);
  const uploadedFilename = useRef<string | null>(null);
  const uploadedFileSize = useRef(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Capture an error as a header message plus a copyable payload. An ImportException's own stage wins over the default.
   */
  const setImportErrorFromException = (error: unknown, filename: string, fileSize: number, defaultStage: ImportStage, fallbackMessage?: string): void => {
    const stage = error instanceof ImportException ? error.stage : defaultStage;
    setImportError(fallbackMessage ?? t('importExport.serviceCard.importErrorGeneric'));
    setErrorPayload(buildErrorPayload(serviceName, filename, fileSize, stage, error));
  };

  /**
   * The full diagnostic text of the skipped items, shown in the details box and copied to the clipboard.
   */
  const buildFailureDetailsText = (): string => {
    if (parseFailures.length === 0) {
      return '';
    }
    const lines = [...sourceLines(serviceName, uploadedFilename.current ?? '', uploadedFileSize.current), `${parseFailures.length} item(s) could not be parsed and were skipped:`];
    for (const failure of parseFailures) {
      lines.push(`- [${failure.Index}] ${failure.ExceptionType}: ${failure.Message}`);
    }
    return lines.join('\n');
  };

  /**
   * Copy text to the clipboard.
   */
  const copyToClipboard = async (text: string): Promise<void> => {
    if (text.length === 0) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('[Import] Failed to copy to clipboard:', error);
    }
  };

  /**
   * Open the wizard at the upload step.
   */
  const openImportModal = (): void => {
    setIsModalOpen(true);
    setCurrentStep(ImportStep.FileUpload);
  };

  /**
   * Close the wizard and forget everything it held.
   */
  const closeModal = useCallback((): void => {
    setIsModalOpen(false);
    setCurrentStep(ImportStep.FileUpload);
    setImportError(null);
    setImportedCredentials([]);
    setDecryptionPassword('');
    pendingAvexBytes.current = null;
    pendingAvexFilename.current = null;
    setErrorPayload(null);
    setParseFailures([]);
    setShowFailureDetails(false);
    uploadedFilename.current = null;
    uploadedFileSize.current = 0;
  }, []);

  /**
   * Drop the credentials the vault already holds and determine what is left for the preview.
   */
  const detectDuplicatesAndPreview = (credentials: ImportedCredential[]): void => {
    const existingItems = dbContext.sqliteClient?.items.getAll() ?? [];
    const preview = detectAndRemoveDuplicates(existingItems, credentials);
    setImportedCredentials(preview.credentials);
    setDuplicateCredentialsCount(preview.duplicateCount);
    setDetectedFolderPaths(preview.folderPaths);
    setDetectedAttachmentCount(preview.attachmentCount);
    setDetectedAttachmentsTotalSize(preview.attachmentsTotalSize);
  };

  /**
   * Read the chosen file and parse it; an .avex file first asks for its password.
   */
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file || file.name.length === 0) {
      setImportError(t('importExport.serviceCard.importErrorInvalidFile'));
      return;
    }

    const extensionIndex = file.name.lastIndexOf('.');
    const fileExtension = extensionIndex >= 0 ? file.name.substring(extensionIndex).toLowerCase() : '';
    if (!acceptedFileExtensions.some(ext => ext.toLowerCase() === fileExtension)) {
      setImportError(t('importExport.serviceCard.importErrorUnsupportedFormat', { formats: acceptedFileExtensions.join(', ') }));
      return;
    }

    uploadedFilename.current = file.name;
    uploadedFileSize.current = file.size;

    try {
      setIsImporting(true);
      setImportError(null);
      setErrorPayload(null);

      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setImportError(t('importExport.serviceCard.importErrorFileTooLarge', { size: MAX_FILE_SIZE_MB }));
        return;
      }

      const fileBytes = new Uint8Array(await file.arrayBuffer());

      if (file.name.toLowerCase().endsWith('.avex')) {
        // Encrypted: the password step takes over.
        pendingAvexBytes.current = fileBytes;
        pendingAvexFilename.current = file.name;
        setDecryptionPassword('');
        setCurrentStep(ImportStep.PasswordInput);
        return;
      }

      const [result] = await Promise.all([processFile(file.name, fileBytes), delay(500)]);
      setParseFailures(result.FailedItems);
      detectDuplicatesAndPreview(result.Credentials);
      setCurrentStep(ImportStep.Preview);
    } catch (error) {
      console.error(`[Import] Error processing ${serviceName} export file:`, error);
      setImportErrorFromException(error, file.name, file.size, ImportStage.Parse);
    } finally {
      setIsImporting(false);
      // Allow the same file to be chosen again after an error.
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  /**
   * Decrypt the pending .avex file with the entered password and continue as if an .avux file was uploaded.
   */
  const handleDecryptFile = async (): Promise<void> => {
    const avexBytes = pendingAvexBytes.current;
    if (!avexBytes) {
      return;
    }

    try {
      setIsImporting(true);
      setImportError(null);
      await yieldToPaint();

      const avuxBytes = await AvexImportService.decryptAvex(avexBytes, decryptionPassword);
      const result = await processFile('decrypted.avux', avuxBytes);
      setParseFailures(result.FailedItems);

      setDecryptionPassword('');
      pendingAvexBytes.current = null;
      pendingAvexFilename.current = null;

      detectDuplicatesAndPreview(result.Credentials);
      setCurrentStep(ImportStep.Preview);
    } catch (error) {
      if (error instanceof AvexDecryptionError) {
        setImportError(t('common.errors.wrongPassword'));
        setErrorPayload(null);
      } else {
        console.error('[Import] Error decrypting .avex file:', error);
        setImportErrorFromException(error, pendingAvexFilename.current ?? 'decrypted.avux', avexBytes.length, ImportStage.Parse, t('importExport.serviceCard.decryptionErrorGeneric'));
      }
    } finally {
      setIsImporting(false);
    }
  };

  /**
   * Go one step forward.
   */
  const handleNextStep = (): void => {
    if (currentStep === ImportStep.Preview) {
      setCurrentStep(ImportStep.Confirm);
    }
  };

  /**
   * Go one step back.
   */
  const handlePreviousStep = (): void => {
    if (currentStep === ImportStep.PasswordInput) {
      setCurrentStep(ImportStep.FileUpload);
      setDecryptionPassword('');
      pendingAvexBytes.current = null;
      pendingAvexFilename.current = null;
    } else if (currentStep === ImportStep.Preview) {
      // Back to the password step when the file was encrypted.
      setCurrentStep(pendingAvexBytes.current ? ImportStep.PasswordInput : ImportStep.FileUpload);
    } else if (currentStep === ImportStep.Confirm) {
      setCurrentStep(ImportStep.Preview);
    }
  };

  /**
   * Fetch favicons for the credentials that do not carry a logo and have a URL, one fetch per unique domain.
   */
  const extractFaviconsForCredentials = async (): Promise<void> => {
    setIsExtractingFavicons(true);
    setFaviconExtractionProgress(0);
    extractedFavicons.current = new Map();
    const abort = new AbortController();
    faviconExtractionAbort.current = abort;

    const targetsBySource = new Map<string, FaviconTarget>();
    for (const credential of importedCredentials.filter(c => !c.FaviconBytes && !c.AliasVaultItem?.Logo)) {
      const target = await selectFaviconTarget(credential.ServiceUrls ?? []);
      if (target && !targetsBySource.has(target.source)) {
        targetsBySource.set(target.source, target);
      }
    }

    setTotalFaviconsToExtract(targetsBySource.size);

    const result = await BulkFaviconService.extractBulk(webApi, [...targetsBySource.values()], async (count) => {
      setFaviconExtractionProgress(count);
    }, abort.signal);
    for (const [source, bytes] of result.favicons) {
      extractedFavicons.current.set(source, bytes);
    }

    setFaviconExtractionProgress(targetsBySource.size);
    await yieldToPaint();
    setIsExtractingFavicons(false);
  };

  /**
   * Cancel a running favicon extraction.
   */
  const cancelFaviconExtraction = (): void => {
    faviconExtractionAbort.current?.abort();
    setIsExtractingFavicons(false);
  };

  /**
   * Write the credentials into the vault, then sync and show the items.
   */
  const importCredentialsToDatabase = async (): Promise<void> => {
    const sqliteClient = dbContext.sqliteClient;
    if (!sqliteClient) {
      throw new ImportException(ImportStage.Save, 'Vault is not available');
    }

    setIsSavingCredentials(true);
    setCredentialSaveProgress(0);
    setTotalCredentialsToSave(importedCredentials.length);

    try {
      await executeVaultMutationAsync(async () => {
        const folderNameToId = importFolders && detectedFolderPaths.length > 0 ? await VaultImportWriter.createOrGetFolders(sqliteClient, detectedFolderPaths) : null;

        await VaultImportWriter.importCredentialsToVault(sqliteClient, importedCredentials, {
          folderNameToId,
          importAttachments,
          extractedFavicons: extractedFavicons.current,
          /**
           * Show the save progress, letting the browser paint every few items.
           */
          onProgress: async (saved: number): Promise<void> => {
            setCredentialSaveProgress(saved);
            if (saved % SAVE_PROGRESS_EVERY === 0) {
              await yieldToPaint();
            }
          },
        });

        await delay(50);
        setIsSavingCredentials(false);
        setIsSyncingVault(true);
      });
    } catch (error) {
      if (!(error instanceof VaultPushFailedError)) {
        throw error;
      }
      // Failed push (e.g. server not reachable), try again.
      return;
    }

    notifications.addSuccessMessage(t('importExport.serviceCard.importSuccessMessage', { count: importedCredentials.length }));
    navigate('/items');
  };

  /**
   * Run the import: favicons first when asked, then the vault write.
   */
  const handleModalConfirm = async (): Promise<void> => {
    if (isImporting) {
      return;
    }

    setIsImporting(true);
    setImportError(null);
    await yieldToPaint();

    try {
      if (extractFavicons) {
        await extractFaviconsForCredentials();
        if (faviconExtractionAbort.current?.signal.aborted) {
          return;
        }
      }

      await importCredentialsToDatabase();
    } catch (error) {
      console.error('[Import] Error during import:', error);
      setImportErrorFromException(error, uploadedFilename.current ?? '', uploadedFileSize.current, ImportStage.Save);
      // Back to the upload step so the error block is visible instead of the Confirm step's spinner.
      setCurrentStep(ImportStep.FileUpload);
    } finally {
      setIsImporting(false);
      setIsExtractingFavicons(false);
      setIsSavingCredentials(false);
      setIsSyncingVault(false);
    }
  };

  /**
   * Enter on the password step decrypts, Escape goes back.
   */
  const handlePasswordKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && decryptionPassword.trim().length > 0) {
      void handleDecryptFile();
    } else if (e.key === 'Escape') {
      handlePreviousStep();
    }
  };

  /**
   * Enter confirms the import on the last step, Escape closes the wizard.
   */
  const handleModalKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && currentStep === ImportStep.Confirm && !isImporting) {
      void handleModalConfirm();
    } else if (e.key === 'Escape' && !isImporting) {
      closeModal();
    }
  };

  const progressPercentage = (currentStep * 100) / LAST_STEP;
  const fileAcceptTypes = [...acceptedFileExtensions, 'application/octet-stream'].join(',');

  /**
   * The red error block with the copyable diagnostic payload, shared by the upload and password steps.
   */
  const renderImportError = (): React.ReactNode => (
    <div className="mb-4 p-4 text-red-700 bg-red-100 rounded-lg dark:bg-red-200 dark:text-red-800" role="alert">
      <p>{importError}</p>
      {errorPayload && (
        <>
          <p className="mt-3 mb-2 text-sm">{t('importExport.serviceCard.importErrorDetailsIntro')}</p>
          <pre className="text-xs whitespace-pre-wrap break-words bg-red-50 dark:bg-red-50 p-2 rounded border border-red-200 dark:border-red-300 select-all">{errorPayload}</pre>
          <div className="mt-2">
            <button type="button" onClick={() => void copyToClipboard(errorPayload)} className="text-xs underline font-medium hover:no-underline">{t('importExport.serviceCard.importErrorCopyDetailsButton')}</button>
          </div>
        </>
      )}
    </div>
  );

  /**
   * The upload step.
   */
  const renderFileUploadStep = (): React.ReactNode => (
    <div className="max-w-lg mx-auto">
      {importError && renderImportError()}
      {isImporting && <LoadingIndicator />}
      <div className={isImporting ? 'hidden' : ''}>
        {children}
        <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
          <strong>{t('importExport.serviceCard.supportedFormats')}:</strong> {acceptedFileExtensions.join(', ')}
        </p>
        <div className="mb-4 bg-amber-50 border border-amber-400 dark:bg-amber-800/30 dark:border-amber-500/50 rounded-lg p-4">
          <p className="mb-4 text-gray-700 dark:text-gray-200">{t('importExport.serviceCard.uploadExportFileText', { service: serviceName })}</p>
          <input ref={fileInputRef} type="file" accept={fileAcceptTypes} onChange={e => void handleFileUpload(e)} className="text-gray-700 dark:text-gray-200 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 dark:file:bg-primary-900/40 dark:file:text-primary-300 dark:hover:file:bg-primary-800/60" />
        </div>
        <div className="flex justify-end mt-6 space-x-2">
          <Button onClick={closeModal} color="secondary">{t('common.cancel')}</Button>
        </div>
      </div>
    </div>
  );

  /**
   * The password step of an encrypted file.
   */
  const renderPasswordInputStep = (): React.ReactNode => (
    <div className="max-w-lg mx-auto">
      {importError && renderImportError()}
      {isImporting ? (
        <div className="text-center">
          <LoadingIndicator />
          <p className="mt-4 text-gray-700 dark:text-gray-300">{t('importExport.serviceCard.decryptingFile')}</p>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <p className="mb-4 text-gray-700 dark:text-gray-300">{t('importExport.serviceCard.encryptedFilePasswordPrompt')}</p>
            <label htmlFor="decryptionPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('importExport.serviceCard.decryptionPasswordLabel')}</label>
            <input id="decryptionPassword" type="password" value={decryptionPassword} onChange={e => setDecryptionPassword(e.target.value)} onKeyDown={handlePasswordKeyDown} autoFocus autoComplete="off" className="bg-gray-50 border border-gray-300 text-gray-900 sm:text-sm rounded-lg focus:outline-none focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-primary-500 dark:focus:border-primary-500" />
          </div>
          <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
            <p className="text-xs text-orange-800 dark:text-orange-200">{t('importExport.serviceCard.decryptionPasswordHint')}</p>
          </div>
          <div className="flex justify-end mt-6 space-x-2">
            <Button onClick={handlePreviousStep} color="secondary" arrow="back">{t('common.back')}</Button>
            <Button onClick={() => void handleDecryptFile()} color="primary" isDisabled={decryptionPassword.trim().length === 0}>{t('importExport.serviceCard.decryptAndContinueButton')}</Button>
          </div>
        </>
      )}
    </div>
  );

  /**
   * The callout listing the items that could not be parsed.
   */
  const renderParseFailures = (): React.ReactNode => (
    <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-400 dark:bg-amber-900/20 dark:border-amber-700" role="alert">
      <div className="flex items-start gap-2 mb-2">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.008v.008H12v-.008Z" />
        </svg>
        <p className="font-medium text-amber-900 dark:text-amber-200">{t('importExport.serviceCard.importPartialFailureWarning', { count: parseFailures.length })}</p>
      </div>
      <ul className="mb-3 ml-7 text-xs list-disc pl-5 space-y-0.5 text-gray-700 dark:text-gray-300">
        {parseFailures.slice(0, FAILED_ITEMS_PREVIEW_LIMIT).map(failure => (
          <li key={failure.Index}>
            <span className="font-medium">{failure.ItemTitle && failure.ItemTitle.trim().length > 0 ? failure.ItemTitle : '(no title)'}</span>
            <span className="opacity-75"> ({failure.ExceptionType})</span>
          </li>
        ))}
      </ul>
      {parseFailures.length > FAILED_ITEMS_PREVIEW_LIMIT && (
        <p className="mb-3 ml-7 text-xs text-gray-700 dark:text-gray-300">{t('importExport.serviceCard.moreCredentials', { count: parseFailures.length - FAILED_ITEMS_PREVIEW_LIMIT })}</p>
      )}
      <button type="button" onClick={() => setShowFailureDetails(!showFailureDetails)} className="ml-7 inline-flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 hover:underline">
        <span className={`${showFailureDetails ? 'rotate-90' : ''} transition-transform`}>▸</span>
        {showFailureDetails ? t('common.hideDetails') : t('common.showDetails')}
      </button>
      {showFailureDetails && (
        <div className="mt-2 ml-7 flex items-start gap-2">
          <textarea readOnly rows={4} value={buildFailureDetailsText()} className="flex-1 text-xs font-mono p-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 leading-snug" />
          <button type="button" onClick={() => void copyToClipboard(buildFailureDetailsText())} title={t('importExport.serviceCard.importErrorCopyDetailsButton')} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
            </svg>
            {t('importExport.serviceCard.importErrorCopyDetailsButton')}
          </button>
        </div>
      )}
    </div>
  );

  /**
   * The preview step.
   */
  const renderPreviewStep = (): React.ReactNode => (
    <>
      <div className="mb-4">
        {duplicateCredentialsCount > 0 && (
          <div className="p-4 mb-4 text-gray-700 bg-gray-100 rounded-lg dark:bg-gray-700/50 dark:text-gray-300" role="alert">
            <p>{t('importExport.serviceCard.duplicateCredentialsWarning', { count: duplicateCredentialsCount })}</p>
          </div>
        )}

        {parseFailures.length > 0 && renderParseFailures()}

        {importedCredentials.length === 0 ? (
          <div className="p-4 mb-4 text-amber-700 bg-amber-100 rounded-lg dark:bg-amber-800/30 dark:text-amber-300" role="alert">
            <p>{t('importExport.serviceCard.noNewCredentials')}</p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-gray-700 dark:text-gray-300">{t('importExport.serviceCard.previewInstructions')}</p>
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('importExport.serviceCard.serviceColumn')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('common.username')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('common.password')}</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {importedCredentials.slice(0, PREVIEW_ROW_COUNT).map((credential, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">{credential.ServiceName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">{credential.Username}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">{'*'.repeat(credential.Password?.length ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {importedCredentials.length > PREVIEW_ROW_COUNT && (
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t('importExport.serviceCard.moreCredentials', { count: importedCredentials.length - PREVIEW_ROW_COUNT })}</p>
            )}
          </>
        )}
      </div>
      {importedCredentials.length > 0 && (
        <div className="mb-4 space-y-2">
          <ImportOption checked={extractFavicons} onChange={setExtractFavicons} label={t('importExport.serviceCard.extractFaviconsLabel')} />
          {detectedFolderPaths.length > 0 && (
            <ImportOption checked={importFolders} onChange={setImportFolders} label={t('importExport.serviceCard.importFoldersLabel')} detail={t('importExport.serviceCard.foldersDetected', { count: detectedFolderPaths.length })} />
          )}
          {detectedAttachmentCount > 0 && (
            <ImportOption checked={importAttachments} onChange={setImportAttachments} label={t('importExport.serviceCard.importAttachmentsLabel')} detail={t('importExport.serviceCard.attachmentsDetected', { count: detectedAttachmentCount, size: formatBytes(detectedAttachmentsTotalSize) })} />
          )}
        </div>
      )}
      <div className="flex justify-end mt-6 space-x-2">
        <Button onClick={handlePreviousStep} color="secondary" arrow="back">{t('common.back')}</Button>
        {importedCredentials.length > 0 && <Button onClick={handleNextStep} color="primary" arrow="forward">{t('common.next')}</Button>}
      </div>
    </>
  );

  /**
   * The confirm step, which doubles as the progress view while importing.
   */
  const renderConfirmStep = (): React.ReactNode => (
    <div className="max-w-lg mx-auto">
      {isImporting ? (
        isExtractingFavicons ? (
          <div className="text-center">
            <LoadingIndicator />
            <p className="mt-4 text-gray-700 dark:text-gray-300">{t('importExport.serviceCard.extractingFavicons', { current: faviconExtractionProgress, total: totalFaviconsToExtract })}</p>
            <div className="mt-4">
              <Button onClick={cancelFaviconExtraction} color="secondary">{t('common.cancel')}</Button>
            </div>
          </div>
        ) : isSavingCredentials ? (
          <div className="text-center">
            <LoadingIndicator />
            <p className="mt-4 text-gray-700 dark:text-gray-300">{t('importExport.serviceCard.savingCredentials', { current: credentialSaveProgress, total: totalCredentialsToSave })}</p>
          </div>
        ) : isSyncingVault ? (
          <div className="text-center">
            <LoadingIndicator />
            <p className="mt-4 text-gray-700 dark:text-gray-300">{t('importExport.serviceCard.syncingVault')}</p>
          </div>
        ) : (
          <LoadingIndicator />
        )
      ) : (
        <>
          <div className="mb-4">
            <p className="mb-4 text-gray-700 dark:text-gray-300">{t('importExport.serviceCard.confirmImportText', { count: importedCredentials.length })}</p>
            {extractFavicons && (
              <div className="p-4 mb-4 text-amber-700 bg-amber-100 rounded-lg dark:bg-amber-800/30 dark:text-amber-300" role="alert">
                <p>{t('importExport.serviceCard.faviconExtractionNote')}</p>
              </div>
            )}
          </div>
          <div className="flex justify-end mt-6 space-x-2">
            <Button onClick={handlePreviousStep} color="secondary" arrow="back">{t('common.back')}</Button>
            <Button onClick={() => void handleModalConfirm()} color="primary">{t('importExport.serviceCard.importButton')}</Button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <div onClick={openImportModal} data-import-service={serviceName} className="flex flex-col p-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors duration-200">
        <div className="flex items-center">
          <div className="w-12 h-12 mr-3 flex-shrink-0 rounded-md flex items-center justify-center">
            {logoUrl.length > 0 ? (
              <img src={logoUrl} alt={`${serviceName} logo`} className="w-full h-full object-contain" />
            ) : (
              <span className="text-gray-500 dark:text-gray-400 text-xs">{t('importExport.serviceCard.noLogoText')}</span>
            )}
          </div>
          <div>
            <h4 className="text-lg font-semibold dark:text-white">{serviceName}</h4>
            {description.length > 0 && <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>}
          </div>
        </div>
      </div>

      {isModalOpen && (
        <Modal id="importServiceModal" position="top" onKeyDown={handleModalKeyDown} onBackdropClick={currentStep === ImportStep.FileUpload && !isImporting ? closeModal : undefined} panelClassName="p-5 md:min-w-[32rem]">
          <div className="p-4 w-full mx-auto">
            <div className="flex justify-between items-center mb-4">
              <div className="flex">
                <img src={logoUrl} alt={`${serviceName} logo`} className="w-8 h-8 float-left mr-4" />
                <h3 className="text-xl font-semibold dark:text-white">{t('importExport.serviceCard.importFromServiceTitle', { service: serviceName })}</h3>
              </div>
              <button type="button" onClick={closeModal} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4 dark:bg-gray-700">
              <div className="bg-primary-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progressPercentage}%` }}></div>
            </div>

            {currentStep === ImportStep.FileUpload && renderFileUploadStep()}
            {currentStep === ImportStep.PasswordInput && renderPasswordInputStep()}
            {currentStep === ImportStep.Preview && renderPreviewStep()}
            {currentStep === ImportStep.Confirm && renderConfirmStep()}
          </div>
        </Modal>
      )}
    </>
  );
};

export default ImportServiceCard;
