import React from 'react';
import { useTranslation } from 'react-i18next';

import SenderInitials from '@/components/email/SenderInitials';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

/**
 * One email as shown in the mailbox list.
 */
export type MailListEntry = {
  id: number;
  date: Date;
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  messagePreview: string;
  item: { ref: ItemRef; name: string } | null;
  hasAttachments: boolean;
};

type EmailRowProps = {
  email: MailListEntry;
  onEmailClick: (id: number) => void;
  onEmailCheck: (id: number) => void;
  isChecked: boolean;
  isSelected: boolean;
  isNewEmail: boolean;
};

/**
 * Format a date as dd-MM.
 * @param date - the date
 */
const formatShortDate = (date: Date): string => `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/**
 * A row in the mailbox list.
 */
const EmailRowComponent: React.FC<EmailRowProps> = ({ email, onEmailClick, onEmailCheck, isChecked, isSelected, isNewEmail }) => {
  const { t } = useTranslation();

  return (
    <li className={`flex items-center transition duration-150 ease-in-out cursor-pointer ${isSelected ? 'bg-primary-50 dark:bg-primary-900/30 border-l-4 border-primary-500 hover:bg-primary-200 dark:hover:bg-primary-900/50' : 'hover:bg-gray-100 dark:hover:bg-gray-600'}`}>
      <div className="pl-4 mr-2 flex-shrink-0">
        <input
          className="form-checkbox h-4 w-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
          type="checkbox"
          checked={isChecked}
          onChange={() => onEmailCheck(email.id)} />
      </div>
      <div onClick={() => onEmailClick(email.id)} className="p-4 flex flex-grow min-w-0 justify-start items-start">
        <div className="mr-4 flex-shrink-0">
          <SenderInitials senderName={email.fromName} senderEmail={email.fromEmail} />
        </div>
        <div className="flex-grow min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-grow min-w-0 mr-2">
              <div className="text-gray-800 dark:text-gray-200 font-medium truncate mb-1 flex items-center">
                {email.fromName}
                {email.hasAttachments && (
                  <svg className="attachment-indicator w-3 h-3 ml-1 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path>
                  </svg>
                )}
                {isNewEmail && (
                  <div className="w-2 h-2 ml-1 bg-yellow-500 rounded-full animate-pulse flex-shrink-0" title={t('components.main.email.emailRow.NewEmailTooltip')}></div>
                )}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300 truncate mb-1">
                {email.subject}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {email.messagePreview}
              </div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
              {formatShortDate(email.date)}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
};

/** Only re-render when this row's own inputs change. */
const EmailRow = React.memo(EmailRowComponent);

export default EmailRow;
