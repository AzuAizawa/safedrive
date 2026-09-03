import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "edge" };
const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const allowedTypes = new Set(["access", "correction", "deletion", "anonymization", "restriction"]);
const withdrawableStatuses = ["submitted", "identity_check", "under_review"];

export default async function handler(req: Request) {
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) return respond({ error: "Method not allowed" }, 405);
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
    const key = serviceKey || anonKey;
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!url || !key) return respond({ error: "The privacy-request service is not configured on this deployment" }, 503);
    if (!token) return respond({ error: "Unauthorized" }, 401);
    const supabase = createClient(url, key, serviceKey
      ? { auth: { persistSession: false, autoRefreshToken: false } }
      : {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user?.email) return respond({ error: "Unauthorized" }, 401);
    if (req.method === 'GET') {
      const { data, error } = await supabase.from("data_retention_requests").select("id, request_type, status, request_details, decision_reason, legal_hold_reason, due_at, completed_at, created_at, updated_at").eq("subject_user_id", user.id).order("created_at", { ascending: false });
      if (error) throw error;
      return respond({ requests: data ?? [] });
    }
    if (req.method === 'PATCH') {
      const body = (await req.json().catch(() => ({}))) as { requestId?: string; action?: string };
      const requestId = String(body.requestId || "").trim();
      if (body.action !== "withdraw" || !requestId) {
        return respond({ error: "Provide a requestId and action: 'withdraw'" }, 400);
      }
      if (!serviceKey) {
        const { data, error } = await supabase.rpc("withdraw_data_retention_request", {
          p_request_id: requestId,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        return respond({ success: true, request: row });
      }
      const { data: existing, error: findError } = await supabase
        .from("data_retention_requests")
        .select("id, status, request_type, requester_email, subject_user_id")
        .eq("id", requestId)
        .maybeSingle();
      if (findError) throw findError;
      if (!existing || existing.subject_user_id !== user.id) {
        return respond({ error: "Request not found" }, 404);
      }
      if (!withdrawableStatuses.includes(existing.status)) {
        return respond({ error: `This request can no longer be withdrawn (status: ${existing.status})` }, 409);
      }
      const { error: updateError } = await supabase
        .from("data_retention_requests")
        .update({
          status: "cancelled",
          decision_reason: `Withdrawn by the requester on ${new Date().toISOString().slice(0, 16).replace("T", " ")}.`,
        })
        .eq("id", requestId)
        .eq("subject_user_id", user.id)
        .in("status", withdrawableStatuses);
      if (updateError) throw updateError;
      const { data: superAdmins } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "super_admin")
        .is("deleted_at", null);
      if (superAdmins?.length) {
        await supabase.from("notifications").insert(
          superAdmins.map((admin) => ({
            user_id: admin.id,
            title: "Privacy Request Withdrawn",
            message: `${existing.requester_email} withdrew their ${existing.request_type} request.`,
            type: "info",
            link: `/admin/retention-requests?request=${requestId}`,
          })),
        );
      }
      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "data_retention_request_withdrawn",
        entity_type: "data_retention_request",
        entity_id: requestId,
        details: { request_type: existing.request_type, previous_status: existing.status },
      });
      return respond({ success: true, request: { id: requestId, status: "cancelled" } });
    }

    const payload = (await req.json()) as { requestType?: string; details?: string };
    const requestType = String(payload.requestType || "").trim();
    const details = String(payload.details || "").trim();
    if (!allowedTypes.has(requestType) || details.length < 10 || details.length > 3000) return respond({ error: "Choose a valid request type and provide 10 to 3,000 characters of detail" }, 400);
    if (!serviceKey) {
      const { data, error } = await supabase.rpc("submit_data_retention_request", {
        p_request_type: requestType,
        p_details: details,
      });
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      if (!created) throw new Error("Request was not recorded");
      return respond({ success: true, request: created }, 201);
    }

    const { count } = await supabase.from("data_retention_requests").select("id", { count: "exact", head: true }).eq("subject_user_id", user.id).eq("request_type", requestType).in("status", ["submitted", "identity_check", "under_review", "approved", "legal_hold"]);
    if ((count ?? 0) > 0) return respond({ error: "You already have an open request of this type" }, 409);
    const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: created, error } = await supabase.from("data_retention_requests").insert({ subject_user_id: user.id, requester_email: user.email.toLowerCase(), request_type: requestType, request_details: details, due_at: dueAt }).select("id, status, due_at").single();
    if (error || !created) throw error || new Error("Request was not recorded");
    const { data: admins } = await supabase.from("profiles").select("id").eq("role", "super_admin").is("deleted_at", null);
    if (admins?.length) await supabase.from("notifications").insert(admins.map((admin) => ({ user_id: admin.id, title: "New Privacy Data Request", message: `${user.email} submitted a ${requestType} request. Verify identity and review legal or operational holds before acting.`, type: "warning", link: `/admin/retention-requests?request=${created.id}` })));
    await supabase.from("audit_log").insert({ user_id: user.id, action: "data_retention_request_submitted", entity_type: "data_retention_request", entity_id: created.id, details: { request_type: requestType, due_at: dueAt } });
    return respond({ success: true, request: created }, 201);
  } catch (error) {
    console.error("Data request failed", error);
    return respond({ error: error instanceof Error ? error.message : "Data request failed" }, 500);
  }
}
