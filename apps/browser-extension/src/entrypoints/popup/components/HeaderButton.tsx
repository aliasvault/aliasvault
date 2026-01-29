import React from 'react';

import { HeaderIcon, HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';

type HeaderButtonProps = {
  onClick: () => void;
  title: string;
  iconType: HeaderIconType;
  variant?: 'default' | 'primary' | 'danger';
  id?: string;
};

/**
 * Header button component for consistent header button styling
 */
const HeaderButton: React.FC<HeaderButtonProps> = ({
  onClick,
  title,
  iconType,
  variant = 'default',
  id
}) => {
  const colorClasses = {
    default: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700',
    primary: 'text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/20',
    danger: 'text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20'
  };

  return (
    <button
      id={id}
      onClick={onClick}
      className={`p-2 rounded-lg ${colorClasses[variant]}`}
      title={title}
    >
      <HeaderIcon type={iconType} />
    </button>
  );
};

export default HeaderButton;