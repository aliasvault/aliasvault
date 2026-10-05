import React from 'react';

import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

/**
 * Loading spinner full screen component used throughout the app for showing a loading spinner
 * that covers the entire screen.
 */
const LoadingSpinnerFullScreen: React.FC = () => {
  const { isLoading } = useLoading();

  if (!isLoading) {
    return null;
  }

  const spinnerStyle: React.CSSProperties = {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  };

  const spinner = (
    <>
      <style>
        {`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}
      </style>
      <div
        className="border-[4px] border-solid border-current/10 dark:border-white/10 border-t-current dark:border-t-white"
        style={spinnerStyle}
      />
    </>
  );

  return (
    <div className="fixed inset-0 w-full h-full z-[100] bg-gray-200 dark:bg-gray-500 bg-opacity-90 flex items-center justify-center">
      <div className="relative">
        {spinner}
      </div>
    </div>
  );
};

export default LoadingSpinnerFullScreen;
