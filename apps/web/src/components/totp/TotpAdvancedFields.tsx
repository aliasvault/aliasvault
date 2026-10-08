import { hasCustomTotpParameters, totpParametersFrom } from '@aliasvault/client/items/OtpAuthUri';
import { TOTP_SUPPORTED_ALGORITHMS, TOTP_SUPPORTED_DIGITS } from '@aliasvault/models/vault';
import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';

import type { TotpAdvancedValues } from '@aliasvault/client/items/OtpAuthUri';

type TotpSettingsButtonProps = {
  id: string;
  isOpen: boolean;
  onToggle: () => void;
};

/**
 * Gear icon in the secret key label row that shows or hides the TOTP parameter fields.
 */
export const TotpSettingsButton: React.FC<TotpSettingsButtonProps> = ({ id, isOpen, onToggle }) => {
  const { t } = useTranslation();
  return (
    <button id={id} type="button" onClick={onToggle} className={`p-1 ${isOpen ? 'text-primary-600 dark:text-primary-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`} title={t('settings.advancedOptions')} aria-label={t('settings.advancedOptions')} aria-expanded={isOpen}>
      <Icon name="cog" className="w-5 h-5" />
    </button>
  );
};

type TotpAdvancedFieldsProps = {
  idPrefix: string;
  values: TotpAdvancedValues;
  onChange: (values: TotpAdvancedValues) => void;
  isOpen: boolean;
  onOpen: () => void;
};

const inputClassName = 'bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block w-full p-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white';
const labelClassName = 'block mb-1 text-xs text-gray-500 dark:text-gray-400';

/**
 * The TOTP parameters under the secret key: one compact row when opened, else a summary when they differ from the defaults.
 */
const TotpAdvancedFields: React.FC<TotpAdvancedFieldsProps> = ({ idPrefix, values, onChange, isOpen, onOpen }) => {
  const { t } = useTranslation();

  if (!isOpen) {
    const parameters = totpParametersFrom(values);
    if (!hasCustomTotpParameters(parameters)) {
      return null;
    }
    return (
      <button id={`${idPrefix}-parameters`} type="button" onClick={onOpen} className="mt-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
        {t('totp.parameterSummary', { algorithm: parameters.Algorithm, digits: parameters.Digits, period: parameters.Period })}
      </button>
    );
  }

  return (
    <div className="mt-2 grid grid-cols-3 gap-2 max-w-md">
      <div>
        <label htmlFor={`${idPrefix}-algorithm`} className={labelClassName}>{t('totp.algorithm')}</label>
        <select id={`${idPrefix}-algorithm`} value={values.algorithm} onChange={(e) => onChange({ ...values, algorithm: e.target.value })} className={inputClassName}>
          {TOTP_SUPPORTED_ALGORITHMS.map(algorithm => <option key={algorithm} value={algorithm}>{algorithm}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-digits`} className={labelClassName}>{t('totp.digits')}</label>
        <select id={`${idPrefix}-digits`} value={values.digits} onChange={(e) => onChange({ ...values, digits: Number(e.target.value) })} className={inputClassName}>
          {TOTP_SUPPORTED_DIGITS.map(digits => <option key={digits} value={digits}>{digits}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-period`} className={labelClassName}>{t('totp.period')}</label>
        <input id={`${idPrefix}-period`} type="number" min={1} max={300} value={values.period} onChange={(e) => onChange({ ...values, period: e.target.value })} className={inputClassName} />
      </div>
    </div>
  );
};

export default TotpAdvancedFields;
