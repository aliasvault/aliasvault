import React from 'react';

import { HeaderIcon, HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import Icon from '@/entrypoints/popup/components/Icons/Icon';

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
      className={`inline-flex items-center justify-center min-w-[30px] min-h-[30px] rounded-lg transition-colors ${stateClasses} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      title={title}
    >
      {isLoading ? (
        <Icon name="spinner" className="animate-spin h-5 w-5" />
      ) : (
        <HeaderIcon type={iconType} />
      )}
    </button>
  );
};

export default HeaderButton;