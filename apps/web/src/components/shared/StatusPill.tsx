import React from 'react';
import { useTranslation } from 'react-i18next';

type StatusPillColor = 'green' | 'amber' | 'red' | 'gray';

type StatusPillProps = {
  enabled: boolean;
  textTrue?: string;
  textFalse?: string;
  /** Color override; by default green when enabled and red when not. */
  color?: StatusPillColor;
  size?: 'sm' | 'md';
  id?: string;
};

/** Tint, ring and text per color, in both themes. */
const COLOR_CLASSES: Record<StatusPillColor, string> = {
  green: 'bg-green-100 text-green-800 ring-green-300 dark:bg-green-500/15 dark:text-green-100 dark:ring-green-500/40',
  amber: 'bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40',
  red: 'bg-red-100 text-red-800 ring-red-300 dark:bg-red-500/15 dark:text-red-100 dark:ring-red-500/40',
  gray: 'bg-gray-100 text-gray-800 ring-gray-300 dark:bg-gray-500/15 dark:text-gray-100 dark:ring-gray-500/40',
};

/**
 * Small colored status label.
 */
const StatusPill: React.FC<StatusPillProps> = ({ enabled, textTrue, textFalse, color, size = 'sm', id }) => {
  const { t } = useTranslation();
  const tone = color ?? (enabled ? 'green' : 'red');
  const sizeClasses = size === 'md' ? 'px-2.5 py-0.5 text-sm font-semibold' : 'px-2 py-0.5 text-xs font-medium';

  return <span id={id} className={`inline-flex items-center rounded-full ring-1 ring-inset ${sizeClasses} ${COLOR_CLASSES[tone]}`}>{enabled ? textTrue ?? t('common.enabled') : textFalse ?? t('common.disabled')}</span>;
};

export default StatusPill;
