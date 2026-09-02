import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

type BookingPaginationProps = {
  page: number;
  pageCount: number;
  startIndex: number;
  endIndex: number;
  total: number;
  onPageChange: (page: number) => void;
};

export default function BookingPagination({
  page,
  pageCount,
  startIndex,
  endIndex,
  total,
  onPageChange,
}: BookingPaginationProps) {
  if (total === 0 || pageCount <= 1) return null;

  return (
    <nav
      aria-label="Bookings pagination"
      className="flex flex-col items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 sm:flex-row"
    >
      <p className="text-sm text-muted-foreground">
        Showing {startIndex + 1}–{endIndex} of {total} bookings
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <span className="min-w-20 text-center text-sm font-medium">
          {page} / {pageCount}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
