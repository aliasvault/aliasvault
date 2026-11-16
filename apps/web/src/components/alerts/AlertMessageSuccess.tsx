import React from 'react';

import DismissButton from '@/components/alerts/DismissButton';
import type { NotificationLink } from '@/context/NotificationContext';

type AlertMessageSuccessProps = {
  message: string;
  link?: NotificationLink;
  onDismiss?: () => void;
};

/**
 * Green alert box.
 */
const AlertMessageSuccess: React.FC<AlertMessageSuccessProps> = ({ message, link, onDismiss }) => {
  if (!message) {
    return null;
  }
  const at = link ? message.lastIndexOf(link.text) : -1;
  return (
    <div className="flex items-start gap-3 p-4 mb-4 text-sm text-green-800 rounded-lg bg-green-50 border-2 dark:bg-green-800 dark:text-white dark:border-green-500 dark:border" role="alert">
      <div className="flex-1 min-w-0">
        {link && at >= 0 ? (
          <>
            {message.slice(0, at)}
            <button type="button" onClick={link.onClick} className="font-medium underline underline-offset-2 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 rounded">
              {link.text}
            </button>
            {message.slice(at + link.text.length)}
          </>
        ) : message}
      </div>
      {onDismiss && <DismissButton onClick={onDismiss} />}
    </div>
  );
};

export default AlertMessageSuccess;
