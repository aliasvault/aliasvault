import { buildOtpAuthUri, hasCustomTotpParameters, parseOtpAuthUri, resolveTotpEntry, totpAdvancedValues, totpParametersFrom, type TotpAdvancedValues } from '@aliasvault/client/items/OtpAuthUri';
import QRCode from 'qrcode';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';
import InputTextField from '@/components/shared/InputTextField';
import SectionTitle from '@/components/shared/SectionTitle';
import TotpAdvancedFields, { TotpSettingsButton } from '@/components/totp/TotpAdvancedFields';
import { useConfirmModal } from '@/context/ConfirmModalContext';
import { useNotifications } from '@/context/NotificationContext';

import type { TotpCode } from '@aliasvault/models/vault';

type TotpCodesProps = {
  totpCodes: TotpCode[];
  onTotpCodesChange: (totpCodes: TotpCode[]) => void;
  canRemove: boolean;
  onRemove: () => void;
  itemDisplayName: string;
  itemUsername: string;
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
  const [newAdvanced, setNewAdvanced] = useState<TotpAdvancedValues>(totpAdvancedValues());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editAdvanced, setEditAdvanced] = useState<TotpAdvancedValues>(totpAdvancedValues());
  const [showEditAdvanced, setShowEditAdvanced] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

  /**
   * Show an empty add form.
   */
  const showAddForm = (): void => {
    setNewSecret('');
    setNewName('');
    setSecretError('');
    setShowNameField(false);
    setNewAdvanced(totpAdvancedValues());
    setShowAdvanced(false);
    setIsAddFormVisible(true);
  };

  /**
   * Update the secret; a pasted otpauth URI also fills the advanced fields with its parameters.
   */
  const updateNewSecret = (value: string): void => {
    setNewSecret(value);
    setSecretError('');
    const parsed = parseOtpAuthUri(value);
    if (parsed) {
      const parameters = { Algorithm: parsed.algorithm, Digits: parsed.digits, Period: parsed.period };
      setNewAdvanced(totpAdvancedValues(parameters));
      if (hasCustomTotpParameters(parameters)) {
        setShowAdvanced(true);
      }
    }
  };

  /**
   * Add the entered code to the list.
   */
  const addTotpCode = (): void => {
    if (newSecret.trim().length === 0) {
      setSecretError(t('validation.secretKeyRequired'));
      return;
    }
    const entry = resolveTotpEntry(newSecret, newName, newAdvanced);
    if (!entry) {
      notifications.addErrorMessage(t('totp.errors.invalidSecretKey'), true);
      return;
    }
    const code: TotpCode = { Id: crypto.randomUUID(), Name: entry.name, SecretKey: entry.secretKey, Algorithm: entry.algorithm, Digits: entry.digits, Period: entry.period, ItemId: '' };
    onTotpCodesChange([...totpCodes, code]);
    setIsAddFormVisible(false);
  };

  /**
   * Delete a code after confirmation: original codes are soft deleted, new ones dropped.
   */
  const deleteTotpCode = async (code: TotpCode): Promise<void> => {
    const confirmed = await showConfirmation(t('totp.deleteCodeTitle'), t('totp.deleteCodeConfirmation'), t('common.confirm'), t('common.cancel'));
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
    setEditAdvanced(totpAdvancedValues(code));
    setShowEditAdvanced(hasCustomTotpParameters(code));
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
    onTotpCodesChange(totpCodes.map(c => c.Id === editingCode.Id ? { ...c, Name: editName.trim(), SecretKey: editSecret, ...totpParametersFrom(editAdvanced) } : c));
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
    <Icon name="x" className="w-4 h-4" />
  );

  return (
    <>
      <Card variant="section" className="relative">
        <div className="flex justify-between items-start">
          <div>
            <SectionTitle className="">{t('common.twoFactorAuthentication')}</SectionTitle>
          </div>
          <div className="flex items-center gap-2">
            {visibleCodes.length > 0 && !isAddFormVisible && (
              <button id="add-totp-code" onClick={showAddForm} type="button" className="text-primary-700 hover:text-white border border-primary-700 hover:bg-primary-800 focus:ring-2 focus:outline-none focus:ring-primary-300 font-medium rounded-lg text-xs w-8 h-8 flex items-center justify-center dark:border-primary-500 dark:text-primary-500 dark:hover:text-white dark:hover:bg-primary-600 dark:focus:ring-primary-800" title={t('totp.addTotpCodeDescription')}>
                <Icon name="plus" className="w-4 h-4" strokeWidth={2.5} />
              </button>
            )}
            {canRemove && (
              <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors w-6 h-6 flex items-center justify-center" title={t('common.delete')}>
                <Icon name="x" className="w-5 h-5" />
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
                <h4 className="text-lg font-medium text-gray-900 dark:text-white">{t('totp.addTotpCodeModalTitle')}</h4>
                {visibleCodes.length > 0 && (
                  <button onClick={() => setIsAddFormVisible(false)} type="button" className="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm w-8 h-8 ms-auto inline-flex justify-center items-center dark:hover:bg-gray-600 dark:hover:text-white">
                    <Icon name="x" className="w-3 h-3" />
                    <span className="sr-only">{t('totp.closeFormButton')}</span>
                  </button>
                )}
              </div>
              <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{t('totp.totpInstructions')}</p>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="totp-secret" className="text-sm font-medium text-gray-900 dark:text-white">{t('totp.secretKey')}</label>
                  <TotpSettingsButton id="totp-settings" isOpen={showAdvanced} onToggle={() => setShowAdvanced(v => !v)} />
                </div>
                <InputTextField id="totp-secret" type="text" value={newSecret} onValueChange={updateNewSecret} placeholder={t('totp.secretKeyPlaceholder')} />
                <TotpAdvancedFields idPrefix="totp" values={newAdvanced} onChange={setNewAdvanced} isOpen={showAdvanced} onOpen={() => setShowAdvanced(true)} />
                {secretError.length > 0 && <div className="text-red-600 dark:text-red-400 text-sm mt-1">{secretError}</div>}
              </div>
              {showNameField ? (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="totp-name" className="text-sm font-medium text-gray-900 dark:text-white">{t('totp.nameOptional')}</label>
                    <button id="remove-totp-name" type="button" onClick={() => {
                      setNewName('');
                      setShowNameField(false);
                    }} className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-colors" title={t('common.remove')}>
                      {removeIcon}
                    </button>
                  </div>
                  <InputTextField id="totp-name" type="text" value={newName} onValueChange={setNewName} />
                </div>
              ) : (
                <div className="mb-4">
                  <button id="add-totp-name" type="button" onClick={() => setShowNameField(true)} className="text-sm font-medium text-primary-700 hover:text-primary-800 dark:text-primary-500 dark:hover:text-primary-400">
                    {t('totp.addName')}
                  </button>
                </div>
              )}
              <div className="flex justify-end">
                <Button id="save-totp-code" onClick={addTotpCode}>{t('common.save')}</Button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 mt-4">
          {visibleCodes.map(code => (
            <div key={code.Id} className="p-2 ps-3 pe-3 bg-gray-50 border border-gray-200 rounded-lg dark:bg-gray-700 dark:border-gray-600">
              <div className="flex justify-between items-center gap-2">
                <div className="flex items-center flex-1">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">{code.Name.length > 0 ? code.Name : t('totp.defaultName')}</h4>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-end">
                    <div className="text-sm text-gray-500 dark:text-gray-400">{t('totp.saveToViewCode')}</div>
                  </div>
                  <button type="button" onClick={() => showEditModal(code)} className="edit-totp-code text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title={t('common.edit')}>
                    <Icon name="pencil-alt" className="w-5 h-5" />
                  </button>
                  <button type="button" onClick={() => void deleteTotpCode(code)} className="delete-totp-code text-red-600 hover:text-red-800 dark:text-red-500 dark:hover:text-red-400">
                    <Icon name="trash" className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <FormModal isOpen={editingCode !== null} title={t('common.edit')} showDefaultFooter={false} maxWidth="lg" onClose={() => setEditingCode(null)} submitOnEnter={false}>
        <div className="space-y-4">
          {editingCode && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-900 dark:text-white">{t('totp.secretKey')}</label>
                  <div className="flex items-center">
                    <TotpSettingsButton id="totp-edit-settings" isOpen={showEditAdvanced} onToggle={() => setShowEditAdvanced(v => !v)} />
                    <button type="button" onClick={() => setShowQrCode(v => !v)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1" title={`${showQrCode ? t('common.hide') : t('common.show')} QR Code`}>
                      <Icon name="qrcode" className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <input type="text" value={editSecret} onChange={e => setEditSecret(e.target.value)} className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono" placeholder={t('totp.secretKey')} />
                <TotpAdvancedFields idPrefix="totp-edit" values={editAdvanced} onChange={setEditAdvanced} isOpen={showEditAdvanced} onOpen={() => setShowEditAdvanced(true)} />
                {showQrCode && qrCodeDataUrl && (
                  <div className="flex justify-center mt-3">
                    <img src={qrCodeDataUrl} alt={t('common.qrCode')} className="w-64 h-64" />
                  </div>
                )}
              </div>

              {showEditNameField ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-900 dark:text-white">{t('totp.nameOptional')}</label>
                    <button type="button" onClick={() => {
                      setEditName('');
                      setShowEditNameField(false);
                    }} className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 dark:text-gray-500 dark:hover:text-red-400 transition-colors" title={t('common.remove')}>
                      {removeIcon}
                    </button>
                  </div>
                  <InputTextField id="totp-edit-name" type="text" value={editName} onValueChange={setEditName} placeholder={t('totp.nameOptional')} />
                </div>
              ) : (
                <button type="button" onClick={() => setShowEditNameField(true)} className="text-sm font-medium text-primary-700 hover:text-primary-800 dark:text-primary-500 dark:hover:text-primary-400">
                  {t('totp.addName')}
                </button>
              )}

              <Button onClick={saveEditedTotpCode} additionalClasses="w-full">{t('common.save')}</Button>
            </div>
          )}
        </div>
      </FormModal>
    </>
  );
};

export default TotpCodes;
