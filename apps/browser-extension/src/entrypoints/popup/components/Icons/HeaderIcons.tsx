import React from 'react';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

import type { UiIconName } from '@aliasvault/models/icons';

export enum HeaderIconType {
  EXPAND = 'expand',
  EDIT = 'edit',
  DELETE = 'delete',
  SETTINGS = 'settings',
  RELOAD = 'reload',
  EXTERNAL_LINK = 'external_link',
  SAVE = 'save',
  PLUS = 'plus',
  EYE = 'eye',
  EYE_OFF = 'eye_off'
}

const HEADER_ICONS: Record<HeaderIconType, UiIconName> = {
  [HeaderIconType.EXPAND]: 'arrows-expand',
  [HeaderIconType.EDIT]: 'pencil-alt',
  [HeaderIconType.DELETE]: 'trash',
  [HeaderIconType.SETTINGS]: 'cog',
  [HeaderIconType.RELOAD]: 'refresh',
  [HeaderIconType.EXTERNAL_LINK]: 'external-link',
  [HeaderIconType.SAVE]: 'check',
  [HeaderIconType.PLUS]: 'plus',
  [HeaderIconType.EYE]: 'eye',
  [HeaderIconType.EYE_OFF]: 'eye-off',
};

type HeaderIconProps = {
  type: HeaderIconType;
  className?: string;
};

/**
 * Component to render header icons
 */
export const HeaderIcon: React.FC<HeaderIconProps> = ({ type, className = 'w-5 h-5' }) => (
  <Icon name={HEADER_ICONS[type]} className={className} />
);
