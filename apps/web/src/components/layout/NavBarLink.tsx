import React from 'react';
import { NavLink } from 'react-router-dom';

/**
 * A main navigation link in the top bar, highlighted while its route is active.
 */
const NavBarLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <NavLink to={to} end className={({ isActive }) => `block ${isActive ? 'text-primary-700 dark:text-primary-500' : 'text-gray-700 hover:text-primary-700 dark:text-gray-400 dark:hover:text-white'}`}>
    {children}
  </NavLink>
);

export default NavBarLink;
