import React from 'react';

import ContextMenu from '@/components/shared/ContextMenu';
import Icon from '@/components/shared/Icon';

type EllipsisMenuProps = {
  id: string;
  label: string;
  children: React.ReactNode;
};

/**
 * The ellipsis menu in a page header, with options for the whole page.
 */
const EllipsisMenu: React.FC<EllipsisMenuProps> = ({ id, label, children }) => (
  <ContextMenu widthClass="w-56" renderTrigger={(triggerProps) => (
    <button ref={triggerProps.ref} id={id} type="button" onClick={triggerProps.onClick} aria-haspopup="menu" aria-expanded={triggerProps.isOpen} title={label} className="p-2 text-gray-500 rounded-lg hover:text-gray-900 hover:bg-gray-200 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700">
      <Icon name="dots-horizontal" className="w-5 h-5" />
    </button>
  )}>
    {children}
  </ContextMenu>
);

export default EllipsisMenu;
