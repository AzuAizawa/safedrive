import type { ServiceRoleSupabaseClient } from "./supabaseTypes.js";

type EmailState = "sent" | "not_configured" | "rejected" | "failed";

export type TransactionalEmailResult = {
  state: EmailState;
  providerId?: string;
  reason?: string;
};

type TransactionalEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

type ReceiptInput = {
  bookingId: string;
  amount: number;
  paymentType: "downpayment" | "balance" | "extension" | "security_deposit" | "full_payment";
  paymentMethod: string;
  transactionId: string;
  baseOrigin: string;
};

type RefundReceiptInput = {
  bookingId: string;
  amount: number;
  refundId: string;
  refundMethod: string;
  baseOrigin: string;
};

type PayoutReceiptInput = {
  bookingId: string;
  amount: number;
  payoutId: string;
  payoutMethod: string;
  transactionId: string | null;
  baseOrigin: string;
};

type ReceiptBooking = {
  id: string;
  renter_id: string;
  owner_id: string;
  cars: {
    plate_number: string;
    car_models: {
      name: string;
      car_brands: { name: string };
    };
  } | null;
};

type RecipientProfile = {
  email: string;
  full_name: string | null;
};

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const isEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const peso = (amount: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(Math.abs(amount));

const paymentLabel = (type: ReceiptInput["paymentType"]) => {
  if (type === "downpayment") return "Reservation downpayment";
  if (type === "balance") return "Booking balance";
  if (type === "extension") return "Rental extension";
  if (type === "full_payment") return "Full booking payment";
  return "Refundable security deposit";
};

const getVehicleLabel = (booking: ReceiptBooking) => {
  const car = booking.cars;
  if (!car) return "SafeDrive booking";
  return `${car.car_models.car_brands.name} ${car.car_models.name} (${car.plate_number})`;
};

const getAppLink = (origin: string, path: string) => {
  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
};

const page = (title: string, intro: string, rows: Array<[string, string]>, actionLabel: string, actionUrl: string) => {
  const table = rows.length
    ? `<table style="width:100%;border-collapse:collapse;margin:22px 0">${rows
        .map(
          ([label, value]) => `<tr><td style="padding:8px 0;color:#667085">${escapeHtml(label)}</td><td style="padding:8px 0;text-align:right;color:#101828;font-weight:600">${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>`
    : `<div style="margin:22px 0"></div>`;
  return `<!doctype html><html><body style="margin:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#101828"><main style="max-width:600px;margin:24px auto;background:#ffffff;border:1px solid #eaecf0;border-radius:16px;overflow:hidden"><div style="background:#087eea;padding:24px;color:#ffffff"><div style="font-size:20px;font-weight:700">SafeDrive</div><div style="margin-top:6px;font-size:14px">${escapeHtml(title)}</div></div><div style="padding:28px"><h1 style="font-size:24px;margin:0 0 12px">${escapeHtml(title)}</h1><p style="line-height:1.55;color:#475467">${escapeHtml(intro)}</p>${table}<a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#087eea;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">${escapeHtml(actionLabel)}</a><p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#667085">This is a transactional SafeDrive email about your account or booking. Please do not reply to this address.</p></div></main></body></html>`;
};

const messagePage = (
  title: string,
  intro: string,
  message: string,
  actionLabel: string,
  actionUrl: string,
) => `<!doctype html><html><body style="margin:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#101828"><main style="max-width:600px;margin:24px auto;background:#ffffff;border:1px solid #eaecf0;border-radius:16px;overflow:hidden"><div style="background:#087eea;padding:24px;color:#ffffff"><div style="font-size:20px;font-weight:700">SafeDrive</div><div style="margin-top:6px;font-size:14px">${escapeHtml(title)}</div></div><div style="padding:28px"><h1 style="font-size:24px;margin:0 0 12px">${escapeHtml(title)}</h1><p style="line-height:1.55;color:#475467">${escapeHtml(intro)}</p><div style="margin:22px 0;padding:16px;border:1px solid #d0d5dd;border-radius:10px;background:#f9fafb;color:#344054;line-height:1.6;white-space:pre-wrap">${escapeHtml(message)}</div><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#087eea;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">${escapeHtml(actionLabel)}</a><p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#667085">This is a transactional SafeDrive email about your account or booking. Please do not reply to this address.</p></div></main></body></html>`;

/**
 * Sends one transactional email through Resend's REST API. The key is read
 * only on the Vercel server. A missing email configuration never blocks a
 * payment/refund workflow, but the calling workflow can record the result.
 */
export const sendTransactionalEmail = async (
  input: TransactionalEmailInput,
): Promise<TransactionalEmailResult> => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    return { state: "not_configured", reason: "RESEND_API_KEY or RESEND_FROM_EMAIL is missing" };
  }
  if (!isEmail(input.to)) return { state: "rejected", reason: "Recipient email is invalid" };

  try {
    const response = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from,
        to: [input.to.trim().toLowerCase()],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(process.env.RESEND_REPLY_TO?.trim()
          ? { reply_to: process.env.RESEND_REPLY_TO.trim() }
          : {}),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };
    if (!response.ok) {
      console.warn("Resend transactional email rejected", {
        status: response.status,
        providerCode: body.name || null,
      });
      return { state: "rejected", reason: body.message || `Resend returned ${response.status}` };
    }
    return { state: "sent", providerId: body.id };
  } catch (error) {
    console.warn("Resend transactional email failed", {
      reason: error instanceof Error ? error.message : "unknown error",
    });
    return { state: "failed", reason: "Resend delivery request failed" };
  }
};

const loadBookingRecipient = async (
  supabase: ServiceRoleSupabaseClient,
  bookingId: string,
  party: "renter" | "owner",
) => {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("id, renter_id, owner_id, cars(plate_number, car_models(name, car_brands(name)))")
    .eq("id", bookingId)
    .single();
  if (bookingError || !booking) return null;

  const typedBooking = booking as unknown as ReceiptBooking;
  const recipientId = party === "renter" ? typedBooking.renter_id : typedBooking.owner_id;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", recipientId)
    .single();
  if (profileError || !profile) return null;
  return { booking: typedBooking, profile: profile as RecipientProfile };
};

const loadReceiptRecipient = (supabase: ServiceRoleSupabaseClient, bookingId: string) =>
  loadBookingRecipient(supabase, bookingId, "renter");

const loadPayoutRecipient = (supabase: ServiceRoleSupabaseClient, bookingId: string) =>
  loadBookingRecipient(supabase, bookingId, "owner");

export const sendPaymentReceiptEmail = async (
  supabase: ServiceRoleSupabaseClient,
  input: ReceiptInput,
) => {
  const recipient = await loadReceiptRecipient(supabase, input.bookingId);
  if (!recipient) return { state: "failed" as const, reason: "Receipt recipient could not be loaded" };

  const label = paymentLabel(input.paymentType);
  const vehicle = getVehicleLabel(recipient.booking);
  const bookingLink = getAppLink(input.baseOrigin, "/my-bookings");
  const reference = input.transactionId || "Recorded by SafeDrive";
  return sendTransactionalEmail({
    to: recipient.profile.email,
    subject: `SafeDrive receipt: ${label} · ${peso(input.amount)}`,
    text: `Hello ${recipient.profile.full_name || "there"},\n\nWe recorded your ${label.toLowerCase()} for ${vehicle}.\nAmount: ${peso(input.amount)}\nPayment method: ${input.paymentMethod}\nReference: ${reference}\n\nView your booking: ${bookingLink}\n\nSafeDrive`,
    html: page(
      "Payment receipt",
      `We recorded your ${label.toLowerCase()} for ${vehicle}. Keep this email with your booking records.`,
      [
        ["Vehicle", vehicle],
        ["Payment", label],
        ["Amount paid", peso(input.amount)],
        ["Method", input.paymentMethod],
        ["Reference", reference],
      ],
      "View booking",
      bookingLink,
    ),
    idempotencyKey: `payment-receipt:${input.paymentType}:${input.transactionId}:${recipient.booking.renter_id}`,
  });
};

export const sendRefundReceiptEmail = async (
  supabase: ServiceRoleSupabaseClient,
  input: RefundReceiptInput,
) => {
  const recipient = await loadReceiptRecipient(supabase, input.bookingId);
  if (!recipient) return { state: "failed" as const, reason: "Refund recipient could not be loaded" };

  const vehicle = getVehicleLabel(recipient.booking);
  const bookingLink = getAppLink(input.baseOrigin, "/my-bookings");
  return sendTransactionalEmail({
    to: recipient.profile.email,
    subject: `SafeDrive refund receipt · ${peso(input.amount)}`,
    text: `Hello ${recipient.profile.full_name || "there"},\n\nYour refund for ${vehicle} was completed.\nAmount refunded: ${peso(input.amount)}\nReturn method: ${input.refundMethod}\nReference: ${input.refundId}\n\nRefund posting times can vary by provider. View your booking: ${bookingLink}\n\nSafeDrive`,
    html: page(
      "Refund receipt",
      `Your refund for ${vehicle} was marked completed. Your payment provider may take additional time to show it in your account.`,
      [
        ["Vehicle", vehicle],
        ["Amount refunded", peso(input.amount)],
        ["Return method", input.refundMethod],
        ["Reference", input.refundId],
      ],
      "View booking",
      bookingLink,
    ),
    idempotencyKey: `refund-receipt:${input.refundId}:${recipient.booking.renter_id}`,
  });
};

export const sendPayoutReceiptEmail = async (
  supabase: ServiceRoleSupabaseClient,
  input: PayoutReceiptInput,
) => {
  const recipient = await loadPayoutRecipient(supabase, input.bookingId);
  if (!recipient) return { state: "failed" as const, reason: "Payout recipient could not be loaded" };

  const vehicle = getVehicleLabel(recipient.booking);
  const bookingLink = getAppLink(input.baseOrigin, "/lister-bookings");
  const reference = input.transactionId || input.payoutId;
  return sendTransactionalEmail({
    to: recipient.profile.email,
    subject: `SafeDrive payout receipt · ${peso(input.amount)}`,
    text: `Hello ${recipient.profile.full_name || "there"},\n\nSafeDrive recorded your lister payout for ${vehicle}.\nAmount released: ${peso(input.amount)}\nPayout method: ${input.payoutMethod}\nReference: ${reference}\n\nView your lister bookings: ${bookingLink}\n\nSafeDrive`,
    html: page(
      "Payout receipt",
      `SafeDrive recorded your lister payout for ${vehicle}. Keep this email with your booking records.`,
      [
        ["Vehicle", vehicle],
        ["Amount released", peso(input.amount)],
        ["Method", input.payoutMethod],
        ["Reference", reference],
      ],
      "View lister bookings",
      bookingLink,
    ),
    idempotencyKey: `payout-receipt:${input.payoutId}:${recipient.booking.owner_id}`,
  });
};

export const sendVerificationDecisionEmail = async (input: {
  to: string;
  name: string | null;
  status: "verified" | "rejected";
  rejectionReason?: string | null;
  baseOrigin: string;
  userId: string;
}) => {
  const approved = input.status === "verified";
  const actionUrl = getAppLink(input.baseOrigin, approved ? "/browse" : "/verify");
  const title = approved ? "Your SafeDrive verification is approved" : "Your SafeDrive verification needs attention";
  const intro = approved
    ? "Your identity verification was approved. You can now use the verified features of SafeDrive."
    : "Your identity verification was not approved yet. Review the reason below and submit corrected documents when ready.";
  const reason = input.rejectionReason?.trim() || "Please review your submitted documents and try again.";
  return sendTransactionalEmail({
    to: input.to,
    subject: title,
    text: `Hello ${input.name || "there"},\n\n${intro}${approved ? "" : `\nReason: ${reason}`}\n\n${approved ? "Start browsing" : "Update your verification"}: ${actionUrl}\n\nSafeDrive`,
    html: page(
      approved ? "Verification approved" : "Verification needs attention",
      intro,
      approved ? [["Status", "Verified"]] : [["Status", "Not approved"], ["Reason", reason]],
      approved ? "Browse SafeDrive" : "Update verification",
      actionUrl,
    ),
    idempotencyKey: `verification-decision:${input.status}:${input.userId}:${approved ? "approved" : reason}`,
  });
};

/** Sends an administrator's response to a public (non-account) inquiry. */
export const sendGuestInquiryReplyEmail = async (input: {
  to: string;
  name: string | null;
  subject: string | null;
  reply: string;
  inquiryId: string;
  baseOrigin: string;
}) => {
  const actionUrl = getAppLink(input.baseOrigin, "/contact");
  const subject = input.subject?.trim() || "your inquiry";
  const intro = `A SafeDrive support agent replied to your inquiry about ${subject}.`;
  return sendTransactionalEmail({
    to: input.to,
    subject: `SafeDrive response: ${subject}`,
    text: `Hello ${input.name?.trim() || "there"},\n\n${input.reply}\n\nNeed more help? Contact SafeDrive: ${actionUrl}\n\nSafeDrive Support`,
    html: messagePage(
      "SafeDrive support response",
      intro,
      input.reply,
      "Contact SafeDrive",
      actionUrl,
    ),
    idempotencyKey: `guest-inquiry-reply:${input.inquiryId}`,
  });
};

/** Sends a return-due/overdue reminder to one booking participant. */
export const sendReturnReminderEmail = async (input: {
  to: string;
  name: string | null;
  title: string;
  body: string;
  vehicle: string;
  deadline: string;
  link: string;
  baseOrigin: string;
  eventKey: string;
}) => {
  const actionUrl = getAppLink(input.baseOrigin, input.link);
  return sendTransactionalEmail({
    to: input.to,
    subject: input.title,
    text: `Hello ${input.name || "there"},\n\n${input.body}\n\nVehicle: ${input.vehicle}\nReturn deadline: ${input.deadline}\n\nOpen SafeDrive and complete the return steps after handoff: ${actionUrl}\n\nSafeDrive`,
    html: page(
      input.title,
      input.body,
      [["Vehicle", input.vehicle], ["Return deadline", input.deadline]],
      "Open booking",
      actionUrl,
    ),
    idempotencyKey: `return-reminder:${input.eventKey}`,
  });
};

/** Reusable server-side account notification for approved workflow events. */
export const sendUserNotificationEmail = async (
  supabase: ServiceRoleSupabaseClient,
  input: {
    userId: string;
    title: string;
    message: string;
    link: string;
    baseOrigin: string;
    eventKey: string;
  },
) => {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", input.userId)
    .single();
  if (error || !profile) return { state: "failed" as const, reason: "Notification recipient could not be loaded" };
  const recipient = profile as RecipientProfile;
  const actionUrl = getAppLink(input.baseOrigin, input.link);
  return sendTransactionalEmail({
    to: recipient.email,
    subject: `SafeDrive: ${input.title}`,
    text: `Hello ${recipient.full_name || "there"},\n\n${input.message}\n\nOpen SafeDrive: ${actionUrl}\n\nSafeDrive`,
    html: page(input.title, input.message, [], "Open SafeDrive", actionUrl),
    idempotencyKey: `notification-email:${input.eventKey}:${input.userId}`,
  });
};
