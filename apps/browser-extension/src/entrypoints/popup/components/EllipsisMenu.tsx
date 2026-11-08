import React from 'react';

import ContextMenu from '@/entrypoints/popup/components/ContextMenu';
import Icon from '@/entrypoints/popup/components/Icons/Icon';

type EllipsisMenuProps = {
  id: string;
  label: string;
  children: React.ReactNode;
};

/**
 * The ellipsis menu next to a page title, with options for the whole page.
 */
const EllipsisMenu: React.FC<EllipsisMenuProps> = ({ id, label, children }) => (
  <ContextMenu widthClass="w-48" renderTrigger={(triggerProps) => (
    <button id={id} type="button" onClick={triggerProps.onClick} aria-haspopup="menu" aria-expanded={triggerProps.isOpen} title={label} className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-200 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700 transition-colors">
      <Icon name="dots-horizontal" className="w-5 h-5" />
    </button>
  )}>
    {children}
  </ContextMenu>
);

export default EllipsisMenu;
