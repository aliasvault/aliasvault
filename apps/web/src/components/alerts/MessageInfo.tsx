import React from 'react';

/**
 * Orange info box with a title.
 */
const MessageInfo: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-orange-100 border-l-4 border-orange-500 text-orange-700 p-4 mb-6" role="alert">
    <div className="flex">
      <div className="py-1">
        <svg className="fill-current h-6 w-6 text-orange-500 mr-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
          <path d="M2.93 17.07A10 10 0 1 1 17.07 2.93 10 10 0 0 1 2.93 17.07zm12.73-1.41A8 8 0 1 0 4.34 4.34a8 8 0 0 0 11.32 11.32zM9 11V9h2v6H9v-4zm0-6h2v2H9V5z" />
        </svg>
      </div>
      <div>
        {title && <p className="font-bold">{title}</p>}
        <div className="text-sm">{children}</div>
      </div>
    </div>
  </div>
);

export default MessageInfo;
