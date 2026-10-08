import React from 'react';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

import type { UiIconName } from '@aliasvault/models/icons';

type AlertVariant = 'info' | 'warning' | 'error' | 'success';

interface IAlertProps {
  variant: AlertVariant;
  children: React.ReactNode;
  /** Show the variant's icon in front of the text. */
  icon?: boolean;
  className?: string;
}

/** Surface classes per variant; warnings use a translucent amber tint in dark mode instead of a brown one. */
const VARIANT_STYLES: Record<AlertVariant, string> = {
  info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200',
  warning: 'bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-100',
  error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200',
  success: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
};

/** Icon and its color per variant. */
const VARIANT_ICONS: Record<AlertVariant, { name: UiIconName; className: string }> = {
  info: { name: 'information-circle', className: 'text-blue-600 dark:text-blue-400' },
  warning: { name: 'exclamation', className: 'text-amber-600 dark:text-amber-500' },
  error: { name: 'x-circle', className: 'text-red-600 dark:text-red-400' },
  success: { name: 'check-circle', className: 'text-green-600 dark:text-green-400' }
};

/**
 * Reusable alert component with consistent styling
 */
const Alert: React.FC<IAlertProps> = ({ variant, children, icon = false, className = '' }) => (
  <div className={`flex items-start gap-3 p-3 border rounded-lg ${VARIANT_STYLES[variant]} ${className}`}>
    {icon && <Icon name={VARIANT_ICONS[variant].name} className={`flex-shrink-0 w-5 h-5 mt-0.5 ${VARIANT_ICONS[variant].className}`} />}
    <p className="text-sm">
      {children}
    </p>
  </div>
);

export default Alert;
