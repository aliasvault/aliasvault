import React from 'react';
import { NavLink } from 'react-router-dom';

type MenuItemProps = {
  label: React.ReactNode;
  icon?: React.ReactNode;
  to?: string;
  onClick?: () => void;
  danger?: boolean;
  size?: 'sm' | 'md';
  id?: string;
  children?: React.ReactNode;
};

/**
 * One row in a dropdown menu, as a link or a button.
 */
const MenuItem: React.FC<MenuItemProps> = ({ label, icon, to, onClick, danger = false, size = 'sm', id, children }) => {
  const className = `flex items-center gap-3 w-full px-4 ${size === 'md' ? 'py-3' : 'py-2'} text-sm text-left transition-colors hover:bg-gray-100 dark:hover:bg-white/10 ${danger ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`;
  const content = (
    <>
      {icon && <span className={`flex-shrink-0 ${danger ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>{icon}</span>}
      <span className="flex-1 min-w-0">{label}</span>
      {children}
    </>
  );

  return to ? (
    <NavLink to={to} id={id} onClick={onClick} className={className}>{content}</NavLink>
  ) : (
    <button type="button" id={id} onClick={onClick} className={className}>{content}</button>
  );
};

export default MenuItem;
