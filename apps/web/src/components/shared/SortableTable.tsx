import React from 'react';

/** Sort direction. */
export type SortDirection = 'asc' | 'desc';

/** A table column. */
export type TableColumn = {
  title: string;
  propertyName?: string;
  sortable?: boolean;
};

type SortableTableProps = {
  columns: TableColumn[];
  sortColumn: string;
  sortDirection: SortDirection;
  onSortChanged: (column: string, direction: SortDirection) => void;
  children: React.ReactNode;
};

/**
 * Table with sortable column headers.
 */
const SortableTable: React.FC<SortableTableProps> = ({ columns, sortColumn, sortDirection, onSortChanged, children }) => {
  /**
   * Toggle or switch the sort column.
   */
  const onSort = (columnName: string): void => {
    if (sortColumn === columnName) {
      onSortChanged(columnName, sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      onSortChanged(columnName, 'asc');
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-x-auto">
      <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400 min-w-max">
        <thead className="text-xs text-gray-700 bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
          <tr>
            {columns.map((column, index) => (
              <th key={column.propertyName ?? index} scope="col" className="px-4 py-3">
                {column.sortable !== false && column.propertyName ? (
                  <button className="flex items-center hover:text-gray-900 dark:hover:text-white" onClick={() => onSort(column.propertyName!)}>
                    {column.title}
                    <span className="ml-1">
                      {sortColumn === column.propertyName && (
                        sortDirection === 'asc' ? (
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                            <path fillRule="evenodd" d="M5.293 7.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L6.707 7.707a1 1 0 01-1.414 0z" clipRule="evenodd"></path>
                          </svg>
                        ) : (
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                            <path fillRule="evenodd" d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd"></path>
                          </svg>
                        )
                      )}
                    </span>
                  </button>
                ) : column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
          {children}
        </tbody>
      </table>
    </div>
  );
};

type SortableTableRowProps = {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
};

/**
 * A table row.
 */
export const SortableTableRow: React.FC<SortableTableRowProps> = ({ children, className = '', onClick, onContextMenu }) => (
  <tr
    onClick={onClick}
    onContextMenu={onContextMenu ? (e: React.MouseEvent): void => {
      e.preventDefault();
      onContextMenu(e);
    } : undefined}
    className={`bg-white border-b dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 ${onClick ? 'cursor-pointer' : ''} ${className}`}>
    {children}
  </tr>
);

type SortableTableColumnProps = {
  children?: React.ReactNode;
  isPrimary?: boolean;
  title?: string;
  padding?: boolean;
};

/**
 * A table cell.
 */
export const SortableTableColumn: React.FC<SortableTableColumnProps> = ({ children, isPrimary = false, title, padding = true }) => (
  <td className={`${padding ? 'px-4 py-3' : ''} ${isPrimary ? 'font-medium text-gray-900 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'}`} title={title}>
    {children}
  </td>
);

export default SortableTable;
