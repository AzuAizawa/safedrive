export const DEFAULT_BOOKING_PAGE_SIZE = 6;

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

