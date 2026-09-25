import { buildOtpAuthUri, parseOtpAuthUri } from '@aliasvault/client/items/OtpAuthUri';
import { TOTP_DEFAULT_ALGORITHM, TOTP_DEFAULT_DIGITS, TOTP_DEFAULT_PERIOD, type TotpCode } from '@aliasvault/models/vault';
import QRCode from 'qrcode';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormModal from '@/components/shared/FormModal';
import { useConfirmModal } from '@/context/ConfirmModalContext';
import { useNotifications } from '@/context/NotificationContext';

type TotpCodesProps = {
  totpCodes: TotpCode[];
  onTotpCodesChange: (totpCodes: TotpCode[]) => void;
  canRemove: boolean;
  onRemove: () => void;
  itemDisplayName: string;
  itemUsername: string;
};

const INPUT_CLASSES = 'bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-600 dark:border-gray-500 dark:placeholder-gray-400 dark:text-white';
const SAVE_BUTTON_CLASSES = 'text-white bg-primary-700 hover:bg-primary-800 focus:ring-4 focus:outline-none focus:ring-primary-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800';

/**
 * The secret, name and parameters of a TOTP entry from a raw secret or an otpauth URI.
 */
const sanitizeSecretKey = (secretInput: string, nameInput: string, invalidMessage: string): { secretKey: string; name: string; algorithm: string; digits: number; period: number } => {
  let secretKey = secretInput.trim();
  let name = nameInput.trim();
  let algorithm = TOTP_DEFAULT_ALGORITHM;
  let digits = TOTP_DEFAULT_DIGITS;
  let period = TOTP_DEFAULT_PERIOD;

  if (secretKey.toLowerCase().startsWith('otpauth://totp/')) {
    const parsed = parseOtpAuthUri(secretKey);
    if (!parsed) {
      throw new Error(invalidMessage);
    }
    secretKey = parsed.secret;
    algorithm = parsed.algorithm;
    digits = parsed.digits;
    period = parsed.period;
    if (name.length === 0 && parsed.account) {
      name = parsed.account;
    }
  }

  secretKey = secretKey.replace(/\s/g, '');
  if (!/^[A-Z2-7]+=*$/i.test(secretKey)) {
    throw new Error(invalidMessage);
  }
  return { secretKey, name, algorithm, digits, period };
};

/**
 * The two-factor codes editor of the item form.
 */
const TotpCodes: React.FC<TotpCodesProps> = ({ totpCodes, onTotpCodesChange, canRemove, onRemove, itemDisplayName, itemUsername }) => {
  const { t } = useTranslation();
  const notifications = useNotifications();
  const { showConfirmation } = useConfirmModal();
  const originalIds = useRef<string[]>(totpCodes.filter(c => !c.IsDeleted).map(c => c.Id));
  const visibleCodes = totpCodes.filter(c => !c.IsDeleted);
  const [isAddFormVisible, setIsAddFormVisible] = useState(visibleCodes.length === 0);
  const [showNameField, setShowNameField] = useState(false);
  const [newSecret, setNewSecret] = useState('');
  const [newName, setNewName] = useState('');
  const [secretError, setSecretError] = useState('');
  const [editingCode, setEditingCode] = useState<TotpCode | null>(null);
  const [editName, setEditName] = useState('');
  const [showEditNameField, setShowEditNameField] = useState(false);
  const [editSecret, setEditSecret] = useState('');
  const [showQrCode, setShowQrCode] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const tk = 'components.main.components.totpCodes.totpCodes';

  /**
   * Show an empty add form.
   */
  const showAddForm = (): void => {
    setNewSecret('');
    setNewName('');
    setSecretError('');
    setShowNameField(false);
    setIsAddFormVisible(true);
  };

  /**
   * Add the entered code to the list.
   */
  const addTotpCode = (): void => {
    if (newSecret.trim().length === 0) {
      setSecretError(t('validationMessages.SecretKeyRequired'));
      return;
    }
    try {
      const sanitized = sanitizeSecretKey(newSecret, newName, t('sharedResources.ErrorSecretKeyRequired'));
      const code: TotpCode = { Id: crypto.randomUUID(), Name: sanitized.name, SecretKey: sanitized.secretKey, Algorithm: sanitized.algorithm, Digits: sanitized.digits, Period: sanitized.period, ItemId: '' };
      onTotpCodesChange([...totpCodes, code]);
      setIsAddFormVisible(false);
    } catch (error) {
      notifications.addErrorMessage(error instanceof Error ? error.message : String(error), true);
    }
  };

  /**
   * Delete a code after confirmation: original codes are soft deleted, new ones dropped.
   */
  const deleteTotpCode = async (code: TotpCode): Promise<void> => {
    const confirmed = await showConfirmation(t(`${tk}.DeleteTotpCodeTitle`), t(`${tk}.DeleteTotpCodeConfirmation`), t('sharedResources.Confirm'), t('sharedResources.Cancel'));
    if (!confirmed) {
      return;
    }
    if (originalIds.current.includes(code.Id)) {
      onTotpCodesChange(totpCodes.map(c => c.Id === code.Id ? { ...c, IsDeleted: true } : c));
    } else {
      onTotpCodesChange(totpCodes.filter(c => c.Id !== code.Id));
    }
  };

  /**
   * Open the edit modal for a code.
   */
  const showEditModal = (code: TotpCode): void => {
    setEditingCode(code);
    setEditName(code.Name);
    setShowEditNameField(code.Name.length > 0);
    setEditSecret(code.SecretKey);
    setShowQrCode(false);
    setQrCodeDataUrl(null);
  };

  /**
   * Apply the edit modal changes.
   */
  const saveEditedTotpCode = (): void => {
    if (!editingCode) {
      return;
    }
    onTotpCodesChange(totpCodes.map(c => c.Id === editingCode.Id ? { ...c, Name: editName.trim(), SecretKey: editSecret } : c));
    setEditingCode(null);
  };

  // Render the QR code of the saved secret when asked for.
  useEffect(() => {
    if (!showQrCode || !editingCode) {
      return;
    }
    const issuer = itemDisplayName.length > 0 ? itemDisplayName : 'AliasVault';
    const accountName = itemUsername.length > 0 ? itemUsername : editingCode.Name;
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
    QRCode.toDataURL(buildOtpAuthUri(label, editingCode.SecretKey, issuer, editingCode), { width: 256, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } })
      .then(url => setQrCodeDataUrl(url))
      .catch(err => console.error('Failed to generate QR code:', err));
  }, [editingCode, itemDisplayName, itemUsername, showQrCode]);

  const removeIcon = (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );

  return (
    <>
      <div className="p-4 mb-4 bg-white border border-gray-200 rounded-lg shadow-sm 2xl:col-span-2 dark:border-gray-700 sm:p-6 dark:bg-gray-800 relative">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-xl font-semibold dark:text-white">{t(`${tk}.TwoFactorAuthenticationTitle`)}</h3>
          </div>
          <div className="flex items-center gap-2">
            {visibleCodes.length > 0 && !isAddFormVisible && (
              <button id="add-totp-code" onClick={showAddForm} type="button" className="text-primary-700 hover:text-white border border-primary-700 hover:bg-primary-800 focus:ring-2 focus:outline-none focus:ring-primary-300 font-medium rounded-lg text-xs w-8 h-8 flex items-center justify-center dark:border-primary-500 dark:text-primary-500 dark:hover:text-white dark:hover:bg-primary-600 dark:focus:ring-primary-800" title={t(`${tk}.AddTotpCodeDescription`)}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            )}
            {canRemove && (
              <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors w-6 h-6 flex items-center justify-center" title={t('sharedResources.Delete')}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {isAddFormVisible && (
          <div className="p-4 mb-4 bg-gray-50 border border-gray-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 mt-4">
            <div onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTotpCode();
              }
            }}>
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-lg font-medium text-gray-900 dark:text-white">{t(`${tk}.AddTotpCodeModalTitle`)}</h4>
                {visibleCodes.length > 0 && (
                  <button onClick={() => setIsAddFormVisible(false)} type="button" className="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm w-8 h-8 ms-auto inline-flex justify-center items-center dark:hover:bg-gray-600 dark:hover:text-white">
                    <svg className="w-3 h-3" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14">
                      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6" />
                    </svg>
                    <span className="sr-only">{t(`${tk}.CloseFormButton`)}</span>
                  </button>
                )}
              </div>
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{t(`${tk}.TotpInstructions`)}</p>
              <div className="mb-4">
                <label htmlFor="totp-secret" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{t(`${tk}.SecretKeyLabel`)}</label>
                <input id="totp-secret" type="text" value={newSecret} onChange={(e) => {
                  setNewSecret(e.target.value);
                  setSecretError('');
                }} className={INPUT_CLASSES} placeholder={t(`${tk}.SecretKeyPlaceholder`)} />
                {secretError.length > 0 && <div className="text-red-600 dark:text-red-400 text-sm mt-1">{secretError}</div>}
              </div>
              {showNameField ? (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="totp-name" className="text-sm font-medium text-gray-900 dark:text-white">{t(`${tk}.NameOptionalLabel`)}</label>
                    <button id="remove-totp-name" type="button" onClick={() => {
                      setNewName('');
                      setShowNameField(false);
                    }} className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-colors" title={t('sharedResources.Remove')}>
                      {removeIcon}
                    </button>
                  </div>
                  <input id="totp-name" type="text" value={newName} onChange={e => setNewName(e.target.value)} className={INPUT_CLASSES} />
                </div>
              ) : (
                <div className="mb-4">
                  <button id="add-totp-name" type="button" onClick={() => setShowNameField(true)} className="text-sm font-medium text-primary-700 hover:text-primary-800 dark:text-primary-500 dark:hover:text-primary-400">
                    {t(`${tk}.AddNameButton`)}
                  </button>
                </div>
              )}
              <div className="flex justify-end">
                <button id="save-totp-code" type="button" onClick={addTotpCode} className={SAVE_BUTTON_CLASSES}>{t(`${tk}.SaveButton`)}</button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 mt-4">
          {visibleCodes.map(code => (
            <div key={code.Id} className="p-2 ps-3 pe-3 bg-gray-50 border border-gray-200 rounded-lg dark:bg-gray-700 dark:border-gray-600">
              <div className="flex justify-between items-center gap-2">
                <div className="flex items-center flex-1">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">{code.Name.length > 0 ? code.Name : t('sharedResources.TotpDefaultName')}</h4>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-end">
                    <div className="text-sm text-gray-500 dark:text-gray-400">{t(`${tk}.SaveToViewCodeMessage`)}</div>
                  </div>
                  <button type="button" onClick={() => showEditModal(code)} className="edit-totp-code text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title={t('sharedResources.Edit')}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                    </svg>
                  </button>
                  <button type="button" onClick={() => void deleteTotpCode(code)} className="delete-totp-code text-red-600 hover:text-red-800 dark:text-red-500 dark:hover:text-red-400">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <FormModal isOpen={editingCode !== null} title={t('sharedResources.Edit')} showDefaultFooter={false} maxWidth="lg" onClose={() => setEditingCode(null)} submitOnEnter={false}>
        <div className="space-y-4">
          {editingCode && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-900 dark:text-white">{t(`${tk}.SecretKeyLabel`)}</label>
                  <button type="button" onClick={() => setShowQrCode(v => !v)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1" title={`${showQrCode ? t('sharedResources.Hide') : t('sharedResources.Show')} QR Code`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </button>
                </div>
                <input type="text" value={editSecret} onChange={e => setEditSecret(e.target.value)} className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono" placeholder={t(`${tk}.SecretKeyLabel`)} />
                {showQrCode && qrCodeDataUrl && (
                  <div className="flex justify-center mt-3">
                    <img src={qrCodeDataUrl} alt="QR code" className="w-64 h-64" />
                  </div>
                )}
              </div>

              {showEditNameField ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-900 dark:text-white">{t(`${tk}.NameOptionalLabel`)}</label>
                    <button type="button" onClick={() => {
                      setEditName('');
                      setShowEditNameField(false);
                    }} className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-colors" title={t('sharedResources.Remove')}>
                      {removeIcon}
                    </button>
                  </div>
                  <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder={t(`${tk}.NameOptionalLabel`)} />
                </div>
              ) : (
                <button type="button" onClick={() => setShowEditNameField(true)} className="text-sm font-medium text-primary-700 hover:text-primary-800 dark:text-primary-500 dark:hover:text-primary-400">
                  {t(`${tk}.AddNameButton`)}
                </button>
              )}

              <button type="button" onClick={saveEditedTotpCode} className={`w-full ${SAVE_BUTTON_CLASSES}`}>{t('sharedResources.Save')}</button>
            </div>
          )}
        </div>
      </FormModal>
    </>
  );
};

export default TotpCodes;
