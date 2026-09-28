import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/**
 * A queued notification.
 */
export type Notification = {
  type: 'success' | 'error';
  message: string;
};

type NotificationContextType = {
  addSuccessMessage: (message: string, notify?: boolean) => void;
  addErrorMessage: (message: string, notify?: boolean) => void;
  clearMessages: () => void;
  takeMessages: () => Notification[];
  version: number;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

/**
 * Global notifications: messages are queued here and rendered inline at the top of the page.
 */
export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queue = useRef<Notification[]>([]);
  const [version, setVersion] = useState(0);

  /**
   * Queue a message.
   */
  const add = useCallback((notification: Notification, notify: boolean): void => {
    queue.current = [...queue.current, notification];
    if (notify) {
      setVersion(v => v + 1);
    }
  }, []);

  /**
   * Queue a success message.
   */
  const addSuccessMessage = useCallback((message: string, notify: boolean = false): void => add({ type: 'success', message }, notify), [add]);

  /**
   * Queue an error message.
   */
  const addErrorMessage = useCallback((message: string, notify: boolean = false): void => add({ type: 'error', message }, notify), [add]);

  /**
   * Drop every queued message and clear what is shown.
   */
  const clearMessages = useCallback((): void => {
    queue.current = [];
    setVersion(v => v + 1);
  }, []);

  /**
   * Take the queued messages off the queue.
   */
  const takeMessages = useCallback((): Notification[] => {
    const messages = queue.current;
    queue.current = [];
    return messages;
  }, []);

  const value = useMemo(() => ({ addSuccessMessage, addErrorMessage, clearMessages, takeMessages, version }), [addSuccessMessage, addErrorMessage, clearMessages, takeMessages, version]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

/**
 * Hook to use the global notifications.
 */
export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
