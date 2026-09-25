import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import AlertMessageSuccess from '@/components/alerts/AlertMessageSuccess';
import { type Notification, useNotifications } from '@/context/NotificationContext';

type GlobalNotificationDisplayProps = {
  marginTop?: boolean;
  marginBottom?: boolean;
  paddingX?: boolean;
};

/**
 * Renders the queued global notifications inline. Messages are refreshed on navigation and whenever a message is
 * queued with notify.
 */
const GlobalNotificationDisplay: React.FC<GlobalNotificationDisplayProps> = ({ marginTop = true, marginBottom = false, paddingX = true }) => {
  const { takeMessages, version } = useNotifications();
  const location = useLocation();
  const [messages, setMessages] = useState<Notification[]>([]);

  useEffect(() => {
    setMessages(takeMessages());
  }, [takeMessages, version, location.pathname]);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className={`messages-container grid ${paddingX ? 'px-4' : ''} ${marginTop ? 'pt-6' : ''} lg:gap-4 ${marginBottom ? 'pb-6' : ''}`}>
      {messages.filter(m => m.type === 'success').map((message, index) => (
        <AlertMessageSuccess key={`success-${index}`} message={message.message} />
      ))}
      {messages.filter(m => m.type === 'error').map((message, index) => (
        <AlertMessageError key={`error-${index}`} message={message.message} />
      ))}
    </div>
  );
};

export default GlobalNotificationDisplay;
