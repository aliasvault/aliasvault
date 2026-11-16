import React from 'react';

import DismissButton from '@/components/alerts/DismissButton';

type AlertMessageErrorProps = {
  message: string;
  hasTopMargin?: boolean;
  onDismiss?: () => void;
};

/**
 * Red alert box.
 */
const AlertMessageError: React.FC<AlertMessageErrorProps> = ({ message, hasTopMargin = true, onDismiss }) => {
  if (!message) {
    return null;
  }
  return (
    <div className={`flex items-start gap-3 p-4 ${hasTopMargin ? 'mt-4' : ''} text-sm text-red-800 rounded-lg bg-red-50 border-2 dark:bg-red-800 dark:text-white dark:border-red-500 dark:border`} role="alert">
      <div className="flex-1 min-w-0">{message}</div>
      {onDismiss && <DismissButton onClick={onDismiss} />}
    </div>
  );
};

export default AlertMessageError;
