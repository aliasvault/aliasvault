import React from 'react';
import { useTranslation } from 'react-i18next';

/** Minimum password length that reaches the "Good" strength level. */
export const MIN_GOOD_PASSWORD_LENGTH = 12;

/**
 * Calculate the strength of a password.
 * @param password - the password to rate
 */
export const getPasswordStrength = (password: string): number => {
  const length = password.length;
  if (length < 8) {
    return 0;
  }
  if (length < MIN_GOOD_PASSWORD_LENGTH) {
    return 1;
  }
  if (length < 16) {
    return 2;
  }
  if (length < 20) {
    return 3;
  }
  return 4;
};

const LABEL_KEYS = ['veryWeak', 'weak', 'fair', 'good', 'strong'];
const BAR_COLORS = ['bg-orange-400 dark:bg-orange-500', 'bg-yellow-500 dark:bg-yellow-600', 'bg-green-500 dark:bg-green-600', 'bg-green-600 dark:bg-green-700', 'bg-green-700 dark:bg-green-800'];
const TEXT_COLORS = ['text-orange-600 dark:text-orange-400', 'text-yellow-600 dark:text-yellow-400', 'text-green-600 dark:text-green-400', 'text-green-700 dark:text-green-300', 'text-green-800 dark:text-green-200'];

type PasswordStrengthIndicatorProps = {
  /** The password to rate, the indicator hides itself while this is empty. */
  password: string;
};

/**
 * Strength bar shown underneath a new password input, mirroring the web client's indicator.
 */
const PasswordStrengthIndicator: React.FC<PasswordStrengthIndicatorProps> = ({ password }) => {
  const { t } = useTranslation();

  if (!password) {
    return null;
  }

  const strength = getPasswordStrength(password);

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{t('common.passwordStrength.title')}</span>
        <span className={`text-xs font-semibold ${TEXT_COLORS[strength]}`}>{t(`common.passwordStrength.${LABEL_KEYS[strength]}`)}</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden shadow-inner">
        <div className={`h-2.5 rounded-full transition-all duration-500 ease-out ${BAR_COLORS[strength]}`} style={{ width: `${(strength + 1) * 20}%` }} />
      </div>
    </div>
  );
};

export default PasswordStrengthIndicator;
