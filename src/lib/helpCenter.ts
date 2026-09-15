export type HelpCategory =
  | "account"
  | "verification"
  | "booking"
  | "payment"
  | "arrival"
  | "support";

export type HelpArticle = {
  id: string;
  category: HelpCategory;
  title: string;
  question: string;
  answer: string;
  relatedTags: string[];
  suggestedTicketTag?: string;
};

export const helpCategories: Array<{ id: "all" | HelpCategory; label: string }> = [
  { id: "all", label: "All answers" },
  { id: "account", label: "Account" },
  { id: "verification", label: "Verification" },
  { id: "booking", label: "Booking" },
  { id: "payment", label: "Payments" },
  { id: "arrival", label: "Arrival and no-show" },
  { id: "support", label: "Support" },
];

export const helpArticles: HelpArticle[] = [
  {
    id: "account-delete",
    category: "account",
    title: "Deleting your account",
    question: "How do I delete my SafeDrive account, and can I change my mind?",
    answer:
      "Open Account settings and choose Delete account. Your account is scheduled for deletion after a grace period (30 days unless SafeDrive changes it; the exact date is shown before you confirm). Until then it is hidden: your listings are off SafeDrive and you cannot book or be booked. To keep it, sign in before the date and choose Keep my account. After the date, your personal details, ID photos and payout details are erased and your login is closed, so the email can be used for a new account; bookings and payments you took part in are kept without your name. A booking not yet finished, a refund or payout not yet completed, or an open booking support case must be settled first, and a suspended account is handled through a privacy request.",
    relatedTags: ["account", "delete", "deletion", "privacy", "close account"],
    suggestedTicketTag: "account",
  },
  {
    id: "verification-review-time",
    category: "verification",
    title: "How long does verification take?",
    question: "When will my identity verification be reviewed?",
    answer:
      "Most SafeDrive verification reviews finish within 24 hours. More complex checks can take 1 to 3 business days, especially when uploaded IDs are unclear or details do not match.",
    relatedTags: ["verification", "approval", "review"],
    suggestedTicketTag: "verification",
  },
  {
    id: "booking-downpayment",
    category: "payment",
    title: "Downpayment versus balance",
    question: "What is the difference between the downpayment and the remaining balance?",
    answer:
      "The reservation downpayment is part of the rental price and reserves the booking; its percentage is shown on the car page before you book. The remaining balance covers the rest of the rental price and is settled online before the trip starts.",
    relatedTags: ["downpayment", "balance", "payment", "booking"],
    suggestedTicketTag: "payment",
  },
  {
    id: "booking-payment-status",
    category: "payment",
    title: "Why payment can still look pending",
    question: "Why does checkout finish before the booking status changes?",
    answer:
      "SafeDrive waits for the signed PayMongo webhook before treating a payment as confirmed. Creating a checkout session or finishing the provider page does not change the booking until that webhook arrives.",
    relatedTags: ["paymongo", "checkout", "pending", "payment"],
    suggestedTicketTag: "payment",
  },
  {
    id: "booking-cancel-window",
    category: "booking",
    title: "How cancellation works",
    question: "When can I still cancel a booking?",
    answer:
      "An unpaid request is free to cancel any time before you pay. A paid booking cancelled at least the configured number of hours before pickup (default 24) is refunded in full automatically; if you paid when pickup was already closer than that, you can still cancel free for a few hours after paying (default 4, never past pickup). After that, a cancellation fee counted in rental days applies - by default one day of the booking's average daily cost, or half a day for trips of two days or less - the same whether you paid the downpayment or in full and never more than you paid; the rest is refunded after support review. Cancelling after the pickup time, or not showing up, counts as a no-show with a higher fee (default two days, or three quarters of a day for short trips). The car page shows these amounts for your trip before you send a request, and My Bookings shows the exact amount before you confirm a cancellation. Once either side records arrival you can no longer cancel yourself - use the no-car report if the lister does not come with the car. A lister can still cancel up to the handover, for example if the car cannot be driven, and you are then refunded in full.",
    relatedTags: ["cancel", "refund", "booking"],
    suggestedTicketTag: "booking",
  },
  {
    id: "booking-notice",
    category: "booking",
    title: "How soon a trip can start",
    question: "Why can't I choose a pickup time only a few hours away?",
    answer:
      "A trip starts no earlier than tomorrow, and its pickup time must also be at least the minimum notice away (default 12 hours) when you send the request. That leaves the lister time to accept and you time to pay before pickup. The car page only offers pickup times that meet it.",
    relatedTags: ["booking", "pickup", "time"],
    suggestedTicketTag: "booking",
  },
  {
    id: "car-inquiry",
    category: "booking",
    title: "Questions before booking",
    question: "How do I ask the lister something before I book?",
    answer:
      "Use the Ask the lister flow on the car details page for listing-specific questions like pickup availability, inclusions, or child-seat availability. That opens a shared inquiry thread that both the renter and lister can reply to.",
    relatedTags: ["inquiry", "lister", "listing", "question"],
    suggestedTicketTag: "inquiry",
  },
  {
    id: "arrival-check-in",
    category: "arrival",
    title: "How arrival is confirmed",
    question: "How does SafeDrive confirm that someone showed up?",
    answer:
      "Each side uses the one-tap arrival check-in action at pickup. A photo can still be added as optional evidence, but it is no longer required just to confirm that you showed up. When both sides record arrival, the booking moves into its active state and both parties are notified.",
    relatedTags: ["arrival", "pickup", "check-in", "photo"],
    suggestedTicketTag: "booking_report",
  },
  {
    id: "no-show-policy",
    category: "arrival",
    title: "If the other side does not show up",
    question: "What should I do if I arrive but the other person does not?",
    answer:
      "Record your own arrival first. SafeDrive uses the server-timestamped arrival check-in plus the pickup grace window as its main evidence base, together with any optional photo you submit. Your booking screen shows exactly how long that wait is and the time it ends. After the grace window, report the no-show from the booking flow so support can review the dispute quickly. If neither side checks in at all, both are warned, and a few hours after the pickup time (default 6) SafeDrive cancels the booking, refunds the renter in full after support review, frees the dates, and records the missed pickup on both accounts. The same clock settles a pickup where only one side checks in and nobody reports it, or both check in but the car is never handed over, the way the report would have: a missing lister or a car not handed over refunds the renter in full, and a missing renter is a no-show.",
    relatedTags: ["no-show", "arrival", "pickup", "dispute"],
    suggestedTicketTag: "no_show",
  },
  {
    id: "support-when-to-ticket",
    category: "support",
    title: "When to open a ticket",
    question: "When should I use a support ticket instead of quick answers?",
    answer:
      "Open a support ticket when your case is specific to your booking, payment, verification, or dispute, or when you need a human review. Quick answers are best for policy and process questions that have a general answer.",
    relatedTags: ["support", "ticket", "help"],
    suggestedTicketTag: "general",
  },
];
