import { buildOtpAuthUri, hasCustomTotpParameters, parseOtpAuthUri, resolveTotpEntry, totpAdvancedValues, totpParametersFrom, type TotpAdvancedValues } from '@aliasvault/client/items/OtpAuthUri';
import QRCode from 'qrcode';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import ConfirmDeleteModal from '@/entrypoints/popup/components/Dialogs/ConfirmDeleteModal';
import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import TotpAdvancedFields, { TotpSettingsButton } from '@/entrypoints/popup/components/Items/Details/TotpAdvancedFields';

import { logFailure } from '@/utils/Diagnostics';

import type { TotpCode } from '@aliasvault/models/vault';

export type TotpFormData = {
  name: string;
  secretKey: string;
  /** Algorithm, digits and time step; absent means the defaults. */
  advanced?: TotpAdvancedValues;
}

export type TotpEditorState = {
  isAddFormVisible: boolean;
  formData: TotpFormData;
}

type TotpEditorProps = {
  totpCodes: TotpCode[];
  onTotpCodesChange: (totpCodes: TotpCode[]) => void;
  originalTotpCodeIds: string[];
  isAddFormVisible: boolean;
  formData: TotpFormData;
  onStateChange: (state: TotpEditorState) => void;
  itemDisplayName?: string;
  itemUsername?: string;
}

/**
 * Component for editing TOTP codes for a credential.
 */
const TotpEditor: React.FC<TotpEditorProps> = ({
  totpCodes,
  onTotpCodesChange,
  originalTotpCodeIds,
  isAddFormVisible,
  formData,
  onStateChange,
  itemDisplayName,
  itemUsername
}) => {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const [showNameField, setShowNameField] = useState(!!formData.name);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTotpCode, setEditingTotpCode] = useState<TotpCode | null>(null);
  const [editName, setEditName] = useState('');
  const [showEditNameField, setShowEditNameField] = useState(false);
  const [editSecret, setEditSecret] = useState('');
  const [editAdvanced, setEditAdvanced] = useState<TotpAdvancedValues>(totpAdvancedValues());
  const [showAdvanced, setShowAdvanced] = useState(!!formData.advanced && hasCustomTotpParameters(totpParametersFrom(formData.advanced)));
  const [showEditAdvanced, setShowEditAdvanced] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [totpToDelete, setTotpToDelete] = useState<TotpCode | null>(null);

  /**
   * Shows the add form
   */
  const showAddForm = (): void => {
    onStateChange({
      isAddFormVisible: true,
      formData: { name: '', secretKey: '' }
    });
    setFormError(null);
    setShowNameField(false);
    setShowAdvanced(false);
  };

  /**
   * Hides the add form
   */
  const hideAddForm = (): void => {
    onStateChange({
      isAddFormVisible: false,
      formData: { name: '', secretKey: '' }
    });
    setFormError(null);
    setShowNameField(false);
  };

  /**
   * Updates form data
   */
  const updateFormData = (updates: Partial<TotpFormData>): void => {
    onStateChange({
      isAddFormVisible,
      formData: { ...formData, ...updates }
    });
  };

  /**
   * Updates the secret; a pasted otpauth URI also fills the advanced fields with its parameters.
   */
  const updateSecretKey = (secretKey: string): void => {
    const parsed = parseOtpAuthUri(secretKey);
    if (!parsed) {
      updateFormData({ secretKey });
      return;
    }
    const parameters = { Algorithm: parsed.algorithm, Digits: parsed.digits, Period: parsed.period };
    updateFormData({ secretKey, advanced: totpAdvancedValues(parameters) });
    if (hasCustomTotpParameters(parameters)) {
      setShowAdvanced(true);
    }
  };

  /**
   * Hides the optional name field again and clears any entered value
   */
  const hideNameField = (): void => {
    updateFormData({ name: '' });
    setShowNameField(false);
  };

  /**
   * Handles adding a new TOTP code
   */
  const handleAddTotpCode = (e?: React.MouseEvent | React.KeyboardEvent): void => {
    e?.preventDefault();
    setFormError(null);

    // Validate required fields
    if (!formData.secretKey) {
      setFormError(t('validation.required'));
      return;
    }

    const entry = resolveTotpEntry(formData.secretKey, formData.name, formData.advanced);
    if (!entry) {
      setFormError(t('totp.errors.invalidSecretKey'));
      return;
    }

    const newTotpCode: TotpCode = {
      Id: crypto.randomUUID(),
      Name: entry.name,
      SecretKey: entry.secretKey,
      Algorithm: entry.algorithm,
      Digits: entry.digits,
      Period: entry.period,
      ItemId: '' // Will be set when saving the item
    };

    onTotpCodesChange([...totpCodes, newTotpCode]);
    hideAddForm();
  };

  /**
   * Initiates the delete process for a TOTP code
   */
  const initiateTotpDelete = (totp: TotpCode): void => {
    setTotpToDelete(totp);
    setIsDeleteModalOpen(true);
  };

  /**
   * Confirms deletion of a TOTP code
   */
  const confirmDeleteTotpCode = (): void => {
    if (!totpToDelete) {
      return;
    }

    // Check if this TOTP code was part of the original set
    const wasOriginal = originalTotpCodeIds.includes(totpToDelete.Id);

    let updatedTotpCodes: TotpCode[];
    if (wasOriginal) {
      // Mark as deleted (soft delete for syncing)
      updatedTotpCodes = totpCodes.map(tc =>
        tc.Id === totpToDelete.Id
          ? { ...tc, IsDeleted: true }
          : tc
      );
    } else {
      // Hard delete (remove from array)
      updatedTotpCodes = totpCodes.filter(tc => tc.Id !== totpToDelete.Id);
    }

    onTotpCodesChange(updatedTotpCodes);
    setIsDeleteModalOpen(false);
    setTotpToDelete(null);
  };

  /**
   * Cancels the delete operation
   */
  const cancelDeleteTotpCode = (): void => {
    setIsDeleteModalOpen(false);
    setTotpToDelete(null);
  };

  /**
   * Shows the edit modal for a TOTP code
   */
  const showEditModal = (totpCode: TotpCode): void => {
    setEditingTotpCode(totpCode);
    // Only reveal the name field when a name was actually set.
    setEditName(totpCode.Name);
    setShowEditNameField(!!totpCode.Name);
    setEditSecret(totpCode.SecretKey);
    setEditAdvanced(totpAdvancedValues(totpCode));
    setShowEditAdvanced(hasCustomTotpParameters(totpCode));
    setIsEditModalOpen(true);
    setShowQrCode(false);
  };

  /**
   * Closes the edit modal
   */
  const closeEditModal = (): void => {
    setIsEditModalOpen(false);
    setEditingTotpCode(null);
    setEditName('');
    setShowEditNameField(false);
    setEditSecret('');
    setShowQrCode(false);
    setQrCodeDataUrl(null);
  };

  /**
   * Hides the edit name field again and clears any entered value so the code
   * falls back to the default name on save.
   */
  const hideEditNameField = (): void => {
    setEditName('');
    setShowEditNameField(false);
  };

  /**
   * Saves the edited TOTP code
   */
  const saveEditedTotpCode = (): void => {
    if (!editingTotpCode) {
      return;
    }

    // The name is optional; store it as-is (blank when the user left it empty).
    const finalName = editName.trim();

    const updatedTotpCodes = totpCodes.map(tc =>
      tc.Id === editingTotpCode.Id
        ? { ...tc, Name: finalName, SecretKey: editSecret, ...totpParametersFrom(editAdvanced) }
        : tc
    );

    onTotpCodesChange(updatedTotpCodes);
    closeEditModal();
  };

  /**
   * Toggles QR code visibility and generates it if needed
   */
  const toggleQrCode = (): void => {
    if (!showQrCode && editingTotpCode) {
      /**
       * Generate QR code for the SAVED version (not edited)
       * Format: otpauth://totp/Issuer:AccountName?secret=SECRET&issuer=Issuer
       */
      const issuer = itemDisplayName || 'AliasVault';
      const accountName = itemUsername || editingTotpCode.Name;
      const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
      const totpUri = buildOtpAuthUri(label, editingTotpCode.SecretKey, issuer, editingTotpCode);

      QRCode.toDataURL(totpUri, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      })
        .then(url => setQrCodeDataUrl(url))
        .catch(err => logFailure('Failed to generate QR code', err));
    }
    setShowQrCode(!showQrCode);
  };

  // Filter out deleted TOTP codes for display
  const activeTotpCodes = totpCodes.filter(tc => !tc.IsDeleted);
  const hasActiveTotpCodes = activeTotpCodes.length > 0;

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t('common.twoFactorAuthentication')}
        </h2>
        {hasActiveTotpCodes && !isAddFormVisible && (
          <button
            type="button"
            onClick={showAddForm}
            className="w-8 h-8 flex items-center justify-center text-primary-700 hover:text-white border border-primary-700 hover:bg-primary-800 focus:ring-4 focus:outline-none focus:ring-primary-300 font-medium rounded-lg dark:border-primary-500 dark:text-primary-500 dark:hover:text-white dark:hover:bg-primary-600 dark:focus:ring-primary-800"
            title={t('totp.addCode')}
          >
            <Icon name="plus" className="w-5 h-5" />
          </button>
        )}
      </div>

      {!hasActiveTotpCodes && !isAddFormVisible && (
        <button
          type="button"
          onClick={showAddForm}
          className="w-full py-1.5 px-4 flex items-center justify-center gap-2 text-primary-700 hover:text-white border border-primary-700 hover:bg-primary-800 focus:ring-4 focus:outline-none focus:ring-primary-300 font-medium rounded-lg dark:border-primary-500 dark:text-primary-500 dark:hover:text-white dark:hover:bg-primary-600 dark:focus:ring-primary-800"
        >
          <Icon name="plus" className="w-5 h-5" />
          <span>{t('totp.addCode')}</span>
        </button>
      )}

      {isAddFormVisible && (
        <div className="p-4 mb-4 bg-gray-50 border border-gray-200 rounded-lg dark:bg-gray-700 dark:border-gray-600">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-lg font-medium text-gray-900 dark:text-white">
              {t('totp.addCode')}
            </h4>
            {/* Only show close button if there are existing TOTP codes */}
            {hasActiveTotpCodes && (
              <button
                type="button"
                onClick={hideAddForm}
                className="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm w-8 h-8 inline-flex justify-center items-center dark:hover:bg-gray-600 dark:hover:text-white"
              >
                <Icon name="x" className="w-3 h-3" />
              </button>
            )}
          </div>

          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {t('totp.instructions')}
          </p>

          {formError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg dark:bg-red-900/20 dark:border-red-800">
              <p className="text-sm text-red-800 dark:text-red-200">{formError}</p>
            </div>
          )}

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="totp-secret" className="text-sm font-medium text-gray-900 dark:text-white">
                {t('totp.secretKey')}
              </label>
              <TotpSettingsButton id="totp-settings" isOpen={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)} />
            </div>
            <input
              id="totp-secret"
              type="text"
              autoFocus
              value={formData.secretKey}
              onChange={(e) => updateSecretKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTotpCode(e);
                }
              }}
              className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-600 dark:border-gray-500 dark:placeholder-gray-400 dark:text-white"
            />
            <TotpAdvancedFields
              idPrefix="totp"
              values={formData.advanced ?? totpAdvancedValues()}
              onChange={(advanced) => updateFormData({ advanced })}
              isOpen={showAdvanced}
              onOpen={() => setShowAdvanced(true)}
            />
          </div>

          {/* Name is optional and hidden by default */}
          {showNameField ? (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="totp-name" className="text-sm font-medium text-gray-900 dark:text-white">
                  {t('totp.nameOptional')}
                </label>
                <button
                  id="remove-totp-name"
                  type="button"
                  onClick={hideNameField}
                  className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
                  title={t('common.remove')}
                >
                  <Icon name="x" className="w-4 h-4" />
                </button>
              </div>
              <input
                id="totp-name"
                type="text"
                autoFocus
                value={formData.name}
                onChange={(e) => updateFormData({ name: e.target.value })}
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-600 dark:border-gray-500 dark:placeholder-gray-400 dark:text-white"
              />
            </div>
          ) : (
            <div className="mb-4">
              <button
                id="add-totp-name"
                type="button"
                onClick={() => setShowNameField(true)}
                className="text-sm font-medium text-primary-700 hover:text-primary-800 dark:text-primary-500 dark:hover:text-primary-400"
              >
                {t('totp.addName')}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={(e) => handleAddTotpCode(e)}
            className="w-full text-white bg-primary-700 hover:bg-primary-800 focus:ring-4 focus:outline-none focus:ring-primary-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800"
          >
            {t('common.save')}
          </button>
        </div>
      )}

      {hasActiveTotpCodes && (
        <div className="grid grid-cols-1 gap-4 mt-4">
          {activeTotpCodes.map(totpCode => (
            <div
              key={totpCode.Id}
              className="p-2 ps-3 pe-3 bg-gray-50 border border-gray-200 rounded-lg dark:bg-gray-700 dark:border-gray-600"
            >
              <div className="flex justify-between items-center gap-2">
                <div className="flex items-center flex-1">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                    {totpCode.Name || t('totp.defaultName')}
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-end">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {t('totp.saveToViewCode')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => showEditModal(totpCode)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title={t('common.edit')}
                  >
                    <Icon name="pencil-alt" className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => initiateTotpDelete(totpCode)}
                    className="text-red-600 hover:text-red-800 dark:text-red-500 dark:hover:text-red-400"
                    title={t('common.delete')}
                  >
                    <Icon name="trash" className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit TOTP Modal */}
      <ModalWrapper
        isOpen={isEditModalOpen}
        onClose={closeEditModal}
        title={t('common.edit')}
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          {editingTotpCode && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-900 dark:text-white">
                    {t('totp.secretKey')}
                  </label>
                  <div className="flex items-center">
                    <TotpSettingsButton id="totp-edit-settings" isOpen={showEditAdvanced} onToggle={() => setShowEditAdvanced(!showEditAdvanced)} />
                    <button
                      type="button"
                      onClick={toggleQrCode}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                      title={showQrCode ? t('common.hide') + ' QR Code' : t('common.show') + ' QR Code'}
                    >
                      <Icon name="qrcode" className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={editSecret}
                  onChange={(e) => setEditSecret(e.target.value)}
                  className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono"
                  placeholder={t('totp.secretKey')}
                />
                <TotpAdvancedFields
                  idPrefix="totp-edit"
                  values={editAdvanced}
                  onChange={setEditAdvanced}
                  isOpen={showEditAdvanced}
                  onOpen={() => setShowEditAdvanced(true)}
                />
                {showQrCode && qrCodeDataUrl && (
                  <div className="flex justify-center mt-3">
                    <div className="bg-white border-2 border-white rounded-lg">
                      <img src={qrCodeDataUrl} alt={t('common.qrCode')} className="w-64 h-64" />
                    </div>
                  </div>
                )}
              </div>

              {/* Name is optional; hidden by default unless a custom name was set. */}
              {showEditNameField ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-900 dark:text-white">
                      {t('totp.nameOptional')}
                    </label>
                    <button
                      type="button"
                      onClick={hideEditNameField}
                      className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
                      title={t('common.remove')}
                    >
                      <Icon name="x" className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowEditNameField(true)}
                  className="text-sm font-medium text-primary-700 hover:text-primary-800 dark:text-primary-500 dark:hover:text-primary-400"
                >
                  {t('totp.addName')}
                </button>
              )}

              <button
                type="button"
                onClick={saveEditedTotpCode}
                className="w-full text-white bg-primary-700 hover:bg-primary-800 focus:ring-4 focus:outline-none focus:ring-primary-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800"
              >
                {t('common.save')}
              </button>
            </div>
          )}
        </div>
      </ModalWrapper>

      {/* Delete Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={isDeleteModalOpen}
        onClose={cancelDeleteTotpCode}
        onConfirm={confirmDeleteTotpCode}
        title={t('totp.deleteTotpCodeTitle')}
        message={t('totp.deleteTotpCodeConfirmation', { name: totpToDelete?.Name || t('totp.defaultName') })}
        confirmText={t('common.delete')}
      />
    </div>
  );
};

export default TotpEditor;
