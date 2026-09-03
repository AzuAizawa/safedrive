import { createSupabaseAdmin } from "./lib/payoutAutomation";

export const config = {
  runtime: "edge",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * Daily job: move any approved/active vehicle whose registration, CTPL, or
 * comprehensive-insurance date has passed into `renewal_required` and notify the
 * lister. The lister then resubmits documents at /car-renewals and an admin
 * reviews them at /admin/vehicle-renewals.
 *
 * Point the same scheduler that runs expire-booking-deadlines / send-return-
 * reminders at this endpoint (~once a day) with `Authorization: Bearer
 * <CRON_SECRET>`. If it is not scheduled, an admin can still flag a vehicle
 * manually from /admin/vehicle-renewals.
 */
export default async function handler(req: Request) {
  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return jsonResponse(
      { error: "CRON_SECRET must be configured before this job can run" },
      500,
    );
  }
  const bearer = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (bearer !== cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.rpc("flag_vehicles_needing_renewal");
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }
    return jsonResponse({ success: true, flagged: Number(data ?? 0) });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Renewal flag run failed",
      },
      500,
    );
  }
}
