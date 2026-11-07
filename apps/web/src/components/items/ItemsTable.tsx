import { scopedKey } from '@aliasvault/client/database/ItemRef';
import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import ItemContextMenu, { type ItemContextMenuHandle } from '@/components/items/ItemContextMenu';
import ItemIcon from '@/components/items/ItemIcon';
import type { ItemListEntry } from '@/components/items/ItemListEntry';
import ItemSelectCheckbox from '@/components/items/ItemSelectCheckbox';
import SortableTable, { SortableTableColumn, SortableTableRow, type SortDirection, type TableColumn } from '@/components/shared/SortableTable';
import { itemRoute } from '@/utils/ItemRoute';

const TABLE_COLUMNS: TableColumn[] = [
  { title: 'Service', propertyName: 'Service' },
  { title: 'Username', propertyName: 'Username' },
  { title: 'Email', propertyName: 'Email' },
  { title: 'Created', propertyName: 'CreatedAt' },
  { title: '', sortable: false },
];

type ItemsTableProps = {
  entries: ItemListEntry[];
  sortColumn: string;
  sortDirection: SortDirection;
  onTableSortChanged: (column: string, direction: SortDirection) => void;
  onMutated: () => void;
  isSelectionMode: boolean;
  isSelected: (entry: ItemListEntry) => boolean;
  onSelect: (entry: ItemListEntry, range: boolean) => void;
};

type ItemsTableRowProps = {
  entry: ItemListEntry;
  onMutated: () => void;
  isSelectionMode: boolean;
  isSelected: boolean;
  onSelect: (range: boolean) => void;
};

/**
 * Format a date as yyyy-MM-dd.
 * @param date - the date
 */
const formatDate = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * One table row.
 */
const ItemsTableRow: React.FC<ItemsTableRowProps> = ({ entry, onMutated, isSelectionMode, isSelected, onSelect }) => {
  const navigate = useNavigate();
  const menuRef = useRef<ItemContextMenuHandle>(null);
  const selectedClass = isSelected ? '!bg-primary-50 hover:!bg-primary-100 dark:!bg-primary-900/20 dark:hover:!bg-primary-900/30' : '';

  /**
   * Open the item, or toggle selection status when selection mode is active.
   */
  const handleClick = (e: React.MouseEvent): void => {
    if (isSelectionMode || e.metaKey || e.ctrlKey || e.shiftKey) {
      onSelect(isSelectionMode && e.shiftKey);
      return;
    }
    navigate(itemRoute({ Id: entry.id, ManifestId: entry.manifestId }));
  };

  return (
    <SortableTableRow className={`cursor-pointer group ${isSelectionMode ? 'select-none' : ''} ${selectedClass}`} onClick={handleClick} onContextMenu={(e) => menuRef.current?.open(e.clientX, e.clientY)}>
      <SortableTableColumn padding={false}>
        <div className="flex items-center space-x-2 py-2 pl-2">
          <ItemSelectCheckbox isSelected={isSelected} onSelect={onSelect} className="-mr-1" />
          <ItemIcon item={entry.item} altText={entry.service ?? ''} sizeClass="w-6 h-6" />
          <span className="font-bold ml-2 truncate">{entry.service}</span>
        </div>
      </SortableTableColumn>
      <SortableTableColumn padding={false}>{entry.username}</SortableTableColumn>
      <SortableTableColumn padding={false}>{entry.email}</SortableTableColumn>
      <SortableTableColumn padding={false}>{formatDate(entry.createdAt)}</SortableTableColumn>
      <SortableTableColumn padding={false}>
        <div className="flex justify-end pr-2">
          <ItemContextMenu ref={menuRef} item={{ Id: entry.id, ManifestId: entry.manifestId }} itemName={entry.service} onMutated={onMutated} hideTrigger={isSelectionMode} isSelected={isSelected} onToggleSelect={() => onSelect(false)} />
        </div>
      </SortableTableColumn>
    </SortableTableRow>
  );
};

/**
 * Items in table view.
 */
const ItemsTable: React.FC<ItemsTableProps> = ({ entries, sortColumn, sortDirection, onTableSortChanged, onMutated, isSelectionMode, isSelected, onSelect }) => (
  <SortableTable columns={TABLE_COLUMNS} sortColumn={sortColumn} sortDirection={sortDirection} onSortChanged={onTableSortChanged}>
    {entries.map(entry => (
      <ItemsTableRow key={scopedKey(entry.manifestId, entry.id)} entry={entry} onMutated={onMutated} isSelectionMode={isSelectionMode} isSelected={isSelected(entry)} onSelect={range => onSelect(entry, range)} />
    ))}
  </SortableTable>
);

export default ItemsTable;
