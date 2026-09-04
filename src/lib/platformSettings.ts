import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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

const clampWholeHours = (
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
};

export const fetchPlatformPolicyTimings = async (): Promise<PlatformPolicyTimings> => {
  const fallback: PlatformPolicyTimings = {
    arrivalCheckinLeadHours: DEFAULT_ARRIVAL_CHECKIN_LEAD_HOURS,
    listerCompletionTimeoutHours: DEFAULT_LISTER_COMPLETION_TIMEOUT_HOURS,
  };

  const { data, error } = await supabase
    .from("platform_settings")
    .select(
      "arrival_checkin_lead_hours, lister_completion_timeout_hours",
    )
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.error("Failed to load platform policy timings:", error);
    return fallback;
  }

  return {
    arrivalCheckinLeadHours: clampWholeHours(
      data?.arrival_checkin_lead_hours,
      0,
      48,
      DEFAULT_ARRIVAL_CHECKIN_LEAD_HOURS,
    ),
    listerCompletionTimeoutHours: clampWholeHours(
      data?.lister_completion_timeout_hours,
      1,
      72,
      DEFAULT_LISTER_COMPLETION_TIMEOUT_HOURS,
    ),
  };
};

export type PlatformPricingSettings = {
  commissionRate: number;
  processingFeeRate: number;
  processingFixedCentavos: number;
  downpaymentRate: number;
  refundFullHours: number;
  refundLateRenterPercent: number;
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
  };

  const { data, error } = await supabase
    .from("platform_settings")
    .select(
      "commission_rate, payment_processing_fee_rate, payment_processing_fixed_centavos, downpayment_rate, refund_full_hours, refund_late_renter_percent",
    )
    .eq("id", "default")
    .maybeSingle();

  if (error) {
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
