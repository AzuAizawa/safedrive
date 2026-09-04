import { CreditCard, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router";

import AdminSectionTabs from "@/components/AdminSectionTabs";
import AdminPayoutsPage from "@/pages/admin/AdminPayoutsPage";
import AdminRefundReviewPage from "@/pages/admin/AdminRefundReviewPage";

type FinancialReviewView = "payouts" | "refunds";

const validViews = new Set<FinancialReviewView>(["payouts", "refunds"]);

export default function AdminFinancialReviewsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get("view") as FinancialReviewView | null;
  const view = requestedView && validViews.has(requestedView) ? requestedView : "payouts";

  const changeView = (nextView: FinancialReviewView) => {
    setSearchParams({ view: nextView }, { replace: true });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Financial Reviews</h1>
        <p className="mt-1 text-muted-foreground">
          One workspace for money that staff must release, return, or decide.
        </p>
      </div>

      <AdminSectionTabs
        value={view}
        onChange={changeView}
        ariaLabel="Financial review type"
        tabs={[
          { value: "payouts", label: "Lister payouts" },
          { value: "refunds", label: "Renter refunds" },
        ]}
      />

      <div className="rounded-2xl border border-border/60 bg-card/20 p-4 sm:p-5">
        <div className="mb-5 flex items-start gap-3 border-b border-border/60 pb-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {view === "payouts" ? <CreditCard className="h-5 w-5" /> : null}
            {view === "refunds" ? <RotateCcw className="h-5 w-5" /> : null}
          </span>
          <div>
            <h2 className="font-semibold">
              {view === "payouts" ? "Pay the lister after completion" : null}
              {view === "refunds" ? "Return cancelled-booking money" : null}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {view === "payouts" ? "Only completed and eligible bookings should reach this queue." : null}
              {view === "refunds" ? "Confirm the provider result before recording a manual fallback." : null}
            </p>
          </div>
        </div>

        {view === "payouts" ? <AdminPayoutsPage embedded /> : null}
        {view === "refunds" ? <AdminRefundReviewPage embedded /> : null}
      </div>
    </div>
  );
}
