import React from 'react';

import SkeletonBase from '@/components/loading/SkeletonBase';

/**
 * Skeleton placeholder for a mailbox row.
 */
const EmailRowSkeleton: React.FC = () => (
  <li className="hover:bg-gray-50 dark:hover:bg-gray-600 transition duration-150 ease-in-out">
    <div className="p-4 flex justify-start items-start">
      <div className="mr-4 flex-shrink-0">
        <SkeletonBase height={40} additionalClasses="rounded-full w-10">
          <div className="w-full h-full rounded-full bg-gray-300 dark:bg-gray-700"></div>
        </SkeletonBase>
      </div>
      <div className="flex-grow min-w-0">
        <div className="flex items-start justify-between">
          <div className="flex-grow min-w-0 mr-2">
            <div className="mb-1">
              <SkeletonBase height={18} additionalClasses="w-40">
                <div className="w-full h-full bg-gray-300 dark:bg-gray-700 rounded"></div>
              </SkeletonBase>
            </div>
            <div className="mb-1">
              <SkeletonBase height={16} additionalClasses="w-48">
                <div className="w-full h-full bg-gray-300 dark:bg-gray-700 rounded"></div>
              </SkeletonBase>
            </div>
            <div>
              <SkeletonBase height={12} additionalClasses="w-64">
                <div className="w-full h-full bg-gray-300 dark:bg-gray-700 rounded"></div>
              </SkeletonBase>
            </div>
          </div>
          <div className="flex-shrink-0">
            <SkeletonBase height={12} additionalClasses="w-10">
              <div className="w-full h-full bg-gray-300 dark:bg-gray-700 rounded"></div>
            </SkeletonBase>
          </div>
        </div>
      </div>
    </div>
  </li>
);

export default EmailRowSkeleton;
