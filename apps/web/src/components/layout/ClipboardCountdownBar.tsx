import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { clipboardCopyService, type ClipboardStatus } from '@/utils/ClipboardCopyService';

/**
 * Thin bar at the top of the page counting down to the clipboard clear, with a manual clear button when the
 * browser refused the automatic clear.
 */
const ClipboardCountdownBar: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<ClipboardStatus>('active');

  useEffect(() => {
    const unsubscribeProgress = clipboardCopyService.subscribeProgress((value) => {
      setProgress(value);
      if (value > 0) {
        setIsVisible(true);
        setStatus('active');
      } else {
        setStatus((current) => {
          if (current !== 'cleared') {
            setIsVisible(true);
            setProgress(1);
            return 'pending';
          }
          return current;
        });
      }
    });
    const unsubscribeStatus = clipboardCopyService.subscribeStatus((value) => {
      setStatus(value);
      if (value === 'cleared') {
        setIsVisible(false);
        setProgress(0);
      } else if (value === 'pending' || value === 'manual_clear_required') {
        setIsVisible(true);
        setProgress(1);
      }
    });
    return (): void => {
      unsubscribeProgress();
      unsubscribeStatus();
    };
  }, []);

  /**
   * Clear the clipboard on the user's request.
   */
  const handleManualClear = async (): Promise<void> => {
    await clipboardCopyService.clearNow();
    setStatus('active');
    setIsVisible(true);
    setProgress(0);
  };

  if (!isVisible) {
    return null;
  }

  const barColorClass = status === 'pending' || status === 'manual_clear_required' ? 'bg-blue-500 dark:bg-blue-400' : 'bg-orange-500 dark:bg-orange-400';
  const animationClass = status === 'pending' ? 'animate-pulse' : '';

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-gray-200 dark:bg-gray-700">
      <div className={`h-full ${barColorClass} transition-all duration-100 ease-linear ${animationClass}`} style={{ width: `${progress * 100}%` }}></div>
      {status === 'manual_clear_required' && (
        <div className="fixed top-2 left-1/2 transform -translate-x-1/2 z-50 bg-blue-500 dark:bg-blue-600 text-white px-4 py-2 rounded-md shadow-lg flex items-center gap-3">
          <button type="button" onClick={() => void handleManualClear()} className="px-3 py-1 bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 rounded text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700">
            {t('components.main.clipboardCountdownBar.ClearClipboardButton')}
          </button>
        </div>
      )}
    </div>
  );
};

export default ClipboardCountdownBar;
