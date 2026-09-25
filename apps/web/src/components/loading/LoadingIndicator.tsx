import React from 'react';

/**
 * Inline loading indicator shown while a page loads its data.
 */
const LoadingIndicator: React.FC = () => (
  <div role="status" className="px-4 mt-4">
    <div className="aliasvault-spinner-inline">
      <div className="cloud-shape-inline-enhanced">
        <div className="dot-inline delay-1"></div>
        <div className="dot-inline delay-2"></div>
        <div className="dot-inline delay-3"></div>
        <div className="dot-inline delay-4"></div>
      </div>
    </div>
    <span className="sr-only">Loading...</span>
  </div>
);

export default LoadingIndicator;
