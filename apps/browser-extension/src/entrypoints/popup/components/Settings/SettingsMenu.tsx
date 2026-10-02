import React from 'react';

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
  icon: React.ReactNode;
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
      <svg className={`w-5 h-5 mr-3 ${danger ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        {icon}
      </svg>
      <span className={`text-left ${danger ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{label}</span>
      {badge && (
        <span className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 uppercase tracking-wide">
          {badge}
        </span>
      )}
    </div>
    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      {external ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      )}
    </svg>
  </button>
);
