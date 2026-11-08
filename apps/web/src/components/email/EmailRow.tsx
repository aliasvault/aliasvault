import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import SenderInitials from '@/components/email/SenderInitials';
import ContextMenu, { MenuItem, type ContextMenuHandle } from '@/components/shared/ContextMenu';
import Icon from '@/components/shared/Icon';
import SelectCheckbox from '@/components/shared/SelectCheckbox';

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
  isSelectionMode: boolean;
  isChecked: boolean;
  onCheck: (email: MailListEntry, range: boolean) => void;
  onDelete: (id: number) => void;
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
const EmailRowComponent: React.FC<EmailRowProps> = ({ email, onEmailClick, isSelectionMode, isChecked, onCheck, onDelete, isSelected, isNewEmail }) => {
  const { t } = useTranslation();
  const menuRef = useRef<ContextMenuHandle>(null);

  /**
   * Open the email, or toggle selection status when selection mode is active or a modifier is held.
   */
  const handleClick = (e: React.MouseEvent): void => {
    if (isSelectionMode || e.metaKey || e.ctrlKey || e.shiftKey) {
      onCheck(email, isSelectionMode && e.shiftKey);
      return;
    }
    onEmailClick(email.id);
  };

  let colorClass = 'hover:bg-gray-100 dark:hover:bg-gray-600';
  if (isSelected) {
    colorClass = 'bg-primary-50 dark:bg-primary-900/30 hover:bg-primary-200 dark:hover:bg-primary-900/50';
  } else if (isChecked) {
    colorClass = 'bg-primary-50 hover:bg-primary-100 dark:bg-primary-900/20 dark:hover:bg-primary-900/30';
  }
  const borderClass = isSelected ? 'border-l-4 border-primary-500' : '';

  return (
    <li
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault(); menuRef.current?.open(e.clientX, e.clientY);
      }}
      className={`email-row flex items-center transition duration-150 ease-in-out cursor-pointer ${isSelectionMode ? 'select-none' : ''} ${colorClass} ${borderClass}`}>
      {isSelectionMode && (
        <SelectCheckbox isSelected={isChecked} onSelect={range => onCheck(email, range)} className="ml-4 -mr-1" />
      )}
      <ContextMenu ref={menuRef}>
        <MenuItem icon="eye" onClick={() => onEmailClick(email.id)}>{t('common.open')}</MenuItem>
        <MenuItem danger icon="trash" onClick={() => onDelete(email.id)}>{t('common.delete')}</MenuItem>
      </ContextMenu>
      <div className="p-4 flex flex-grow min-w-0 justify-start items-start">
        <div className="mr-4 flex-shrink-0">
          <SenderInitials senderName={email.fromName} senderEmail={email.fromEmail} />
        </div>
        <div className="flex-grow min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-grow min-w-0 mr-2">
              <div className="text-gray-800 dark:text-gray-200 font-medium truncate mb-1 flex items-center">
                {email.fromName}
                {email.hasAttachments && (
                  <Icon name="paper-clip" className="attachment-indicator w-3 h-3 ml-1 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                )}
                {isNewEmail && (
                  <div className="w-2 h-2 ml-1 bg-yellow-500 rounded-full animate-pulse flex-shrink-0" title={t('emails.row.newEmailTooltip')}></div>
                )}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300 truncate mb-1">
                {email.subject}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
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
