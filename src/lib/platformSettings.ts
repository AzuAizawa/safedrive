import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_MIN_BOOKING_NOTICE_HOURS,
  normalizeBookingNoticeHours,
} from "@/lib/bookingNotice";
import {
  DEFAULT_LATE_CANCEL_FEE_DAYS,
  DEFAULT_NO_SHOW_FEE_DAYS,
  DEFAULT_SHORT_NOTICE_FREE_HOURS,
  DEFAULT_SHORT_TRIP_LATE_CANCEL_FEE_DAYS,
  DEFAULT_SHORT_TRIP_NO_SHOW_FEE_DAYS,
} from "@/lib/cancellationPolicy";

// A stored setting inside its bounds, else the published default. An empty
// value is "not set", never 0 - 0 is a valid fee.
const readBoundedSetting = (value: unknown, min: number, max: number, fallback: number) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

export const DEFAULT_COMMISSION_RATE = 0.1;
export const DEFAULT_COMMISSION_PERCENT = DEFAULT_COMMISSION_RATE * 100;

export const normalizeCommissionRate = (
  value: unknown,
  fallback = DEFAULT_COMMISSION_RATE,
) => {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    return fallback;
  }

  return rate;
};

export const commissionRateToPercent = (rate: number) =>
  Number((normalizeCommissionRate(rate) * 100).toFixed(2));

export const commissionPercentToRate = (percent: unknown) => {
  const parsed = Number(percent);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return null;
  }

  return parsed / 100;
};

export const calculateCommissionAmount = (
  baseAmount: number,
  commissionRate: number,
) => baseAmount * normalizeCommissionRate(commissionRate);

export const DEFAULT_DOWNPAYMENT_RATE = 0.5;
export const DOWNPAYMENT_RATE_MIN = 0.2;
export const DOWNPAYMENT_RATE_MAX = 1;
export const DEFAULT_REFUND_FULL_HOURS = 24;
export const DEFAULT_REFUND_LATE_RENTER_PERCENT = 50;

export const normalizeDownpaymentRate = (
  value: unknown,
  fallback = DEFAULT_DOWNPAYMENT_RATE,
) => {
  const rate = Number(value);
  if (
    !Number.isFinite(rate) ||
    rate < DOWNPAYMENT_RATE_MIN ||
    rate > DOWNPAYMENT_RATE_MAX
  ) {
    return fallback;
  }
  return rate;
};

// Operational lifecycle timings. Read live (never snapshotted per booking).
export const DEFAULT_ARRIVAL_CHECKIN_LEAD_HOURS = 3;
export const DEFAULT_LISTER_COMPLETION_TIMEOUT_HOURS = 18;

// How long someone waits at the meetup, past the agreed time, before they may
// report the other side and claim a refund (CHAPTER 68). This is the ONLY
// default in the client - every gate takes the loaded value as a required
// argument rather than reaching for a constant of its own, because the number
// that decides when the button APPEARS has to agree with the one the server
// uses to decide whether the click is ACCEPTED. See the note on
// NO_SHOW_GRACE_WINDOW_MINUTES in src/lib/bookingLifecycle.ts.
export const DEFAULT_NO_SHOW_GRACE_MINUTES = 30;
export const NO_SHOW_GRACE_MINUTES_MIN = 15;
export const NO_SHOW_GRACE_MINUTES_MAX = 180;

// Hours after the pickup time before SafeDrive cancels a paid booking that
// neither side checked in for (CHAPTER 92). Read live.
export const DEFAULT_MUTUAL_NO_SHOW_CLOSE_HOURS = 6;

const clampWholeNumber = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return Math.round(parsed);
};

export type PlatformPolicyTimings = {
  arrivalCheckinLeadHours: number;
  listerCompletionTimeoutHours: number;
  noShowGraceMinutes: number;
  mutualNoShowCloseHours: number;
};

export const fetchPlatformPolicyTimings = async (): Promise<PlatformPolicyTimings> => {
  const fallback: PlatformPolicyTimings = {
    arrivalCheckinLeadHours: DEFAULT_ARRIVAL_CHECKIN_LEAD_HOURS,
    listerCompletionTimeoutHours: DEFAULT_LISTER_COMPLETION_TIMEOUT_HOURS,
    noShowGraceMinutes: DEFAULT_NO_SHOW_GRACE_MINUTES,
    mutualNoShowCloseHours: DEFAULT_MUTUAL_NO_SHOW_CLOSE_HOURS,
  };

  const { data, error } = await supabase
    .from("platform_settings")
    .select(
      "arrival_checkin_lead_hours, lister_completion_timeout_hours, no_show_grace_minutes, mutual_no_show_close_hours",
    )
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.error("Failed to load platform policy timings:", error);
    return fallback;
  }

  return {
    arrivalCheckinLeadHours: clampWholeNumber(
      data?.arrival_checkin_lead_hours,
      0,
      48,
      DEFAULT_ARRIVAL_CHECKIN_LEAD_HOURS,
    ),
    listerCompletionTimeoutHours: clampWholeNumber(
      data?.lister_completion_timeout_hours,
      1,
      72,
      DEFAULT_LISTER_COMPLETION_TIMEOUT_HOURS,
    ),
    noShowGraceMinutes: clampWholeNumber(
      data?.no_show_grace_minutes,
      NO_SHOW_GRACE_MINUTES_MIN,
      NO_SHOW_GRACE_MINUTES_MAX,
      DEFAULT_NO_SHOW_GRACE_MINUTES,
    ),
    mutualNoShowCloseHours: clampWholeNumber(
      data?.mutual_no_show_close_hours,
      1,
      72,
      DEFAULT_MUTUAL_NO_SHOW_CLOSE_HOURS,
    ),
  };
};

// Dormant-account threshold (Chapter 58). Days of no login activity
// (profiles.active_session_started_at, falling back to created_at) before
// an account is auto-flagged into the existing data-retention review queue
// - a super admin still has to approve and execute the anonymization.
export const DEFAULT_DORMANT_ACCOUNT_DAYS = 365;

export const fetchDormantAccountDays = async (): Promise<number> => {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("dormant_account_days")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.error("Failed to load dormant-account threshold:", error);
    return DEFAULT_DORMANT_ACCOUNT_DAYS;
  }

  const days = Number(data?.dormant_account_days);
  return Number.isFinite(days) && days >= 90 && days <= 3650
    ? Math.round(days)
    : DEFAULT_DORMANT_ACCOUNT_DAYS;
};

export type PlatformPricingSettings = {
  commissionRate: number;
  processingFeeRate: number;
  processingFixedCentavos: number;
  downpaymentRate: number;
  refundFullHours: number;
  refundLateRenterPercent: number;
  // Hours a pickup must be away when the request is sent (CHAPTER 93).
  minBookingNoticeHours: number;
  // The cancellation terms a new booking would be snapshotted with (CHAPTER 91).
  shortNoticeFreeHours: number;
  lateCancelFeeDays: number;
  shortTripLateCancelFeeDays: number;
  noShowFeeDays: number;
  shortTripNoShowFeeDays: number;
  // "fallback" when the settings could not be read and every value above is a
  // default - a page quoting fees should not present those as the real ones.
  source: "live" | "fallback";
};

export const calculateProcessingFee = (
  subtotal: number,
  processingFeeRate: number,
  processingFixedCentavos: number,
) => {
  const rate = Math.min(0.25, Math.max(0, Number(processingFeeRate) || 0));
  const fixedPesos = Math.max(0, Number(processingFixedCentavos) || 0) / 100;
  const grossTotal = (subtotal + fixedPesos) / (1 - rate);
  return Math.max(0, Math.round((grossTotal - subtotal) * 100) / 100);
};

export const fetchPlatformPricingSettings = async (): Promise<PlatformPricingSettings> => {
  const fallback: PlatformPricingSettings = {
    commissionRate: DEFAULT_COMMISSION_RATE,
    processingFeeRate: 0,
    processingFixedCentavos: 0,
    downpaymentRate: DEFAULT_DOWNPAYMENT_RATE,
    refundFullHours: DEFAULT_REFUND_FULL_HOURS,
    refundLateRenterPercent: DEFAULT_REFUND_LATE_RENTER_PERCENT,
    minBookingNoticeHours: DEFAULT_MIN_BOOKING_NOTICE_HOURS,
    shortNoticeFreeHours: DEFAULT_SHORT_NOTICE_FREE_HOURS,
    lateCancelFeeDays: DEFAULT_LATE_CANCEL_FEE_DAYS,
    shortTripLateCancelFeeDays: DEFAULT_SHORT_TRIP_LATE_CANCEL_FEE_DAYS,
    noShowFeeDays: DEFAULT_NO_SHOW_FEE_DAYS,
    shortTripNoShowFeeDays: DEFAULT_SHORT_TRIP_NO_SHOW_FEE_DAYS,
    source: "fallback",
  };

  const { data, error } = await supabase
    .from("platform_settings")
    .select(
      "commission_rate, payment_processing_fee_rate, payment_processing_fixed_centavos, downpayment_rate, refund_full_hours, refund_late_renter_percent, min_booking_notice_hours, short_notice_free_hours, late_cancel_fee_days, short_trip_late_cancel_fee_days, no_show_fee_days, short_trip_no_show_fee_days",
    )
    .eq("id", "default")
    .maybeSingle();

  if (error || !data) {
    console.error("Failed to load platform pricing settings:", error);
    return fallback;
  }

  const refundHours = Number(data?.refund_full_hours);
  const latePercent = Number(data?.refund_late_renter_percent);

  return {
    commissionRate: normalizeCommissionRate(data?.commission_rate),
    processingFeeRate: Math.min(0.25, Math.max(0, Number(data?.payment_processing_fee_rate) || 0)),
    processingFixedCentavos: Math.max(0, Math.round(Number(data?.payment_processing_fixed_centavos) || 0)),
    downpaymentRate: normalizeDownpaymentRate(data?.downpayment_rate),
    refundFullHours:
      Number.isFinite(refundHours) && refundHours >= 0 && refundHours <= 720
        ? Math.round(refundHours)
        : DEFAULT_REFUND_FULL_HOURS,
    refundLateRenterPercent:
      Number.isFinite(latePercent) && latePercent >= 0 && latePercent <= 100
        ? latePercent
        : DEFAULT_REFUND_LATE_RENTER_PERCENT,
    minBookingNoticeHours: normalizeBookingNoticeHours(data?.min_booking_notice_hours),
    shortNoticeFreeHours: Math.round(
      readBoundedSetting(data?.short_notice_free_hours, 0, 24, DEFAULT_SHORT_NOTICE_FREE_HOURS),
    ),
    lateCancelFeeDays: readBoundedSetting(data?.late_cancel_fee_days, 0, 30, DEFAULT_LATE_CANCEL_FEE_DAYS),
    shortTripLateCancelFeeDays: readBoundedSetting(
      data?.short_trip_late_cancel_fee_days,
      0,
      2,
      DEFAULT_SHORT_TRIP_LATE_CANCEL_FEE_DAYS,
    ),
    noShowFeeDays: readBoundedSetting(data?.no_show_fee_days, 0, 30, DEFAULT_NO_SHOW_FEE_DAYS),
    shortTripNoShowFeeDays: readBoundedSetting(
      data?.short_trip_no_show_fee_days,
      0,
      2,
      DEFAULT_SHORT_TRIP_NO_SHOW_FEE_DAYS,
    ),
    source: "live",
  };
};

// Public-facing contact address shown in Terms, Privacy Policy, auth pages, etc.
// Super-admin editable (direct edit, no consensus vote - it is contact info, not
// a policy number). Read live so a change propagates without a redeploy.
export const DEFAULT_CONTACT_EMAIL = "admin.no.reply.360@gmail.com";

const isEmailShaped = (value: unknown): value is string =>
  typeof value === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());

export const fetchPlatformContactEmail = async (): Promise<string> => {
  try {
    const { data, error } = await supabase.rpc("get_platform_contact_email");
    if (error) throw error;
    return isEmailShaped(data) ? data.trim().toLowerCase() : DEFAULT_CONTACT_EMAIL;
  } catch (error) {
    console.error("Failed to load platform contact email:", error);
    return DEFAULT_CONTACT_EMAIL;
  }
};

/**
 * Live platform contact email for display in Terms, Privacy Policy, and the auth
 * pages. Falls back to {@link DEFAULT_CONTACT_EMAIL} until the value loads or if
 * the lookup fails, so the UI never shows a blank address.
 */
export const usePlatformContactEmail = (): string => {
  const [email, setEmail] = useState(DEFAULT_CONTACT_EMAIL);
  useEffect(() => {
    let active = true;
    void fetchPlatformContactEmail().then((value) => {
      if (active) setEmail(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return email;
};

// "How long does verification take" wording. Super-admin editable (direct edit,
// no consensus vote - display text, not a policy number) so it can be bumped
// during a peak season without a redeploy. Read live.
export const DEFAULT_USER_VERIFICATION_ETA =
  "Most identity reviews finish within 24 hours. Complex cases may take 1 to 3 business days.";
export const DEFAULT_VEHICLE_VERIFICATION_ETA =
  "Most vehicle reviews finish within 24 hours. Complex cases may take 1 to 3 business days.";

export type VerificationEtaMessages = {
  userMessage: string;
  vehicleMessage: string;
};

export const fetchVerificationEtaMessages =
  async (): Promise<VerificationEtaMessages> => {
    const fallback: VerificationEtaMessages = {
      userMessage: DEFAULT_USER_VERIFICATION_ETA,
      vehicleMessage: DEFAULT_VEHICLE_VERIFICATION_ETA,
    };
    try {
      const { data, error } = await supabase.rpc("get_verification_eta_messages");
      if (error) throw error;
      const row = (data ?? {}) as {
        user_message?: string;
        vehicle_message?: string;
      };
      return {
        userMessage:
          typeof row.user_message === "string" && row.user_message.trim()
            ? row.user_message.trim()
            : fallback.userMessage,
        vehicleMessage:
          typeof row.vehicle_message === "string" && row.vehicle_message.trim()
            ? row.vehicle_message.trim()
            : fallback.vehicleMessage,
      };
    } catch (error) {
      console.error("Failed to load verification ETA messages:", error);
      return fallback;
    }
  };

/**
 * Live verification ETA messages, with the hard-coded defaults until the value
 * loads or if the lookup fails - the UI never shows a blank ETA.
 */
export const useVerificationEtaMessages = (): VerificationEtaMessages => {
  const [messages, setMessages] = useState<VerificationEtaMessages>({
    userMessage: DEFAULT_USER_VERIFICATION_ETA,
    vehicleMessage: DEFAULT_VEHICLE_VERIFICATION_ETA,
  });
  useEffect(() => {
    let active = true;
    void fetchVerificationEtaMessages().then((value) => {
      if (active) setMessages(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return messages;
};

export const fetchPlatformCommissionRate = async () => {
  const settings = await fetchPlatformPricingSettings();
  return settings.commissionRate;
};

export const formatCommissionPercent = (rate: number) => {
  const percent = commissionRateToPercent(rate);
  const rounded = Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1);
  return `${rounded}%`;
};

// CHAPTER 104. How long an identity review may sit before an admin should see
// it as late. Defaulted to 24 to match the ETA sentence shown to the person
// waiting - an internal alarm that disagrees with the public promise is worse
// than no alarm.
export const DEFAULT_VERIFICATION_REVIEW_TARGET_HOURS = 24;

export const fetchVerificationReviewTargetHours = async (): Promise<number> => {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("verification_review_target_hours")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.error("Failed to load verification review target:", error);
    return DEFAULT_VERIFICATION_REVIEW_TARGET_HOURS;
  }

  const hours = Number(data?.verification_review_target_hours);
  return Number.isFinite(hours) && hours >= 1 && hours <= 720
    ? Math.round(hours)
    : DEFAULT_VERIFICATION_REVIEW_TARGET_HOURS;
};

/** "4 hours" / "2 days" - the wait as a person would say it. */
export const describeWaitingSince = (submittedAt: string | null, now: number = Date.now()) => {
  if (!submittedAt) return null;
  const startedMs = new Date(submittedAt).getTime();
  if (!Number.isFinite(startedMs)) return null;
  const hours = Math.max(0, Math.floor((now - startedMs) / 3_600_000));
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
};

export const verificationWaitHours = (submittedAt: string | null, now: number = Date.now()) => {
  if (!submittedAt) return null;
  const startedMs = new Date(submittedAt).getTime();
  if (!Number.isFinite(startedMs)) return null;
  return Math.max(0, (now - startedMs) / 3_600_000);
};
