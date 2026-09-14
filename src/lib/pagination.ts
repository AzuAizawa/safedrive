export const DEFAULT_BOOKING_PAGE_SIZE = 6;

/** Rows per page on admin and support lists. */
export const LIST_PAGE_SIZE = 20;

export const getPageCount = (itemCount: number, pageSize = DEFAULT_BOOKING_PAGE_SIZE) =>
  Math.max(1, Math.ceil(Math.max(0, itemCount) / Math.max(1, pageSize)));

export const clampPage = (page: number, itemCount: number, pageSize = DEFAULT_BOOKING_PAGE_SIZE) =>
  Math.min(Math.max(1, Math.trunc(page) || 1), getPageCount(itemCount, pageSize));

export const paginateItems = <T,>(items: readonly T[], page: number, pageSize = DEFAULT_BOOKING_PAGE_SIZE) => {
  const safeSize = Math.max(1, pageSize);
  const safePage = clampPage(page, items.length, safeSize);
  const startIndex = (safePage - 1) * safeSize;

  return {
    items: items.slice(startIndex, startIndex + safeSize),
    page: safePage,
    pageCount: getPageCount(items.length, safeSize),
    startIndex,
    endIndex: Math.min(startIndex + safeSize, items.length),
  };
};

/**
 * The same page facts for a list the database pages (only the current page is
 * loaded, plus the total), shaped for BookingPagination.
 */
export const serverPageInfo = (page: number, total: number, pageSize = LIST_PAGE_SIZE) => {
  const safeSize = Math.max(1, pageSize);
  const safePage = clampPage(page, total, safeSize);
  const startIndex = (safePage - 1) * safeSize;
  return {
    page: safePage,
    pageCount: getPageCount(total, safeSize),
    startIndex,
    endIndex: Math.min(startIndex + safeSize, Math.max(0, total)),
    total: Math.max(0, total),
  };
};

/** The inclusive row range PostgREST's .range() wants for a page. */
export const pageRange = (page: number, pageSize = LIST_PAGE_SIZE) => {
  const safeSize = Math.max(1, pageSize);
  const from = (Math.max(1, Math.trunc(page) || 1) - 1) * safeSize;
  return { from, to: from + safeSize - 1 };
};

