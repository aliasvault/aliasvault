import React from 'react';

type SkeletonBaseProps = {
  height?: number;
  additionalClasses?: string;
  children?: React.ReactNode;
};

/**
 * Skeleton placeholder for loading states.
 */
const SkeletonBase: React.FC<SkeletonBaseProps> = ({ height = 60, additionalClasses = '', children }) => (
  <div className={`skeleton-base ${additionalClasses}`} style={{ height: `${height}px` }}>
    {children}
    <div className="skeleton-shimmer"></div>
  </div>
);

export default SkeletonBase;
