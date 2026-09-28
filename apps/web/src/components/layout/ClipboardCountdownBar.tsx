import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { clipboardCopyService, type ClipboardStatus } from '@/utils/ClipboardCopyService';

/**
 * Thin bar at the top of the page counting down to the clipboard clear, with a manual clear button when the
 * browser refused the automatic clear.
 */
const ClipboardCountdownBar: React.FC = () => {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<ClipboardStatus>(clipboardCopyService.getStatus());

  useEffect(() => {
    const unsubscribeProgress = clipboardCopyService.subscribeProgress(setProgress);
    const unsubscribeStatus = clipboardCopyService.subscribeStatus(setStatus);
    return (): void => {
      unsubscribeProgress();
      unsubscribeStatus();
    };
  }, []);

  if (status === 'cleared') {
    return null;
  }

  // Once the countdown ran out without a clear, the bar stays full (blue) until the clear goes through.
  const waiting = status === 'pending' || status === 'manual_clear_required' || progress <= 0;
  const barColorClass = waiting ? 'bg-blue-500 dark:bg-blue-400' : 'bg-orange-500 dark:bg-orange-400';
  const animationClass = waiting && status !== 'manual_clear_required' ? 'animate-pulse' : '';

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-gray-200 dark:bg-gray-700">
      <div className={`h-full ${barColorClass} transition-all duration-100 ease-linear ${animationClass}`} style={{ width: `${waiting ? 100 : progress * 100}%` }}></div>
      {status === 'manual_clear_required' && (
        <div className="fixed top-2 left-1/2 transform -translate-x-1/2 z-50 bg-blue-500 dark:bg-blue-600 text-white px-4 py-2 rounded-md shadow-lg flex items-center gap-3">
          <button type="button" onClick={() => void clipboardCopyService.clearNow()} className="px-3 py-1 bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 rounded text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700">
            {t('common.clipboardCountdown.clearClipboardButton')}
          </button>
        </div>
      )}
    </div>
  );
};

export default ClipboardCountdownBar;
