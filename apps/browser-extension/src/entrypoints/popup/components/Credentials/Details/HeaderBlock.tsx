import React from 'react';

import type { Credential } from '@/utils/dist/core/models/vault';
import SqliteClient from '@/utils/SqliteClient';

type HeaderBlockProps = {
  credential: Credential;
}

/**
 * Render the header block.
 */
const HeaderBlock: React.FC<HeaderBlockProps> = ({ credential }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center">
      <img
        src={SqliteClient.imgSrcFromBytes(credential.Logo)}
        alt={credential.ServiceName}
        className="w-12 h-12 rounded-lg mr-4"
      />
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">{credential.ServiceName}</h1>
        {credential.ServiceUrl && (
          /^https?:\/\//i.test(credential.ServiceUrl) ? (
            <a
              href={credential.ServiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 break-all"
            >
              {credential.ServiceUrl}
            </a>
          ) : (
            <span className="text-gray-500 dark:text-gray-300 break-all">{credential.ServiceUrl}</span>
          )
        )}
      </div>
    </div>
  </div>
);

export default HeaderBlock;