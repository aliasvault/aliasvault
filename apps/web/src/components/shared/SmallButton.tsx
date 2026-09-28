import React from 'react';

/** Small button colors. */
export type SmallButtonColor = 'primary' | 'danger' | 'neutral';

type SmallButtonProps = {
  children: React.ReactNode;
  onClick: () => void;
  color?: SmallButtonColor;
  isDisabled?: boolean;
  title?: string;
};

const COLOR_CLASSES: Record<SmallButtonColor, string> = {
  primary: 'bg-primary-600 hover:bg-primary-700 text-white',
  danger: 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30',
  neutral: 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700',
};

/**
 * Compact button for an inline action on a list row.
 */
const SmallButton: React.FC<SmallButtonProps> = ({ children, onClick, color = 'neutral', isDisabled = false, title }) => (
  <button type="button" disabled={isDisabled} title={title} onClick={onClick} className={`shrink-0 px-2 py-1 text-xs font-medium rounded-md disabled:opacity-50 ${COLOR_CLASSES[color]}`}>
    {children}
  </button>
);

export default SmallButton;
