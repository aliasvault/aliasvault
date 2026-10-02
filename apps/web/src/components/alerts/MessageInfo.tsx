import React from 'react';

import Icon from '@/components/shared/Icon';

/**
 * Orange info box with a title.
 */
const MessageInfo: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-orange-100 border-l-4 border-orange-500 text-orange-700 p-4 mb-6" role="alert">
    <div className="flex">
      <div className="py-1">
        <Icon name="information-circle" className="h-6 w-6 text-orange-500 mr-4" />
      </div>
      <div>
        {title && <p className="font-bold">{title}</p>}
        <div className="text-sm">{children}</div>
      </div>
    </div>
  </div>
);

export default MessageInfo;
