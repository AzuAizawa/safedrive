export const GUEST_INQUIRY_TOPICS = [
  "What is SafeDrive / how it works",
  "Renting a vehicle",
  "Booking availability",
  "Cancellation or rescheduling",
  "Driver requirements",
  "Listing a vehicle / vehicle eligibility",
  "Vehicle requirements",
  "Account registration or verification",
  "Payments, fees, or refunds",
  "Locations or service area",
  "Safety or insurance",
  "Complaint or safety concern",
  "Privacy or personal data",
  "Business or partnership",
  "Technical problem",
  "Other",
] as const;

export type GuestInquiryTopic = (typeof GUEST_INQUIRY_TOPICS)[number];
