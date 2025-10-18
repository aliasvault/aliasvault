import React from 'react';
import { useNavigate } from 'react-router-dom';

import type { Credential } from '@/utils/dist/shared/models/vault';
import SqliteClient from '@/utils/SqliteClient';

type CredentialCardProps = {
  credential: Credential;
};

/**
 * CredentialCard component
 *
 * This component displays a credential card with a service name, username, and email.
 * It allows the user to navigate to the credential details page when clicked.
 *
 */
const CredentialCard: React.FC<CredentialCardProps> = ({ credential }) => {
  const navigate = useNavigate();

  /**
   * Get the display text for the credential
   * @param cred - The credential to get the display text for
   * @returns The display text for the credential
   */
  const getDisplayText = (cred: Credential): string => {
    let returnValue = '';

    // Show username if available
    if (cred.Username) {
      returnValue = cred.Username;
    }

    // Show email if username is not available
    if (cred.Alias?.Email) {
      returnValue = cred.Alias.Email;
    }

    // Trim the return value to max. 33 characters.
    return returnValue.length > 33 ? returnValue.slice(0, 30) + '...' : returnValue;
  };

  /**
   * Get the service name for a credential, trimming it to maximum length so it doesn't overflow the UI.
   */
  const getCredentialServiceName = (cred: Credential): string => {
    let returnValue = 'Untitled';

    if (cred.ServiceName) {
      returnValue = cred.ServiceName;
    }

    // Trim the return value to max. 33 characters.
    return returnValue.length > 33 ? returnValue.slice(0, 30) + '...' : returnValue;
  };

  return (
    <li>
      <button
        onClick={() => navigate(`/credentials/${credential.Id}`)}
        className="w-full p-2 border dark:border-gray-600 rounded flex items-center bg-white dark:bg-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <img
          src={SqliteClient.imgSrcFromBytes(credential.Logo)}
          alt={credential.ServiceName}
          className="w-8 h-8 mr-2 flex-shrink-0"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.src = '/assets/images/service-placeholder.webp';
          }}
        />
        <div className="text-left flex-1">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-gray-900 dark:text-white">{getCredentialServiceName(credential)}</p>
            {credential.HasPasskey && (
              <svg
                className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-label="Has passkey"
              >
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{getDisplayText(credential)}</p>
        </div>
      </button>
    </li>
  );
};

export default CredentialCard;
