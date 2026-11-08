import { type UiIconName } from '@aliasvault/models/icons';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { MenuItem } from '@/components/shared/ContextMenu';
import Icon from '@/components/shared/Icon';
import { isTypingTarget } from '@/hooks/useKeyboardShortcut';

type SelectionBarProps = {
  count: number;
  visibleCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onClose: () => void;
  /** While a dialog of the bar is open, Escape belongs to the dialog. */
  dialogOpen: boolean;
  /** The actions on the selected rows. */
  children: React.ReactNode;
};

const baseButtonClass = 'inline-flex items-center gap-2 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';
const buttonClass = `${baseButtonClass} px-3.5 text-gray-800 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-600`;

/**
 * Floating bar of a list in selection mode: close, count, select all and the given actions.
 */
const SelectionBar: React.FC<SelectionBarProps> = ({ count, visibleCount, onSelectAll, onDeselectAll, onClose, dialogOpen, children }) => {
  const { t } = useTranslation();
  const countLabel = t('common.selection.count', { count });
  const allSelected = count > 0 && count >= visibleCount;
  const selectAllLabel = allSelected ? t('common.selection.deselectAll') : t('common.selection.selectAll');

  const dialogOpenRef = useRef(dialogOpen);
  dialogOpenRef.current = dialogOpen;

  useEffect(() => {
    /**
     * Escape leaves selection mode, unless a dialog or menu takes it.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !dialogOpenRef.current && !isTypingTarget() && !document.querySelector('[role="menu"]')) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return (): void => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <>
      {/* Room below the list so the bar never covers the last rows. */}
      <div className="h-20" aria-hidden />
      <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] sm:w-auto">
        <div id="selection-action-bar" role="toolbar" aria-label={countLabel} className="flex items-center gap-1.5 rounded-xl bg-white shadow-[0_12px_32px_-4px_rgba(0,0,0,0.25),0_4px_10px_-2px_rgba(0,0,0,0.12)] ring-1 ring-gray-300 dark:bg-gray-700 dark:shadow-[0_12px_32px_0_rgba(0,0,0,0.6),0_4px_10px_rgba(0,0,0,0.4)] dark:ring-gray-500 p-2">
          <button type="button" onClick={onClose} aria-label={t('common.close')} title={t('common.close')} className={`${baseButtonClass} justify-center w-8 h-8 py-0 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-600 dark:hover:text-white`}>
            <Icon name="x" className="w-[18px] h-[18px]" />
          </button>
          <span aria-live="polite" className="pl-1 pr-1 text-sm font-medium whitespace-nowrap mr-auto sm:mr-0 text-gray-900 dark:text-white tabular-nums">{countLabel}</span>
          <span aria-hidden className="h-5 w-px mx-1.5 bg-gray-300 dark:bg-gray-500" />
          <button type="button" onClick={allSelected ? onDeselectAll : onSelectAll} title={selectAllLabel} className={buttonClass}>
            <Icon name={allSelected ? 'square-feather' : 'square-check'} className="w-4 h-4" />
            <span className="hidden sm:inline">{selectAllLabel}</span>
          </button>
          {children}
        </div>
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
 * An action button in the selection bar; the label hides on small screens.
 */
export const SelectionBarButton: React.FC<SelectionBarButtonProps> = ({ icon, label, onClick, disabled = false, danger = false, id }) => (
  <button type="button" id={id} onClick={onClick} disabled={disabled} title={label} className={danger ? `${baseButtonClass} px-3.5 text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/20` : buttonClass}>
    <Icon name={icon} className="w-4 h-4" />
    <span className="hidden sm:inline">{label}</span>
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

export default SelectionBar;
