import React from 'react';

/**
 * Green alert box.
 */
const AlertMessageSuccess: React.FC<{ message: string }> = ({ message }) => {
  if (!message) {
    return null;
  }
  return (
    <div className="p-4 mb-4 text-sm text-green-800 rounded-lg bg-green-50 border-2 dark:bg-green-800 dark:text-white dark:border-green-500 dark:border" role="alert">
      {message}
    </div>
  );
};

export default AlertMessageSuccess;
