import React from 'react';

import Icon from '@/components/shared/Icon';

import type { UiIconName } from '@aliasvault/models/icons';

/**
 * The icons of the settings pages, shared by the settings overview rows and the page headers.
 */
export type SettingsIconName = 'twoFactor' | 'security' | 'changePassword' | 'vaultUnlock' | 'clipboard' | 'deleteAccount' | 'sessions' | 'passwordGenerator' | 'identityGenerator' | 'importExport' | 'storage' | 'general' | 'apps' | 'themeLight' | 'themeDark' | 'lock' | 'securityWarning' | 'logout' | 'warning' | 'vault' | 'emails' | 'familySharing';

/** The catalog icon of each settings icon. */
const SETTINGS_ICONS: Record<SettingsIconName, UiIconName> = {
  twoFactor: 'device-mobile',
  security: 'shield-check',
  changePassword: 'lock-closed',
  vaultUnlock: 'shield-check',
  clipboard: 'clipboard',
  deleteAccount: 'trash',
  sessions: 'desktop-computer',
  passwordGenerator: 'key',
  identityGenerator: 'user',
  importExport: 'switch-horizontal',
  storage: 'database',
  general: 'cog',
  apps: 'view-grid-add',
  themeLight: 'sun',
  themeDark: 'moon',
  securityWarning: 'shield-exclamation',
  logout: 'logout',
  warning: 'exclamation',
  vault: 'archive',
  emails: 'mail',
  lock: 'lock-closed',
  familySharing: 'user-group',
};

/**
 * A settings page icon.
 */
const SettingsIcon: React.FC<{ name: SettingsIconName; className?: string; strokeWidth?: number }> = ({ name, className = 'w-5 h-5', strokeWidth = 2 }) => (
  <Icon name={SETTINGS_ICONS[name]} className={className} strokeWidth={strokeWidth} />
);

export default SettingsIcon;
