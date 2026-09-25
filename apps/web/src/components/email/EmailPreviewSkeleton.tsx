import React from 'react';

import SkeletonBase from '@/components/loading/SkeletonBase';

/**
 * Skeleton placeholder for the email preview panel.
 */
const EmailPreviewSkeleton: React.FC = () => (
  <div className="h-full flex flex-col bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700">
    <div className="p-4 border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
      <div className="flex items-center justify-between mb-2">
        <SkeletonBase height={24} additionalClasses="w-3/4">
          <div className="w-full h-full bg-gray-300 dark:bg-gray-600 rounded"></div>
        </SkeletonBase>
        <SkeletonBase height={20} additionalClasses="w-5">
          <div className="w-full h-full bg-gray-300 dark:bg-gray-600 rounded"></div>
        </SkeletonBase>
      </div>
      <div className="space-y-2">
        {['w-1/2', 'w-1/3', 'w-1/4', 'w-1/3'].map((width, index) => (
          <SkeletonBase key={index} height={16} additionalClasses={width}>
            <div className="w-full h-full bg-gray-300 dark:bg-gray-600 rounded"></div>
          </SkeletonBase>
        ))}
      </div>
    </div>
    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-4"></div>
    </div>
  </div>
);

export default EmailPreviewSkeleton;
