import { useState } from "react";

import { LIST_PAGE_SIZE, paginateItems } from "./pagination";

/**
 * Previous / Next paging for a list the page has already loaded. Goes back to
 * page 1 whenever `resetKey` changes (a tab, filter or search), and stays in
 * range when the list shrinks - paginateItems clamps the page.
 */
export const usePagedItems = <T,>(
  items: readonly T[],
  resetKey: string,
  pageSize = LIST_PAGE_SIZE,
) => {
  const [page, setPage] = useState(1);
  const [pageKey, setPageKey] = useState(resetKey);
  // Adjusting state while rendering, as React recommends for "reset when a
  // prop changes" - no effect, so there is no flash of the wrong page.
  if (pageKey !== resetKey) {
    setPageKey(resetKey);
    setPage(1);
  }
  const result = paginateItems(items, page, pageSize);
  return {
    ...result,
    total: items.length,
    setPage,
    /** Spread into <BookingPagination /> with a noun. */
    paginationProps: {
      page: result.page,
      pageCount: result.pageCount,
      startIndex: result.startIndex,
      endIndex: result.endIndex,
      total: items.length,
      onPageChange: setPage,
    },
  };
};
