import { type UiIconName } from '@aliasvault/models/icons';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { MenuItem } from '@/entrypoints/popup/components/ContextMenu';
import Icon from '@/entrypoints/popup/components/Icons/Icon';

type SelectionBarProps = {
  count: number;
  visibleCount: number;
  onSelectAll: () => void;
  onClose: () => void;
  dialogOpen?: boolean;
  onDialogOpenChange?: (isOpen: boolean) => void;
  children: React.ReactNode;
};

const buttonClass = 'inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/**
 * Floating bar above the bottom navigation of a list in selection mode: close, count, select all and the given actions.
 */
const SelectionBar: React.FC<SelectionBarProps> = ({ count, visibleCount, onSelectAll, onClose, dialogOpen = false, onDialogOpenChange, children }) => {
  const { t } = useTranslation();
  const countLabel = t('common.selection.count', { count });
  const allSelected = count > 0 && count >= visibleCount;

  const dialogOpenRef = useRef(dialogOpen);
  dialogOpenRef.current = dialogOpen;

  useEffect(() => {
    onDialogOpenChange?.(dialogOpen);
  }, [dialogOpen, onDialogOpenChange]);
  useEffect(() => (): void => onDialogOpenChange?.(false), [onDialogOpenChange]);

  useEffect(() => {
    /**
     * Escape leaves selection mode, unless a dialog or menu takes it.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !dialogOpenRef.current && !document.querySelector('[role="menu"]')) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      {/* Room to scroll the last rows above the floating bar. */}
      <div className="h-16" aria-hidden />
      <div id="selection-action-bar" role="toolbar" aria-label={countLabel} className="fixed bottom-[65px] left-3 right-3 z-20 flex items-center gap-1 p-1.5 rounded-xl bg-white ring-1 ring-gray-300 shadow-[0_12px_32px_-4px_rgba(0,0,0,0.25),0_4px_10px_-2px_rgba(0,0,0,0.12)] dark:bg-gray-700 dark:ring-gray-500 dark:shadow-[0_12px_32px_0_rgba(0,0,0,0.6),0_4px_10px_rgba(0,0,0,0.4)]">
        <button type="button" onClick={onClose} title={t('common.close')} aria-label={t('common.close')} className={`${buttonClass} w-8 h-8 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-600 dark:hover:text-white`}>
          <Icon name="x" className="w-[18px] h-[18px]" />
        </button>
        <span className="pl-1.5 pr-1 text-sm font-medium whitespace-nowrap tabular-nums text-gray-900 dark:text-white" aria-live="polite">{countLabel}</span>
        <span aria-hidden className="h-5 w-px mx-1 bg-gray-300 dark:bg-gray-500" />
        <button type="button" onClick={onSelectAll} disabled={allSelected} className={`${buttonClass} min-w-0 px-2 h-8 text-sm font-medium whitespace-nowrap text-gray-800 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-600`}>
          <span className="truncate">{t('common.selection.selectAll')}</span>
        </button>
        <div className="flex-1" />
        {children}
      </div>
    </>
  );
};

type SelectionBarButtonProps = {
  icon: UiIconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  id?: string;
};

/**
 * An icon-only action button in the selection bar.
 */
export const SelectionBarButton: React.FC<SelectionBarButtonProps> = ({ icon, label, onClick, disabled = false, danger = false, id }) => (
  <button type="button" id={id} onClick={onClick} disabled={disabled} title={label} aria-label={label} className={`${buttonClass} w-8 h-8 ${danger ? 'text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/20' : 'text-gray-800 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-600'}`}>
    <Icon name={icon} className="w-[18px] h-[18px]" />
  </button>
);

type SelectionMenuItemProps = {
  isActive: boolean;
  onToggle: () => void;
};

/**
 * Menu entry that turns selection mode on or off.
 */
export const SelectionMenuItem: React.FC<SelectionMenuItemProps> = ({ isActive, onToggle }) => {
  const { t } = useTranslation();
  return (
    <MenuItem id="list-select" standalone icon={isActive ? 'square-feather' : 'square-check'} onClick={onToggle}>
      {isActive ? t('common.selection.disable') : t('common.selection.enable')}
    </MenuItem>
  );
};

/**
 * The checkbox look of a row in selection mode; the row itself handles the click.
 */
export const SelectCheckbox: React.FC<{ isSelected: boolean }> = ({ isSelected }) => (
  <span aria-hidden className={`w-4 h-4 mr-2 flex-shrink-0 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-primary-500 border-primary-500 text-white' : 'bg-white border-gray-300 dark:bg-gray-800 dark:border-gray-500'}`}>
    {isSelected && <Icon name="check" className="w-3 h-3" strokeWidth={3} />}
  </span>
);

export default SelectionBar;
