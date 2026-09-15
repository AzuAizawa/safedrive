import { CalendarClock } from "lucide-react";
import { Link } from "react-router";

import { formatManilaDateTime } from "@/lib/bookingNotice";
import {
  formatFeeDays,
  getCancellationQuote,
  type CancellationTermsSettings,
} from "@/lib/cancellationPolicy";

type CancellationPolicySummaryProps = {
  totalDays: number;
  totalPrice: number;
  basePrice: number;
  // null until a pickup time is chosen.
  pickupMs: number | null;
  // null while the platform settings are still loading.
  settings: CancellationTermsSettings | null;
  // false when the settings could not be read and only defaults are known.
  settingsAreLive: boolean;
  // Where the Terms page sends the renter back to.
  returnTo: string;
};

// Whole pesos without decimals; centavos always as two digits (₱999.50, not ₱999.5).
const formatAmount = (amount: number) =>
  `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

const bulletClass = "mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full";

// The cancellation terms for the trip being chosen, in pesos, shown before a
// request is sent (the Internet Transactions Act requires refund and
// cancellation terms to be disclosed before the transaction). Built from the
// same calculation that settles a real cancellation (src/lib/cancellationPolicy.ts)
// and the live settings the booking will be snapshotted with, so the amounts
// shown are the amounts charged.
export default function CancellationPolicySummary({
  totalDays,
  totalPrice,
  basePrice,
  pickupMs,
  settings,
  settingsAreLive,
  returnTo,
}: CancellationPolicySummaryProps) {
  const termsLink = (
    <Link
      to="/terms"
      state={{ returnTo }}
      className="font-medium text-primary underline underline-offset-2"
    >
      Full policy (Terms, section 6)
    </Link>
  );

  let body: React.ReactNode;
  if (!settings) {
    body = <p className="mt-2 text-xs text-muted-foreground">Loading cancellation terms...</p>;
  } else if (!settingsAreLive) {
    body = (
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        The current cancellation fees could not be loaded. Cancellation fees apply once free
        cancellation ends; they are set out in the {termsLink}.
      </p>
    );
  } else {
    const quote = getCancellationQuote({
      totalDays,
      totalPrice,
      basePrice,
      pickupMs,
      nowMs: Date.now(),
      settings,
    });

    const hoursLabel = (hours: number) => `${hours} ${hours === 1 ? "hour" : "hours"}`;
    const freeLine =
      quote.freeUntilMs === null
        ? quote.fullHours > 0
          ? `Free cancellation until ${hoursLabel(quote.fullHours)} before your pickup time, with a full refund.`
          : "Free cancellation until your pickup time, with a full refund."
        : quote.freeWindowOpenNow
          ? `Free cancellation until ${formatManilaDateTime(quote.freeUntilMs)}, with a full refund.`
          : quote.graceHours > 0
            ? `Free cancellation for ${hoursLabel(quote.graceHours)} after you pay (never past pickup), with a full refund.`
            : "No free cancellation once you pay - this pickup is too close.";
    const lateLine =
      quote.lateFee > 0
        ? `After that: ${formatAmount(quote.lateFee)} fee (${formatFeeDays(quote.lateFeeDays)} of rental).`
        : "After that: no cancellation fee.";
    const noShowLine =
      quote.noShowFee > 0
        ? `No-show, or cancelling after pickup: ${formatAmount(quote.noShowFee)} (${formatFeeDays(quote.noShowFeeDays)} of rental).`
        : "No-show, or cancelling after pickup: no fee.";

    body = (
      <>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed">
          <li className="flex gap-2">
            <span aria-hidden className={`${bulletClass} bg-emerald-500`} />
            <span className="min-w-0 break-words">{freeLine}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className={`${bulletClass} bg-amber-500`} />
            <span className="min-w-0 break-words">{lateLine}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className={`${bulletClass} bg-red-500`} />
            <span className="min-w-0 break-words">{noShowLine}</span>
          </li>
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Fees never exceed what you have paid, and you are refunded in full if the lister
          cancels or does not hand over the car. {termsLink}
        </p>
      </>
    );
  }

  return (
    <section
      aria-labelledby="cancellation-policy-heading"
      className="rounded-lg border border-border/60 bg-muted/30 p-4 text-sm"
    >
      <h3 id="cancellation-policy-heading" className="flex items-center gap-2 font-semibold">
        <CalendarClock aria-hidden className="h-4 w-4 shrink-0 text-primary" />
        Cancellation policy
      </h3>
      {body}
    </section>
  );
}
