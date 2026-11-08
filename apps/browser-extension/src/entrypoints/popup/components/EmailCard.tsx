import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import ContextMenu, { MenuItem, type ContextMenuHandle } from '@/entrypoints/popup/components/ContextMenu';
import { AttachmentIcon } from '@/entrypoints/popup/components/Icons/AttachmentIcon';
import { SelectCheckbox } from '@/entrypoints/popup/components/SelectionBar';

import type { MailboxEmail } from '@aliasvault/models/webapi';

type EmailCardProps = {
  email: MailboxEmail;
  dateLabel: string;
  selectionMode: boolean;
  isSelected: boolean;
  onSelect: (email: MailboxEmail, range: boolean) => void;
  onDelete: (emailId: number) => void;
};

/**
 * Email in the mailbox list, with selection and a right-click menu.
 */
const EmailCard: React.FC<EmailCardProps> = ({ email, dateLabel, selectionMode, isSelected, onSelect, onDelete }) => {
  const { t } = useTranslation();
  const menuRef = useRef<ContextMenuHandle>(null);

  /**
   * Toggle selection status when selection mode is active or a modifier is held, otherwise let the link open the email.
   */
  const handleClick = (e: React.MouseEvent): void => {
    if (selectionMode || e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      onSelect(email, selectionMode && e.shiftKey);
    }
  };

  return (
    <div className="email-card" onContextMenu={(e) => {
      e.preventDefault(); menuRef.current?.open(e.clientX, e.clientY);
    }}>
      <Link
        to={`/emails/${email.id}`}
        onClick={handleClick}
        className={`flex items-start p-4 rounded-lg shadow hover:shadow-md transition-shadow border ${selectionMode ? 'select-none' : ''} ${
          isSelected
            ? 'bg-primary-50 border-primary-300 hover:bg-primary-100 dark:bg-primary-900/20 dark:border-primary-700 dark:hover:bg-primary-900/30'
            : 'bg-white border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700'
        }`}
      >
        {selectionMode && <span className="mt-1"><SelectCheckbox isSelected={isSelected} /></span>}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start mb-2">
            <div className="text-gray-900 dark:text-white mb-1 font-bold">
              {email.subject}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 text-sm text-gray-500 dark:text-gray-400">
              {email.hasAttachments && <AttachmentIcon className="w-4 h-4" />}
              <span>{dateLabel}</span>
            </div>
          </div>
          <div className="text-gray-600 text-sm dark:text-gray-300 line-clamp-2">
            {email.messagePreview}
          </div>
        </div>
      </Link>
      <ContextMenu ref={menuRef}>
        <MenuItem danger onClick={() => onDelete(email.id)}>{t('common.delete')}</MenuItem>
      </ContextMenu>
    </div>
  );
};

export default EmailCard;
