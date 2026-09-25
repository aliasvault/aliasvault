import React from 'react';

type ModalHeaderActionProps = {
  children: React.ReactNode;
  title?: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
};

/**
 * A single action button in the action cluster of a modal header.
 */
const ModalHeaderAction: React.FC<ModalHeaderActionProps> = ({ children, title, onClick, variant = 'default' }) => {
  const buttonClass = variant === 'danger'
    ? 'inline-flex items-center justify-center h-9 min-w-[2.25rem] px-2 rounded text-sm font-medium text-red-500 hover:text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-gray-700'
    : 'inline-flex items-center justify-center h-9 min-w-[2.25rem] px-2 rounded text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700';

  return (
    <button type="button" onClick={onClick} title={title} className={buttonClass}>
      {children}
    </button>
  );
};

export default ModalHeaderAction;
