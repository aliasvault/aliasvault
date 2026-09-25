import React from 'react';

/**
 * Red alert box.
 */
const AlertMessageError: React.FC<{ message: string; hasTopMargin?: boolean }> = ({ message, hasTopMargin = true }) => {
  if (!message) {
    return null;
  }
  return (
    <div className={`p-4 ${hasTopMargin ? 'mt-4' : ''} text-sm text-red-800 rounded-lg bg-red-50 border-2 dark:bg-red-800 dark:text-white dark:border-red-500 dark:border`} role="alert">
      {message}
    </div>
  );
};

export default AlertMessageError;
