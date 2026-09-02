import { supabase } from "@/lib/supabase";
import type { Subscription } from "@/types/database";

export type ActiveSubscriptionSummary = Pick<
  Subscription,
  "id" | "plan_type" | "additional_slots" | "status" | "start_date" | "end_date"
>;

const todayString = () => new Date().toISOString().slice(0, 10);

export const calculateSubscriptionEndDate = (startDate = new Date()) => {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 30);
  return endDate.toISOString().slice(0, 10);
};

export const getCurrentSubscription = async (
  userId: string,
): Promise<ActiveSubscriptionSummary | null> => {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, plan_type, additional_slots, status, start_date, end_date")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  if (data.end_date && data.end_date < todayString()) {
    const { error: expireError } = await supabase
      .from("subscriptions")
      .update({ status: "expired" })
      .eq("id", data.id)
      .eq("status", "active");

    if (expireError) {
      console.error("Failed to expire subscription", expireError);
    }

    return null;
  }

  return data;
};
