import React from 'react';

type ResponsivePaginatorProps = {
  currentPage: number;
  pageSize: number;
  totalRecords: number;
  onPageChanged: (page: number) => void;
};

/**
 * Paginator with numbered pages on desktop and prev/next on mobile.
 */
const ResponsivePaginator: React.FC<ResponsivePaginatorProps> = ({ currentPage, pageSize, totalRecords, onPageChanged }) => {
  const pageCount = Math.ceil(totalRecords / pageSize);

  if (totalRecords <= pageSize) {
    return null;
  }

  /**
   * Go to a page, clamped to the valid range.
   */
  const setPage = (pageNumber: number): void => {
    onPageChanged(Math.min(Math.max(pageNumber, 1), pageCount));
  };

  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter(i => i === 1 || i === pageCount || Math.abs(currentPage - i) <= 2);
  const pillClasses = 'px-3 py-2 bg-primary-100 text-primary-700 border border-primary-300 rounded hover:bg-primary-200 transition duration-300 shadow-sm';

  return (
    <>
      <div className="hidden md:block">
        <nav aria-label="Page navigation" className="mt-4 flex justify-end mb-5">
          <ul className="flex space-x-2">
            <li className={currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}>
              <a className={pillClasses} href="#" onClick={(e) => {
                e.preventDefault(); setPage(currentPage - 1); 
              }}>Previous</a>
            </li>
            {pages.map(pageNum => (
              <li key={pageNum}>
                <a className={`px-3 py-2 ${currentPage === pageNum ? 'bg-primary-600 text-white' : 'bg-primary-100 text-primary-700'} border border-primary-300 rounded hover:bg-primary-200 transition duration-300 shadow-sm`} href="#" onClick={(e) => {
                  e.preventDefault(); setPage(pageNum); 
                }}>{pageNum}</a>
              </li>
            ))}
            <li className={currentPage === pageCount ? 'opacity-50 cursor-not-allowed' : ''}>
              <a className={pillClasses} href="#" onClick={(e) => {
                e.preventDefault(); setPage(currentPage + 1); 
              }}>Next</a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="block md:hidden">
        <nav aria-label="Page navigation" className="mt-4 flex justify-center mb-5">
          <ul className="flex items-center space-x-2">
            <li className={currentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}>
              <button onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} className={`${pillClasses} disabled:opacity-50 disabled:cursor-not-allowed`}>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            </li>
            <li>
              <span className="px-3 py-2 bg-primary-600 text-white border border-primary-300 rounded shadow-sm">
                {currentPage} / {pageCount}
              </span>
            </li>
            <li className={currentPage === pageCount ? 'opacity-50 cursor-not-allowed' : ''}>
              <button onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount} className={`${pillClasses} disabled:opacity-50 disabled:cursor-not-allowed`}>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </>
  );
};

export default ResponsivePaginator;
