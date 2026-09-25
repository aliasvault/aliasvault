import React from 'react';

/**
 * The outlined pill spinner used on the logout, unlock and sync screens.
 */
const BoldLoadingIndicator: React.FC = () => (
  <div className="aliasvault-spinner mx-auto">
    <div className="cloud-shape-inverted">
      <div className="dot-inverted delay-1"></div>
      <div className="dot-inverted delay-2"></div>
      <div className="dot-inverted delay-3"></div>
      <div className="dot-inverted delay-4"></div>
    </div>
  </div>
);

export default BoldLoadingIndicator;
