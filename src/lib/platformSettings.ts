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

export type PlatformPricingSettings = {
  commissionRate: number;
  processingFeeRate: number;
  processingFixedCentavos: number;
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
  const { data, error } = await supabase
    .from("platform_settings")
    .select("commission_rate, payment_processing_fee_rate, payment_processing_fixed_centavos")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.error("Failed to load platform pricing settings:", error);
    return { commissionRate: DEFAULT_COMMISSION_RATE, processingFeeRate: 0, processingFixedCentavos: 0 };
  }

  return {
    commissionRate: normalizeCommissionRate(data?.commission_rate),
    processingFeeRate: Math.min(0.25, Math.max(0, Number(data?.payment_processing_fee_rate) || 0)),
    processingFixedCentavos: Math.max(0, Math.round(Number(data?.payment_processing_fixed_centavos) || 0)),
  };
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
