import  * as OTPAuth from 'otpauth';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TotpCode } from '@/utils/dist/core/models/vault';

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
  onStateChange
}) => {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * Sanitizes the secret key by extracting it from a TOTP URI if needed
   */
  const sanitizeSecretKey = (secretKeyInput: string, nameInput: string): { secretKey: string, name: string } => {
    let secretKey = secretKeyInput.trim();
    let name = nameInput.trim();

    // Check if it's a TOTP URI
    if (secretKey.toLowerCase().startsWith('otpauth://totp/')) {
      try {
        const uri = OTPAuth.URI.parse(secretKey);
        if (uri instanceof OTPAuth.TOTP) {
          secretKey = uri.secret.base32;
          // If name is empty, use the label from the URI
          if (!name && uri.label) {
            name = uri.label;
          }
        }
      } catch {
        throw new Error(t('totp.errors.invalidSecretKey'));
      }
    }

    // Remove spaces from the secret key
    secretKey = secretKey.replace(/\s/g, '');

    // Validate the secret key format (base32)
    if (!/^[A-Z2-7]+=*$/i.test(secretKey)) {
      throw new Error(t('totp.errors.invalidSecretKey'));
    }

    return { secretKey, name: name || t('totp.defaultName') };
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
   * Handles adding a new TOTP code
   */
  const handleAddTotpCode = (e?: React.MouseEvent | React.KeyboardEvent): void => {
    e?.preventDefault();
    setFormError(null);

    // Validate required fields
    if (!formData.secretKey) {
      setFormError(t('credentials.validation.required'));
      return;
    }

    try {
      // Sanitize the secret key
      const { secretKey, name } = sanitizeSecretKey(formData.secretKey, formData.name);

      // Create new TOTP code
      const newTotpCode: TotpCode = {
        Id: crypto.randomUUID().toUpperCase(),
        Name: name,
        SecretKey: secretKey,
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
  const deleteTotpCode = (totpToDelete: TotpCode): void => {
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
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        )}
      </div>

      {!hasActiveTotpCodes && !isAddFormVisible && (
        <button
          type="button"
          onClick={showAddForm}
          className="w-full py-1.5 px-4 flex items-center justify-center gap-2 text-primary-700 hover:text-white border border-primary-700 hover:bg-primary-800 focus:ring-4 focus:outline-none focus:ring-primary-300 font-medium rounded-lg dark:border-primary-500 dark:text-primary-500 dark:hover:text-white dark:hover:bg-primary-600 dark:focus:ring-primary-800"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>{t('totp.addCode')}</span>
        </button>
      )}

      {isAddFormVisible && (
        <div className="p-4 mb-4 bg-gray-50 border border-gray-200 rounded-lg dark:bg-gray-700 dark:border-gray-600">
          <div className="flex justify-between items-center mb-4">
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
                <svg className="w-3 h-3" fill="none" viewBox="0 0 14 14">
                  <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"/>
                </svg>
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
            <label htmlFor="totp-name" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">
              {t('totp.nameOptional')}
            </label>
            <input
              id="totp-name"
              type="text"
              value={formData.name}
              onChange={(e) => updateFormData({ name: e.target.value })}
              className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-600 dark:border-gray-500 dark:placeholder-gray-400 dark:text-white"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="totp-secret" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">
              {t('totp.secretKey')}
            </label>
            <input
              id="totp-secret"
              type="text"
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

          <div className="flex justify-end">
            <button
              type="button"
              onClick={(e) => handleAddTotpCode(e)}
              className="text-white bg-primary-700 hover:bg-primary-800 focus:ring-4 focus:outline-none focus:ring-primary-300 font-medium rounded-lg text-sm px-5 py-2.5 dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800"
            >
              {t('common.save')}
            </button>
          </div>
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
                    {totpCode.Name}
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
                    onClick={() => deleteTotpCode(totpCode)}
                    className="text-red-600 hover:text-red-800 dark:text-red-500 dark:hover:text-red-400"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TotpEditor;
