import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import Icon from '@/components/shared/Icon';
import { type Notification, useNotifications } from '@/context/NotificationContext';

/** How long a toast stays, in milliseconds, by type. */
const DURATION_MS: Record<Notification['type'], number> = { success: 5000, error: 10000 };

/** The most toasts shown at once; a new one pushes out the oldest. */
const MAX_TOASTS = 3;

/** Length of the exit transition, in milliseconds. */
const EXIT_MS = 150;

/** Tinted colors by type, so a toast stands out from the cards underneath in both themes. */
const TONE: Record<Notification['type'], { toast: string; icon: string }> = {
  success: { toast: 'bg-green-50 border-green-300 text-green-900 dark:bg-green-900 dark:border-green-600 dark:text-green-50', icon: 'text-green-600 dark:text-green-300' },
  error: { toast: 'bg-red-50 border-red-300 text-red-900 dark:bg-red-900 dark:border-red-600 dark:text-red-50', icon: 'text-red-600 dark:text-red-300' },
};

type Toast = Notification & { id: number; leaving: boolean };

type ToastItemProps = {
  toast: Toast;
  onDismiss: (id: number) => void;
};

/**
 * One toast: closes itself after its duration, paused while hovered or focused.
 */
const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const { t } = useTranslation();
  const [isPaused, setIsPaused] = useState(false);
  const remaining = useRef(DURATION_MS[toast.type]);
  const isError = toast.type === 'error';
  const tone = TONE[toast.type];
  const { link } = toast;
  const at = link ? toast.message.lastIndexOf(link.text) : -1;

  useEffect(() => {
    if (isPaused || toast.leaving) {
      return undefined;
    }
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return (): void => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [isPaused, toast.leaving, toast.id, onDismiss]);

  /**
   * Close the toast, then follow its link.
   */
  const followLink = (): void => {
    onDismiss(toast.id);
    link?.onClick();
  };

  return (
    <div
      role={isError ? 'alert' : undefined}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
      className={`pointer-events-auto flex items-start gap-3 w-full p-4 text-sm rounded-lg shadow-lg border ${tone.toast} transition-[opacity,transform] duration-150 ease-in motion-reduce:transition-none motion-reduce:animate-none ${toast.leaving ? 'opacity-0 translate-y-2' : 'animate-toast-in'}`}
    >
      <Icon name={isError ? 'x-circle' : 'check-circle'} className={`w-5 h-5 shrink-0 ${tone.icon}`} />
      <p className="flex-1 min-w-0 break-words">
        {link && at >= 0 ? (
          <>
            {toast.message.slice(0, at)}
            <button type="button" onClick={followLink} className="font-semibold underline underline-offset-2 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-current rounded">
              {link.text}
            </button>
            {toast.message.slice(at + link.text.length)}
          </>
        ) : toast.message}
      </p>
      <button type="button" onClick={() => onDismiss(toast.id)} aria-label={t('common.dismiss')} className="shrink-0 -m-1 p-1 rounded opacity-60 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-current">
        <Icon name="x" className="w-4 h-4" />
      </button>
    </div>
  );
};

/**
 * Shows the queued notifications as toasts in the bottom right corner, or along the bottom on small screens.
 */
const Toaster: React.FC = () => {
  const { takeMessages, version, cleared } = useNotifications();
  const location = useLocation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const seenCleared = useRef(cleared);

  useEffect(() => {
    const isCleared = cleared !== seenCleared.current;
    seenCleared.current = cleared;
    const taken = takeMessages();
    if (!isCleared && taken.length === 0) {
      return;
    }
    setToasts(current => {
      const kept = isCleared ? [] : current;
      const added = taken.filter(m => !kept.some(toast => !toast.leaving && toast.type === m.type && toast.message === m.message)).map(m => ({ ...m, id: nextId.current++, leaving: false }));
      return [...kept, ...added].slice(-MAX_TOASTS);
    });
  }, [takeMessages, version, cleared, location.pathname]);

  /**
   * Play the exit transition of a toast, then remove it.
   */
  const dismiss = useCallback((id: number): void => {
    setToasts(current => current.map(toast => (toast.id === id ? { ...toast, leaving: true } : toast)));
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), EXIT_MS);
  }, []);

  return (
    <div aria-live="polite" className="fixed z-[60] bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:w-96 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />)}
    </div>
  );
};

export default Toaster;
