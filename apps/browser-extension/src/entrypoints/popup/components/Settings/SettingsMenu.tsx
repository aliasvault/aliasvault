import React from 'react';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

import type { UiIconName } from '@aliasvault/models/icons';

/**
 * The small uppercase title above a settings section.
 */
export const SettingsSectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="px-1 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{children}</h2>
);

type SettingsTextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  children?: React.ReactNode;
};

/**
 * A titled text input with an optional error and hint below it; children render after the hint.
 */
export const SettingsTextField: React.FC<SettingsTextFieldProps> = ({ id, label, value, onChange, placeholder, error, hint, children }) => (
  <section>
    <label htmlFor={id} className="block px-1 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</label>
    <input
      id={id}
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      aria-invalid={Boolean(error)}
      className={`w-full px-4 py-3 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 rounded-lg shadow-sm border ${error ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent`}
    />
    {error && <p className="px-1 mt-1.5 text-xs text-red-500">{error}</p>}
    {hint && <p className="px-1 mt-1.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    {children}
  </section>
);

type SettingsGroupProps = {
  title?: string;
  children: React.ReactNode;
};

/**
 * A titled card of settings rows.
 */
export const SettingsGroup: React.FC<SettingsGroupProps> = ({ title, children }) => (
  <section>
    {title && <SettingsSectionTitle>{title}</SettingsSectionTitle>}
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

/**
 * The track and knob of an on/off switch, without any behaviour; the track darkens while its enabled button is hovered.
 */
const SwitchTrack: React.FC<{ checked: boolean; disabled?: boolean }> = ({ checked, disabled }) => {
  const hover = disabled ? '' : checked ? 'group-hover:bg-primary-600' : 'group-hover:bg-gray-400 dark:group-hover:bg-gray-500';
  return (
    <span className={`flex shrink-0 w-11 h-6 p-0.5 rounded-full transition-colors ${checked ? 'justify-end bg-primary-500' : 'justify-start bg-gray-300 dark:bg-gray-600'} ${hover}`}>
      <span className="w-5 h-5 rounded-full bg-white shadow" />
    </span>
  );
};

type ToggleSwitchProps = {
  id?: string;
  label: string;
  checked: boolean;
  onChange?: () => void;
  disabled?: boolean;
};

/**
 * On/off switch.
 */
export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ id, label, checked, onChange, disabled }) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={onChange}
    disabled={disabled}
    className="group shrink-0 rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <SwitchTrack checked={checked} disabled={disabled} />
  </button>
);

type SettingsToggleRowProps = {
  id?: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
};

/**
 * A settings row with a label and an on/off switch.
 */
export const SettingsToggleRow: React.FC<SettingsToggleRowProps> = ({ id, label, description, checked, onChange }) => (
  <div className="px-4 py-3 flex items-center justify-between gap-4">
    <div className="min-w-0">
      <p className="text-gray-900 dark:text-white">{label}</p>
      {description && <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{description}</p>}
    </div>
    <ToggleSwitch id={id} label={label} checked={checked} onChange={onChange} />
  </div>
);
