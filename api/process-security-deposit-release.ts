import { createClient } from "@supabase/supabase-js";
import { finalizeSecurityDepositRelease } from "./lib/securityDeposit";

export const config = { runtime: "edge" };
const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async function handler(req: Request) {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const paymongoKey = process.env.PAYMONGO_SECRET_KEY;
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!url || !serviceKey || !paymongoKey) throw new Error("Security deposit release is not configured");
    if (!token) return respond({ error: "Unauthorized" }, 401);
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return respond({ error: "Unauthorized" }, 401);
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "super_admin") return respond({ error: "Super admin required" }, 403);

    const { depositId } = (await req.json()) as { depositId?: string };
    if (!depositId) return respond({ error: "Deposit ID is required" }, 400);
    const { data: deposit, error: depositError } = await supabase.from("security_deposits").select("*").eq("id", depositId).single();
    if (depositError || !deposit) return respond({ error: "Security deposit not found" }, 404);
    if (["released", "partially_released", "claimed"].includes(deposit.status)) return respond({ success: true, status: deposit.status, alreadyFinalized: true });

    const { data: unresolvedClaims } = await supabase.from("security_deposit_claims").select("id").eq("security_deposit_id", deposit.id).in("status", ["submitted", "renter_responded"]);
    if ((unresolvedClaims ?? []).length > 0) return respond({ error: "Decide every open claim before releasing the deposit" }, 409);
    if (deposit.status === "return_review" && deposit.claim_deadline && new Date(deposit.claim_deadline).getTime() > Date.now()) return respond({ error: "The 48-hour lister claim window is still open" }, 409);
    if (deposit.status === "return_review") await supabase.from("security_deposits").update({ status: "no_claim" }).eq("id", deposit.id).eq("status", "return_review");

    const { data: approvedClaims } = await supabase.from("security_deposit_claims").select("approved_amount_centavos").eq("security_deposit_id", deposit.id).in("status", ["approved", "partially_approved"]);
    const approved = Math.min(Number(deposit.amount_centavos), (approvedClaims ?? []).reduce((sum, claim) => sum + Number(claim.approved_amount_centavos || 0), 0));
    const refundable = Math.max(0, Number(deposit.amount_centavos) - approved);
    if (refundable === 0) {
      const finalized = await finalizeSecurityDepositRelease(supabase, { depositId: deposit.id, actorId: user.id, baseOrigin: new URL(req.url).origin });
      return respond({ success: true, ...finalized });
    }
    if (!String(deposit.provider_payment_id || "").startsWith("pay_")) return respond({ error: "The original PayMongo Payment ID is missing. Run reconciliation before attempting a refund." }, 409);

    if (deposit.status === "refund_pending" && deposit.provider_refund_id) {
      const check = await fetch(`https://api.paymongo.com/v1/refunds/${deposit.provider_refund_id}`, { headers: { Accept: "application/json", Authorization: `Basic ${btoa(`${paymongoKey}:`)}` } });
      const checked = await check.json();
      const status = checked?.data?.attributes?.status as string | undefined;
      if (!check.ok) return respond({ error: "PayMongo refund status could not be checked", details: checked }, 502);
      if (status === "succeeded") return respond({ success: true, ...(await finalizeSecurityDepositRelease(supabase, { depositId: deposit.id, providerRefundId: deposit.provider_refund_id, actorId: user.id, baseOrigin: new URL(req.url).origin })) });
      if (status === "failed") await supabase.from("security_deposits").update({ status: "failed" }).eq("id", deposit.id).eq("status", "refund_pending");
      return respond({ success: status !== "failed", status: status || "pending", providerRefundId: deposit.provider_refund_id }, status === "failed" ? 409 : 202);
    }

    const providerResponse = await fetch("https://api.paymongo.com/v1/refunds", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${btoa(`${paymongoKey}:`)}`, "Idempotency-Key": `safedrive-deposit-refund-${deposit.id}` },
      body: JSON.stringify({ data: { attributes: { amount: refundable, payment_id: deposit.provider_payment_id, reason: "others", notes: `SafeDrive refundable security deposit release for booking ${deposit.booking_id}` } } }),
    });
    const providerData = await providerResponse.json();
    if (!providerResponse.ok) return respond({ error: "PayMongo did not accept the deposit refund", details: providerData }, 502);
    const refundId = providerData?.data?.id as string | undefined;
    const refundStatus = providerData?.data?.attributes?.status as string | undefined;
    if (!refundId) return respond({ error: "PayMongo returned an incomplete refund" }, 502);
    await supabase.from("security_deposits").update({ status: "refund_pending", provider_refund_id: refundId }).eq("id", deposit.id).in("status", ["no_claim", "deduction_approved", "failed"]);
    await supabase.from("audit_log").insert({ user_id: user.id, action: "security_deposit_refund_requested", entity_type: "security_deposit", entity_id: deposit.id, details: { booking_id: deposit.booking_id, refund_id: refundId, refund_status: refundStatus, refunded_centavos: refundable, approved_deduction_centavos: approved } });
    if (refundStatus === "succeeded") return respond({ success: true, ...(await finalizeSecurityDepositRelease(supabase, { depositId: deposit.id, providerRefundId: refundId, actorId: user.id, baseOrigin: new URL(req.url).origin })) });
    return respond({ success: true, status: refundStatus || "pending", providerRefundId: refundId }, 202);
  } catch (error) {
    console.error("Security deposit release failed", error);
    return respond({ error: error instanceof Error ? error.message : "Security deposit release failed" }, 500);
  }
}
