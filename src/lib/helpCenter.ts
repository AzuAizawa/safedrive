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
      "An unpaid request is free to cancel any time before you pay. A paid booking cancelled at least the configured number of hours before pickup (default 24) is refunded in full automatically. Inside that window, or after the pickup time, you get a published share back (default 50%) with the rest kept as short-notice compensation to the lister, confirmed by support review. Once either side records arrival, the booking can no longer be cancelled through self-service.",
    relatedTags: ["cancel", "refund", "booking"],
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
      "Record your own arrival first. SafeDrive uses the server-timestamped arrival check-in plus the 30-minute pickup grace window as its main evidence base, together with any optional photo you submit. After the grace window, report the no-show from the booking flow so support can review the dispute quickly.",
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
