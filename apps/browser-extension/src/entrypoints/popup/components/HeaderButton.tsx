import React from 'react';

import { HeaderIcon, HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';

type HeaderButtonProps = {
  onClick: () => void;
  title: string;
  iconType: HeaderIconType;
  variant?: 'default' | 'primary' | 'danger';
  id?: string;
  disabled?: boolean;
  isLoading?: boolean;
  isActive?: boolean;
};

/**
 * Header button component for consistent header button styling
 */
const HeaderButton: React.FC<HeaderButtonProps> = ({
  onClick,
  title,
  iconType,
  variant = 'default',
  id,
  disabled = false,
  isLoading = false,
  isActive = false
}) => {
  /** The `primary` variant is filled with the accent color to mark the main action of a screen. */
  const variantClasses = {
    default: {
      base: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700',
      active: 'text-gray-700 bg-gray-100 dark:text-gray-200 dark:bg-gray-700'
    },
    primary: {
      base: 'text-white bg-primary-600 hover:bg-primary-700 shadow-sm',
      active: 'text-white bg-primary-700 shadow-sm'
    },
    danger: {
      base: 'text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20',
      active: 'text-red-600 bg-red-100 dark:bg-red-900/20'
    }
  };

  const isDisabled = disabled || isLoading;
  const stateClasses = variantClasses[variant][isActive ? 'active' : 'base'];

  return (
    <button
      id={id}
      onClick={onClick}
      disabled={isDisabled}
      className={`p-2 rounded-lg transition-colors ${stateClasses} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      title={title}
    >
      {isLoading ? (
        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : (
        <HeaderIcon type={iconType} />
      )}
    </button>
  );
};

export default HeaderButton;