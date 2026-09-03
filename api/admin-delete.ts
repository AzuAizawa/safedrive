import { createClient } from "@supabase/supabase-js";

export const config = {
  runtime: "edge",
};

type DeleteAdminPayload = {
  targetUserId?: string;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin environment variables");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

const getBearerToken = (req: Request) => {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice("bearer ".length).trim();
};

/**
 * Permanently delete a `role='admin'` account (super-admin only).
 *
 * "Disable" is the day-to-day tool. This is for an admin who is truly gone.
 * Before the delete we write an `admin_account_deleted` audit row that names
 * the person and who removed them; their past audit rows then survive with a
 * NULL actor (Chapter 25) and show as "Former staff".
 *
 * Refused when the account also has rental activity (cars or bookings) - those
 * cascade-delete and would take real records with them; disable it instead.
 */
export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization token" }, 401);

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: requester } = await supabase
      .from("profiles")
      .select("role, deleted_at")
      .eq("id", user.id)
      .single();
    if (!requester || requester.role !== "super_admin" || requester.deleted_at) {
      return jsonResponse({ error: "Super admin access required" }, 403);
    }

    const payload = (await req.json().catch(() => ({}))) as DeleteAdminPayload;
    const targetId = String(payload.targetUserId ?? "").trim();
    if (!targetId) {
      return jsonResponse({ error: "Target admin is required" }, 400);
    }
    if (targetId === user.id) {
      return jsonResponse({ error: "You cannot delete your own account" }, 400);
    }

    const { data: target } = await supabase
      .from("profiles")
      .select("id, role, email, full_name")
      .eq("id", targetId)
      .single();
    if (!target) {
      return jsonResponse({ error: "Account not found" }, 404);
    }
    if (target.role !== "admin") {
      return jsonResponse(
        { error: "Only a plain admin account can be deleted here" },
        400,
      );
    }

    // Rental activity cascade-deletes; refuse and let the caller disable instead.
    const [{ count: carCount }, { count: bookingRenterCount }, { count: bookingOwnerCount }] =
      await Promise.all([
        supabase.from("cars").select("id", { count: "exact", head: true }).eq("owner_id", targetId),
        supabase.from("bookings").select("id", { count: "exact", head: true }).eq("renter_id", targetId),
        supabase.from("bookings").select("id", { count: "exact", head: true }).eq("owner_id", targetId),
      ]);
    if ((carCount ?? 0) + (bookingRenterCount ?? 0) + (bookingOwnerCount ?? 0) > 0) {
      return jsonResponse(
        {
          error:
            "This account also has rental activity (cars or bookings). Disable it instead of deleting.",
        },
        409,
      );
    }

    // Name the person and the actor before the row goes away.
    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "admin_account_deleted",
      entity_type: "profile",
      entity_id: targetId,
      details: {
        admin_email: target.email,
        admin_name: target.full_name,
      },
    });

    const { error: deleteError } = await supabase.auth.admin.deleteUser(targetId);
    if (deleteError) {
      return jsonResponse(
        { error: `Account could not be deleted: ${deleteError.message}` },
        500,
      );
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("admin-delete failed", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Admin deletion failed" },
      500,
    );
  }
}
