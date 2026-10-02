import { buildOtpAuthUri, otpAuthDisplayName, parseOtpAuthUri } from '@aliasvault/client/items/OtpAuthUri';
import { TOTP_DEFAULT_ALGORITHM, TOTP_DEFAULT_DIGITS, TOTP_DEFAULT_PERIOD } from '@aliasvault/models/vault';
import QRCode from 'qrcode';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import ConfirmDeleteModal from '@/entrypoints/popup/components/Dialogs/ConfirmDeleteModal';
import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import Icon from '@/entrypoints/popup/components/Icons/Icon';

import { logFailure } from '@/utils/Diagnostics';

import type { TotpCode } from '@aliasvault/models/vault';

type TotpFormData = {
  name: string;
  secretKey: string;
}

type TotpEditorState = {
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
  const [showQrCode, setShowQrCode] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [totpToDelete, setTotpToDelete] = useState<TotpCode | null>(null);

  /**
   * Sanitizes the secret key by extracting it from a TOTP URI if needed
   */
  const sanitizeSecretKey = (secretKeyInput: string, nameInput: string): { secretKey: string, name: string, algorithm: string, digits: number, period: number } => {
    let secretKey = secretKeyInput.trim();
    let name = nameInput.trim();
    let algorithm = TOTP_DEFAULT_ALGORITHM;
    let digits = TOTP_DEFAULT_DIGITS;
    let period = TOTP_DEFAULT_PERIOD;

    // Check if it's a TOTP URI
    if (secretKey.toLowerCase().startsWith('otpauth://totp/')) {
      const parsed = parseOtpAuthUri(secretKey);
      if (!parsed) {
        throw new Error(t('totp.errors.invalidSecretKey'));
      }
      secretKey = parsed.secret;
      // Keep the URI's parameters instead of silently regenerating codes with the defaults.
      algorithm = parsed.algorithm;
      digits = parsed.digits;
      period = parsed.period;
      // If name is empty, use the issuer and account from the URI
      if (!name) {
        name = otpAuthDisplayName(parsed);
      }
    }

    // Remove spaces from the secret key
    secretKey = secretKey.replace(/\s/g, '');

    // Validate the secret key format (base32)
    if (!/^[A-Z2-7]+=*$/i.test(secretKey)) {
      throw new Error(t('totp.errors.invalidSecretKey'));
    }

    // Name is optional; keep it blank when none was provided or derived.
    return { secretKey, name, algorithm, digits, period };
  };

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

    try {
      // Sanitize the secret key
      const { secretKey, name, algorithm, digits, period } = sanitizeSecretKey(formData.secretKey, formData.name);

      // Create new TOTP code
      const newTotpCode: TotpCode = {
        Id: crypto.randomUUID(),
        Name: name,
        SecretKey: secretKey,
        Algorithm: algorithm,
        Digits: digits,
        Period: period,
        ItemId: '' // Will be set when saving the item
      };

      // Add to the list
      const updatedTotpCodes = [...totpCodes, newTotpCode];
      onTotpCodesChange(updatedTotpCodes);

      // Hide the form
      hideAddForm();
    } catch (error) {
      if (error instanceof Error) {
        setFormError(error.message);
      } else {
        setFormError(t('common.errors.unknownErrorTryAgain'));
      }
    }
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
        ? { ...tc, Name: finalName, SecretKey: editSecret }
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
            <label htmlFor="totp-secret" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">
              {t('totp.secretKey')}
            </label>
            <input
              id="totp-secret"
              type="text"
              autoFocus
              value={formData.secretKey}
              onChange={(e) => updateFormData({ secretKey: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTotpCode(e);
                }
              }}
              className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-600 dark:border-gray-500 dark:placeholder-gray-400 dark:text-white"
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
                  <button
                    type="button"
                    onClick={toggleQrCode}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                    title={showQrCode ? t('common.hide') + ' QR Code' : t('common.show') + ' QR Code'}
                  >
                    <Icon name="qrcode" className="w-5 h-5" />
                  </button>
                </div>
                <input
                  type="text"
                  value={editSecret}
                  onChange={(e) => setEditSecret(e.target.value)}
                  className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono"
                  placeholder={t('totp.secretKey')}
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
