export default function BookingComplianceNotice({ hold, reason }: { hold?: boolean; reason?: string | null }) {
  if (!hold) return null;
  return <div role="status" className="my-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
    <p className="font-semibold">Vehicle documents need review</p>
    <p>{reason || "Approved documents do not cover the entire rental period."} Your booking is retained while the documents are reviewed. Payment and pickup are paused. If this is still not resolved when the pickup time passes, SafeDrive cancels the booking and refunds anything paid in full; contact support with any questions.</p>
  </div>;
}
