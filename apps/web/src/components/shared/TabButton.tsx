import React from 'react';

type TabButtonProps = {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

/**
 * One tab of an underlined tab bar; the bar itself carries the bottom border.
 */
const TabButton: React.FC<TabButtonProps> = ({ active, onClick, children }) => (
  <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`-mb-px flex-1 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${active ? 'border-primary-600 text-primary-600 dark:border-primary-500 dark:text-primary-500' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}>
    {children}
  </button>
);

export default TabButton;
