import React from 'react';
import { NavLink } from 'react-router-dom';

type MenuItemProps = {
  label: React.ReactNode;
  icon?: React.ReactNode;
  to?: string;
  onClick?: () => void;
  danger?: boolean;
  size?: 'sm' | 'md';
  exact?: boolean;
  id?: string;
  children?: React.ReactNode;
};

/**
 * One row in a dropdown menu, as a link or a button. A link to the current page is highlighted.
 */
const MenuItem: React.FC<MenuItemProps> = ({ label, icon, to, onClick, danger = false, size = 'sm', exact = false, id, children }) => {
  /**
   * Classes including highlight active state.
   * @param isActive - whether the link's route is active
   */
  const rowClass = (isActive: boolean): string => {
    const tone = danger ? 'text-red-600 dark:text-red-400' : isActive ? 'text-primary-700 bg-primary-50 dark:text-primary-400 dark:bg-white/5' : 'text-gray-700 dark:text-gray-200';
    return `flex items-center gap-3 w-full px-4 ${size === 'md' ? 'py-3' : 'py-2'} text-sm text-left transition-colors hover:bg-gray-100 dark:hover:bg-white/10 ${tone}`;
  };

  /**
   * Inner content.
   * @param isActive - whether the link's route is active
   */
  const content = (isActive: boolean): React.ReactNode => (
    <>
      {icon && <span className={`flex-shrink-0 ${danger ? 'text-red-600 dark:text-red-400' : isActive ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}>{icon}</span>}
      <span className="flex-1 min-w-0">{label}</span>
      {children}
    </>
  );

  return to ? (
    <NavLink to={to} end={exact} id={id} onClick={onClick} className={({ isActive }) => rowClass(isActive)}>{({ isActive }) => content(isActive)}</NavLink>
  ) : (
    <button type="button" id={id} onClick={onClick} className={rowClass(false)}>{content(false)}</button>
  );
};

export default MenuItem;
