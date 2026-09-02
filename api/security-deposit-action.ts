import { createClient } from "@supabase/supabase-js";
import { runSecurityDepositRelease } from "./lib/securityDeposit";

export const config = { runtime: "edge" };
const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async function handler(req: Request) {
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!url || !key) throw new Error("Security deposit service is not configured");
    if (!token) return respond({ error: "Unauthorized" }, 401);
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return respond({ error: "Unauthorized" }, 401);
    const payload = (await req.json()) as { bookingId?: string; action?: string; amountCentavos?: number; reason?: string; response?: string; claimId?: string; approvedAmountCentavos?: number; decisionReason?: string };
    if (!payload.bookingId || !payload.action) return respond({ error: "Booking and action are required" }, 400);
    const [{ data: deposit, error: depositError }, { data: profile }] = await Promise.all([
      supabase.from("security_deposits").select("*").eq("booking_id", payload.bookingId).single(),
      supabase.from("profiles").select("role").eq("id", user.id).single(),
    ]);
    if (depositError || !deposit) return respond({ error: "Security deposit not found" }, 404);
    const isSuperAdmin = profile?.role === "super_admin";
    const isRenter = deposit.renter_id === user.id;
    const isLister = deposit.owner_id === user.id;
    if (!isSuperAdmin && !isRenter && !isLister) return respond({ error: "Not allowed" }, 403);

    if (payload.action === "lister_confirm_return") {
      if (!isLister || deposit.status !== "return_review") {
        return respond(
          { error: "Only the lister can confirm the return while the deposit is in review" },
          409,
        );
      }
      const { data: openClaims } = await supabase
        .from("security_deposit_claims")
        .select("id")
        .eq("security_deposit_id", deposit.id)
        .not("status", "in", "(rejected)");
      if ((openClaims ?? []).length > 0) {
        return respond(
          { error: "You already filed a deposit claim for this booking; it must be decided instead." },
          409,
        );
      }
      const result = await runSecurityDepositRelease(supabase, {
        depositId: deposit.id,
        actorId: user.id,
        baseOrigin: new URL(req.url).origin,
        enforceClaimWindow: false,
      });
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "security_deposit_lister_confirmed_return",
        entity_type: "security_deposit",
        entity_id: deposit.id,
        details: { booking_id: payload.bookingId, release_state: result.state },
      });
      if (result.state === "blocked") return respond({ error: result.reason }, 409);
      return respond({ success: true, state: result.state });
    }

    if (payload.action === "submit_claim") {
      const amount = Math.round(Number(payload.amountCentavos));
      const reason = String(payload.reason || "").trim();
      if (!isLister || deposit.status !== "return_review") return respond({ error: "A claim may only be submitted by the lister during return review" }, 409);
      if (!deposit.claim_deadline || new Date(deposit.claim_deadline).getTime() < Date.now()) return respond({ error: "The deposit claim window has ended" }, 409);
      if (!Number.isInteger(amount) || amount <= 0 || amount > Number(deposit.amount_centavos) || reason.length < 10) return respond({ error: "Enter a supported claim amount and at least 10 characters of explanation" }, 400);
      // To claim, the lister must have documented BOTH ends themselves: a
      // complete pickup ("before") report and a complete return ("after")
      // report. The return report is otherwise optional for the lister, but it
      // is the price of raising a damage claim.
      const claimRequired = ["front", "back", "odometer", "fuel_or_battery"];
      const isCompleteReport = (report: { evidence_waived?: boolean | null; trip_condition_photos?: Array<{ category: string }> | null } | null) => {
        if (!report || report.evidence_waived) return false;
        const cats = new Set((report.trip_condition_photos ?? []).map((p) => p.category));
        return claimRequired.every((c) => cats.has(c));
      };
      const { data: claimReports } = await supabase.from("trip_condition_reports").select("id, phase, submitted_at, evidence_waived, trip_condition_photos(category, storage_path, captured_at)").eq("booking_id", payload.bookingId).eq("reporter_id", user.id).in("phase", ["pickup", "return"]);
      const pickupReport = (claimReports ?? []).find((r) => r.phase === "pickup") ?? null;
      const returnReport = (claimReports ?? []).find((r) => r.phase === "return") ?? null;
      if (!pickupReport || !returnReport || !isCompleteReport(pickupReport) || !isCompleteReport(returnReport)) {
        return respond({ error: "A deposit claim needs your own complete pickup AND return condition reports (all required photos, not waived)." }, 409);
      }
      const evidence = { return_report_id: returnReport.id, submitted_at: returnReport.submitted_at, photos: returnReport.trip_condition_photos || [] };
      const { data: claim, error } = await supabase.from("security_deposit_claims").insert({ security_deposit_id: deposit.id, requested_by: user.id, amount_centavos: amount, reason, evidence }).select("id").single();
      if (error || !claim) throw error || new Error("Claim was not created");
      await supabase.from("security_deposits").update({ status: "claim_open" }).eq("id", deposit.id).eq("status", "return_review");
      await supabase.from("notifications").insert([{ user_id: deposit.renter_id, title: "Security Deposit Claim Submitted", message: "The lister submitted a documented deposit claim. Review and respond; no deduction is automatic.", type: "warning", link: `/security-deposit/${payload.bookingId}` }, { user_id: deposit.owner_id, title: "Deposit Claim Recorded", message: "Your claim is waiting for the renter response and super-admin review.", type: "info", link: `/security-deposit/${payload.bookingId}` }]);
      await supabase.from("audit_log").insert({ user_id: user.id, action: "security_deposit_claim_submitted", entity_type: "security_deposit_claim", entity_id: claim.id, details: { booking_id: payload.bookingId, amount_centavos: amount, reason } });
      return respond({ success: true, claimId: claim.id });
    }

    if (payload.action === "renter_response") {
      const response = String(payload.response || "").trim();
      if (!isRenter || !payload.claimId || response.length < 5) return respond({ error: "The renter and a meaningful response are required" }, 400);
      const { data: changed, error } = await supabase.from("security_deposit_claims").update({ renter_response: response, status: "renter_responded" }).eq("id", payload.claimId).eq("security_deposit_id", deposit.id).eq("status", "submitted").select("id").maybeSingle();
      if (error) throw error;
      if (!changed) return respond({ error: "This claim is no longer waiting for a renter response" }, 409);
      await supabase.from("audit_log").insert({ user_id: user.id, action: "security_deposit_claim_renter_response", entity_type: "security_deposit_claim", entity_id: payload.claimId, details: { booking_id: payload.bookingId } });
      return respond({ success: true });
    }

    if (payload.action === "decide_claim") {
      if (!isSuperAdmin || !payload.claimId) return respond({ error: "Super admin approval is required" }, 403);
      const reason = String(payload.decisionReason || "").trim();
      const approved = Math.max(0, Math.round(Number(payload.approvedAmountCentavos || 0)));
      const { data: claim, error: claimError } = await supabase.from("security_deposit_claims").select("id, amount_centavos, status").eq("id", payload.claimId).eq("security_deposit_id", deposit.id).single();
      if (claimError || !claim) return respond({ error: "Deposit claim not found" }, 404);
      if (!["submitted", "renter_responded"].includes(claim.status)) return respond({ error: "This claim has already been decided" }, 409);
      if (reason.length < 10 || approved > Number(claim.amount_centavos) || approved > Number(deposit.amount_centavos)) return respond({ error: "The approved amount cannot exceed the claim, and a detailed decision reason is required" }, 400);
      const status = approved === 0 ? "rejected" : approved < Number(claim.amount_centavos) ? "partially_approved" : "approved";
      const { data: changed, error } = await supabase.from("security_deposit_claims").update({ status, approved_amount_centavos: approved, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("id", payload.claimId).eq("security_deposit_id", deposit.id).in("status", ["submitted", "renter_responded"]).select("id").maybeSingle();
      if (error) throw error;
      if (!changed) return respond({ error: "This claim changed while it was being reviewed; refresh before deciding" }, 409);
      await supabase.from("security_deposits").update({ status: approved === 0 ? "no_claim" : "deduction_approved" }).eq("id", deposit.id);
      await supabase.from("audit_log").insert({ user_id: user.id, action: "security_deposit_claim_decided", entity_type: "security_deposit_claim", entity_id: payload.claimId, details: { booking_id: payload.bookingId, approved_amount_centavos: approved, decision_reason: reason } });
      return respond({ success: true, approvedAmountCentavos: approved });
    }
    return respond({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error("Security deposit action failed", error);
    return respond({ error: error instanceof Error ? error.message : "Security deposit action failed" }, 500);
  }
}
