import { getPasswordStrength } from '@aliasvault/client/utilities/PasswordStrength';
import React from 'react';
import { useTranslation } from 'react-i18next';

const LABEL_KEYS = ['StrengthVeryWeak', 'StrengthWeak', 'StrengthFair', 'StrengthGood', 'StrengthStrong'];
const BAR_CLASSES = ['bg-orange-400 dark:bg-orange-500', 'bg-yellow-500 dark:bg-yellow-600', 'bg-green-500 dark:bg-green-600', 'bg-green-600 dark:bg-green-700', 'bg-green-700 dark:bg-green-800'];
const TEXT_CLASSES = ['text-orange-600 dark:text-orange-400', 'text-yellow-600 dark:text-yellow-400', 'text-green-600 dark:text-green-400', 'text-green-700 dark:text-green-300', 'text-green-800 dark:text-green-200'];

/**
 * Bar showing how strong a password is.
 */
const PasswordStrengthIndicator: React.FC<{ password: string }> = ({ password }) => {
  const { t } = useTranslation();
  if (password.length === 0) {
    return null;
  }
  const strength = getPasswordStrength(password);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('components.main.shared.passwordStrengthIndicator.PasswordStrength')}</span>
        <span className={`text-xs font-semibold ${TEXT_CLASSES[strength]}`}>{t(`components.main.shared.passwordStrengthIndicator.${LABEL_KEYS[strength]}`)}</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden shadow-inner">
        <div className={`h-2.5 rounded-full transition-all duration-500 ease-out ${BAR_CLASSES[strength]}`} style={{ width: `${(strength + 1) * 20}%` }}></div>
      </div>
    </div>
  );
};

export default PasswordStrengthIndicator;
