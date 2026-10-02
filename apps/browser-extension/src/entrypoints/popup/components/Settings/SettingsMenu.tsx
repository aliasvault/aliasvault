import React from 'react';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

import type { UiIconName } from '@aliasvault/models/icons';

type SettingsGroupProps = {
  title?: string;
  children: React.ReactNode;
};

/**
 * A titled card of settings rows.
 */
export const SettingsGroup: React.FC<SettingsGroupProps> = ({ title, children }) => (
  <section>
    {title && (
      <h2 className="px-1 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h2>
    )}
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {children}
      </div>
    </div>
  </section>
);

type SettingsRowProps = {
  id?: string;
  label: string;
  icon: UiIconName;
  onClick: () => void;
  badge?: string;
  external?: boolean;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
};

/**
 * One navigation row in a settings group.
 */
export const SettingsRow: React.FC<SettingsRowProps> = ({ id, label, icon, onClick, badge, external, danger, disabled, disabledReason }) => (
  <button
    id={id}
    onClick={onClick}
    disabled={disabled}
    title={disabled ? disabledReason : undefined}
    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <div className="flex items-center">
      <Icon name={icon} className={`w-5 h-5 mr-3 ${danger ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`} />
      <span className={`text-left ${danger ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{label}</span>
      {badge && (
        <span className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 uppercase tracking-wide">
          {badge}
        </span>
      )}
    </div>
    <Icon name={external ? 'external-link' : 'chevron-right'} className="w-4 h-4 text-gray-400" />
  </button>
);
