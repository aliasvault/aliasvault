import React from 'react';

/**
 * Red warning box.
 */
const MessageWarning: React.FC<{ message: string }> = ({ message }) => {
  if (!message) {
    return null;
  }
  return <div className="p-4 mb-4 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 rounded-lg">{message}</div>;
};

export default MessageWarning;
