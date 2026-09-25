import React from 'react';

type FullScreenLoadingIndicatorProps = {
  isVisible: boolean;
  message?: string;
};

/**
 * Full screen loading overlay with an optional message.
 */
const FullScreenLoadingIndicator: React.FC<FullScreenLoadingIndicatorProps> = ({ isVisible, message }) => {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="loading fixed inset-0 w-full h-full z-50 bg-gray-200 !m-0 !p-0 dark:bg-gray-500" style={{ zIndex: 2147483641 }}>
      <div className="aliasvault-fullscreen-spinner mx-auto">
        <div className="cloud-shape-inverted">
          <div className="dot-inverted delay-1"></div>
          <div className="dot-inverted delay-2"></div>
          <div className="dot-inverted delay-3"></div>
          <div className="dot-inverted delay-4"></div>
        </div>
        {message && (
          <div className="loading-message mt-4 text-center text-gray-700 dark:text-gray-300">
            {message}
          </div>
        )}
      </div>
    </div>
  );
};

export default FullScreenLoadingIndicator;
