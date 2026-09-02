import { createClient } from "@supabase/supabase-js";
import { runSecurityDepositRelease } from "./lib/securityDeposit";

export const config = { runtime: "edge" };
const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

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

    const result = await runSecurityDepositRelease(supabase, {
      depositId,
      actorId: user.id,
      baseOrigin: new URL(req.url).origin,
      enforceClaimWindow: true,
    });

    if (result.state === "blocked") return respond({ error: result.reason }, 409);
    if (result.state === "refund_pending") {
      return respond(
        { success: true, status: "pending", providerRefundId: result.providerRefundId ?? null },
        202,
      );
    }
    return respond({ success: true, state: result.state, status: result.status ?? null });
  } catch (error) {
    console.error("Security deposit release failed", error);
    return respond({ error: error instanceof Error ? error.message : "Security deposit release failed" }, 500);
  }
}
