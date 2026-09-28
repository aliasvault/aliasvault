import { AliasVaultCsvImportService } from '@aliasvault/client/transfer/import/importers/aliasvault/AliasVaultCsvImportService';
import { AvuxImportService } from '@aliasvault/client/transfer/import/importers/aliasvault/AvuxImportService';
import { importBitwardenCsv } from '@aliasvault/client/transfer/import/importers/bitwarden/BitwardenCsvImporter';
import { importBitwardenZip } from '@aliasvault/client/transfer/import/importers/bitwarden/BitwardenZipImporter';
import { importChromeCsv } from '@aliasvault/client/transfer/import/importers/chrome/ChromeCsvImporter';
import { importDashlaneCsv } from '@aliasvault/client/transfer/import/importers/dashlane/DashlaneCsvImporter';
import { importDropboxCsv } from '@aliasvault/client/transfer/import/importers/dropbox/DropboxCsvImporter';
import { importEdgeCsv } from '@aliasvault/client/transfer/import/importers/edge/EdgeCsvImporter';
import { importEnpassCsv } from '@aliasvault/client/transfer/import/importers/enpass/EnpassCsvImporter';
import { importFirefoxCsv } from '@aliasvault/client/transfer/import/importers/firefox/FirefoxCsvImporter';
import { getGenericCsvTemplate, importGenericCsv } from '@aliasvault/client/transfer/import/importers/generic/GenericCsvImporter';
import { importKeePassCsv } from '@aliasvault/client/transfer/import/importers/keepass/KeePassCsvImporter';
import { importKeePassXcCsv } from '@aliasvault/client/transfer/import/importers/keepassxc/KeePassXcCsvImporter';
import { importLastPassCsv } from '@aliasvault/client/transfer/import/importers/lastpass/LastPassCsvImporter';
import { importNordPassCsv } from '@aliasvault/client/transfer/import/importers/nordpass/NordPassCsvImporter';
import { importOnePassword1pux } from '@aliasvault/client/transfer/import/importers/onepassword/OnePassword1puxImporter';
import { importOnePasswordCsv } from '@aliasvault/client/transfer/import/importers/onepassword/OnePasswordCsvImporter';
import { importProtonPassCsv } from '@aliasvault/client/transfer/import/importers/protonpass/ProtonPassCsvImporter';
import { importProtonPassZip } from '@aliasvault/client/transfer/import/importers/protonpass/ProtonPassZipImporter';
import { importRoboformCsv } from '@aliasvault/client/transfer/import/importers/roboform/RoboformCsvImporter';
import { importStrongboxCsv } from '@aliasvault/client/transfer/import/importers/strongbox/StrongboxCsvImporter';
import { decodeFileContent } from '@aliasvault/client/transfer/import/readers/CsvImport';
import { downloadBytes } from '@aliasvault/client/utilities/FileDownload';
import React from 'react';
import { useTranslation } from 'react-i18next';

import ImportServiceCard from '@/components/settings/importexport/ImportServiceCard';
import { useNotifications } from '@/context/NotificationContext';

import type { ImportedCredential } from '@aliasvault/client/transfer/import/models/ImportedCredential';
import type { ImportFileResult } from '@aliasvault/client/transfer/import/models/ImportFileResult';

const tk = 'components.main.settings.importExport.importServices';

/**
 * One paragraph of a service's import instructions.
 */
const Instruction: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-gray-700 dark:text-gray-300 mb-4">{children}</p>
);

/**
 * The lower-cased extension of a file name, including the dot.
 * @param filename - the file name
 */
const extensionOf = (filename: string): string => {
  const index = filename.lastIndexOf('.');
  return index >= 0 ? filename.substring(index).toLowerCase() : '';
};

/** Parses the bytes of one export file format. */
type FileParser = (fileBytes: Uint8Array) => ImportFileResult;

/**
 * A parser for a text (CSV) export.
 * @param importFromCsv - the CSV importer
 */
const csv = (importFromCsv: (fileContent: string) => ImportedCredential[]): FileParser => (fileBytes) => ({ Credentials: importFromCsv(decodeFileContent(fileBytes)), FailedItems: [] });

/**
 * Picks the correct parser based on the file extension.
 * @param parsers - the parser per lower-cased extension, including the dot
 */
const parseByExtension = (parsers: Record<string, FileParser>) => async (filename: string, fileBytes: Uint8Array): Promise<ImportFileResult> => {
  const parse = parsers[extensionOf(filename)];
  if (!parse) {
    throw new Error(`Unsupported file extension: ${extensionOf(filename)}`);
  }
  return parse(fileBytes);
};

/**
 * Import from an AliasVault backup (.avex, .avux or CSV).
 */
const ImportServiceAliasVault: React.FC = () => {
  const { t } = useTranslation();

  /**
   * Parse by file extension. An .avex file reaches this callback already decrypted, as .avux bytes.
   */
  const processFile = parseByExtension({
    /**
     * Parse an unencrypted AliasVault backup.
     */
    '.avux': (fileBytes) => ({ Credentials: AvuxImportService.importFromAvux(fileBytes), FailedItems: [] }),
    '.csv': csv(AliasVaultCsvImportService.importItemsFromCsv),
  });

  return (
    <ImportServiceCard serviceName="AliasVault" description={t(`${tk}.AliasVaultDescription`)} logoUrl="/img/logo.svg" acceptedFileExtensions={['.avex', '.avux', '.csv']} processFile={processFile}>
      <Instruction>{t(`${tk}.AliasVaultInstructionsPart1`)}</Instruction>
    </ImportServiceCard>
  );
};

/**
 * A password manager whose import differs only in data: the card text and the parser per file extension.
 */
type FileImportService = {
  serviceName: string;
  logoUrl: string;
  descriptionKey: string;
  instructionKeys: string[];
  parsers: Record<string, FileParser>;
};

const FILE_IMPORT_SERVICES: FileImportService[] = [
  { serviceName: '1Password', logoUrl: '/img/importers/1password.svg', descriptionKey: 'OnePasswordDescription', instructionKeys: ['OnePasswordInstructionsPart1', 'OnePasswordInstructionsPart2'], parsers: { '.1pux': importOnePassword1pux, '.csv': csv(importOnePasswordCsv) } },
  { serviceName: 'Bitwarden', logoUrl: '/img/importers/bitwarden.svg', descriptionKey: 'BitwardenDescription', instructionKeys: ['BitwardenInstructionsPart1', 'BitwardenInstructionsPart2'], parsers: { '.zip': importBitwardenZip, '.csv': csv(importBitwardenCsv) } },
  { serviceName: 'Chrome', logoUrl: '/img/importers/chrome.svg', descriptionKey: 'ChromeDescription', instructionKeys: ['ChromeInstructionsPart1', 'ChromeInstructionsPart2'], parsers: { '.csv': csv(importChromeCsv) } },
  { serviceName: 'Dashlane', logoUrl: '/img/importers/dashlane.svg', descriptionKey: 'DashlaneDescription', instructionKeys: ['DashlaneInstructionsPart1', 'DashlaneInstructionsPart2'], parsers: { '.csv': csv(importDashlaneCsv) } },
  { serviceName: 'Dropbox Passwords', logoUrl: '/img/importers/dropbox.svg', descriptionKey: 'DropboxDescription', instructionKeys: ['DropboxInstructionsPart1', 'UploadFileInstructionCommon'], parsers: { '.csv': csv(importDropboxCsv) } },
  { serviceName: 'Edge', logoUrl: '/img/importers/edge.svg', descriptionKey: 'EdgeDescription', instructionKeys: ['EdgeInstructionsPart1', 'EdgeInstructionsPart2'], parsers: { '.csv': csv(importEdgeCsv) } },
  { serviceName: 'Enpass', logoUrl: '/img/importers/enpass.svg', descriptionKey: 'EnpassDescription', instructionKeys: ['EnpassInstructionsPart1', 'EnpassInstructionsPart2'], parsers: { '.csv': csv(importEnpassCsv) } },
  { serviceName: 'Firefox', logoUrl: '/img/importers/firefox.svg', descriptionKey: 'FirefoxDescription', instructionKeys: ['FirefoxInstructionsPart1', 'FirefoxInstructionsPart2'], parsers: { '.csv': csv(importFirefoxCsv) } },
  { serviceName: 'KeePass', logoUrl: '/img/importers/keepass.svg', descriptionKey: 'KeePassDescription', instructionKeys: ['KeePassInstructionsPart1', 'KeePassInstructionsPart2'], parsers: { '.csv': csv(importKeePassCsv) } },
  { serviceName: 'KeePassXC', logoUrl: '/img/importers/keepassxc.svg', descriptionKey: 'KeePassXCDescription', instructionKeys: ['KeePassXCInstructionsPart1', 'KeePassXCInstructionsPart2'], parsers: { '.csv': csv(importKeePassXcCsv) } },
  { serviceName: 'LastPass', logoUrl: '/img/importers/lastpass.svg', descriptionKey: 'LastPassDescription', instructionKeys: ['LastPassInstructionsPart1', 'LastPassInstructionsPart2'], parsers: { '.csv': csv(importLastPassCsv) } },
  { serviceName: 'NordPass', logoUrl: '/img/importers/nordpass.svg', descriptionKey: 'NordPassDescription', instructionKeys: ['NordPassInstructionsPart1', 'NordPassInstructionsPart2'], parsers: { '.csv': csv(importNordPassCsv) } },
  { serviceName: 'Proton Pass', logoUrl: '/img/importers/protonpass.svg', descriptionKey: 'ProtonPassDescription', instructionKeys: ['ProtonPassInstructionsPart1', 'ProtonPassInstructionsPart2'], parsers: { '.zip': importProtonPassZip, '.csv': csv(importProtonPassCsv) } },
  { serviceName: 'RoboForm', logoUrl: '/img/importers/roboform.svg', descriptionKey: 'RoboformDescription', instructionKeys: ['RoboformInstructionsPart1', 'RoboformInstructionsPart2'], parsers: { '.csv': csv(importRoboformCsv) } },
  { serviceName: 'Strongbox', logoUrl: '/img/importers/strongbox.svg', descriptionKey: 'StrongboxDescription', instructionKeys: ['StrongboxInstructionsPart1', 'StrongboxInstructionsPart2'], parsers: { '.csv': csv(importStrongboxCsv) } },
];

/**
 * Import card of a password manager from FILE_IMPORT_SERVICES.
 */
const ImportServiceFromFile: React.FC<{ service: FileImportService }> = ({ service }) => {
  const { t } = useTranslation();
  return (
    <ImportServiceCard serviceName={service.serviceName} description={t(`${tk}.${service.descriptionKey}`)} logoUrl={service.logoUrl} acceptedFileExtensions={Object.keys(service.parsers)} processFile={parseByExtension(service.parsers)}>
      {service.instructionKeys.map(key => <Instruction key={key}>{t(`${tk}.${key}`)}</Instruction>)}
    </ImportServiceCard>
  );
};

/**
 * Import from the generic AliasVault CSV template, with a template download.
 */
const ImportServiceGenericCsv: React.FC = () => {
  const { t } = useTranslation();
  const notifications = useNotifications();

  /**
   * Hand the CSV template to the browser as a download.
   */
  const downloadTemplate = (): void => {
    try {
      downloadBytes('aliasvault-import-template.csv', getGenericCsvTemplate(), 'text/csv');
    } catch (error) {
      console.error('[Import] Error downloading CSV template:', error);
      notifications.addErrorMessage(t(`${tk}.GenericCsvTemplateDownloadError`), true);
    }
  };

  /**
   * One numbered instruction step.
   */
  const step = (number: number, content: React.ReactNode): React.ReactNode => (
    <li className="flex items-start space-x-2">
      <span className="flex-shrink-0 w-5 h-5 bg-amber-400 text-white text-xs rounded-full flex items-center justify-center">{number}</span>
      <span>{content}</span>
    </li>
  );

  return (
    <ImportServiceCard serviceName="Generic CSV" description={t(`${tk}.GenericCsvDescription`)} logoUrl="/img/importers/generic-csv.svg" acceptedFileExtensions={['.csv']} processFile={parseByExtension({ '.csv': csv(importGenericCsv) })}>
      <Instruction>{t(`${tk}.GenericCsvInstructionsPart1`)}</Instruction>
      <ol className="text-sm text-gray-700 dark:text-gray-300 space-y-2 mb-4">
        {step(1, <>{t(`${tk}.GenericCsvStep1`)} <button type="button" onClick={downloadTemplate} className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 underline">template</button></>)}
        {step(2, t(`${tk}.GenericCsvStep2`))}
        {step(3, t(`${tk}.GenericCsvStep3`))}
        {step(4, t(`${tk}.GenericCsvStep4`))}
      </ol>
    </ImportServiceCard>
  );
};

/**
 * All import cards, in display order.
 */
const ImportServices: React.FC = () => (
  <>
    <ImportServiceAliasVault />
    {FILE_IMPORT_SERVICES.map(service => <ImportServiceFromFile key={service.serviceName} service={service} />)}
    <ImportServiceGenericCsv />
  </>
);

export default ImportServices;
