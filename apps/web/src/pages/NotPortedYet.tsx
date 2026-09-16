import React from 'react';
import { useLocation } from 'react-router-dom';

import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';

/**
 * Placeholder for links that have not been ported yet from the Blazor WASM app.
 * TODO: delete this file once all links have been ported and no usages remain.
 */
const NotPortedYet: React.FC<{ title: string }> = ({ title }) => {
  const location = useLocation();

  return (
    <>
      <PageHeader title={title} description="This page has not been ported to the React web app yet." />
      <PageContent className="px-4 mb-4">
        <div className="p-4 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Route <code>{location.pathname}</code> is still served by the Blazor client.</p>
        </div>
      </PageContent>
    </>
  );
};

export default NotPortedYet;
