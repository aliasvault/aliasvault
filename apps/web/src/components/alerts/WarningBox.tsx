import React from 'react';

import Icon from '@/components/shared/Icon';

import type { UiIconName } from '@aliasvault/models/icons';

type WarningBoxProps = {
  children: React.ReactNode;
  /** Bold first line. */
  title?: string;
  /** Icon shown in front of the text. */
  icon?: UiIconName;
  /** Buttons shown next to the text, or under it when the box is narrow. */
  actions?: React.ReactNode;
  id?: string;
  className?: string;
};

/**
 * Amber warning box: a light tint with dark text, and a translucent amber tint in dark mode instead of a brown one.
 */
const WarningBox: React.FC<WarningBoxProps> = ({ children, title, icon, actions, id, className = '' }) => (
  <div id={id} role="alert" className={`flex flex-wrap items-center gap-3 p-4 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/40 dark:text-amber-100 ${className}`.trim()}>
    {icon && <Icon name={icon} className="flex-shrink-0 w-5 h-5 text-amber-600 dark:text-amber-500" />}
    <div className="flex-1 min-w-[16rem] text-sm">
      {title && <p className="font-semibold">{title}</p>}
      {children}
    </div>
    {actions && <div className="flex flex-wrap gap-2 ml-auto">{actions}</div>}
  </div>
);

export default WarningBox;
