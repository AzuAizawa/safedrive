import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "edge" };

/**
 * GET: the signed-in member's own data, as one JSON document (CHAPTER 121).
 *
 * Privacy requests are no longer filed here. A member downloads their data
 * themselves, deletes their account from account settings (CHAPTER 96), and
 * raises a correction, a restriction or anything else as a support ticket
 * tagged Privacy / Data.
 *
 * Only the member's own records are read, by their id, with the service role.
 * Left out on purpose: ID numbers and identity images (kept encrypted or
 * private; shown on the account page), arrival locations and photos, and other
 * people's personal details - the other side of a booking, a reviewer's name,
 * another participant's messages.
 */
const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const lastFour = (value: string | null) => (value ? `****${value.slice(-4)}` : null);

export default async function handler(req: Request) {
  if (req.method === "POST" || req.method === "PATCH") {
    return respond(
      {
        error:
          "Privacy requests are no longer filed here. Download your data from Your Data, delete your account from Account settings, or open a support ticket tagged Privacy / Data.",
      },
      410,
    );
  }
  if (req.method !== "GET") return respond({ error: "Method not allowed" }, 405);

  try {
    const url = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!url || !serviceKey) return respond({ error: "The data export is not configured on this deployment" }, 503);
    if (!token) return respond({ error: "Unauthorized" }, 401);

    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return respond({ error: "Unauthorized" }, 401);
    const me = user.id;

    const carLabel = "cars(plate_number, car_models(name, car_brands(name)))";
    const [profile, bookings, vehicles, written, received, tickets] = await Promise.all([
      supabase
        .from("profiles")
        .select("email, full_name, first_name, middle_name, last_name, phone, secondary_phone, address, birthday, gender, verified_status, role, is_lister, emergency_contact_number, payout_method, payout_account_name, payout_account_number, created_at")
        .eq("id", me)
        .single(),
      supabase
        .from("bookings")
        .select(`id, renter_id, owner_id, status, start_date, end_date, pickup_time, dropoff_time, total_days, base_price, commission, total_price, downpayment_amount, balance_amount, created_at, ${carLabel}, payments(payment_type, amount, status, created_at)`)
        .or(`renter_id.eq.${me},owner_id.eq.${me}`)
        .order("start_date", { ascending: false }),
      supabase
        .from("cars")
        .select("plate_number, status, price_per_day, location, created_at, deleted_at, car_models(name, car_brands(name))")
        .eq("owner_id", me)
        .order("created_at", { ascending: false }),
      supabase.from("booking_reviews").select("booking_id, reviewer_role, rating, created_at").eq("reviewer_id", me),
      supabase.from("booking_reviews").select("booking_id, reviewer_role, rating, created_at").eq("reviewee_id", me),
      supabase
        .from("support_tickets")
        .select("id, subject, tag, status, booking_id, created_at, ticket_messages(sender_id, message, attachment_name, created_at)")
        .or(`user_id.eq.${me},participant_user_id.eq.${me}`)
        .order("created_at", { ascending: false }),
    ]);
    const failure = [profile, bookings, vehicles, written, received, tickets].find((result) => result.error)?.error;
    if (failure) throw failure;

    const profileRow = profile.data as Record<string, unknown> & { payout_account_number: string | null };
    type Ticket = {
      id: string;
      subject: string;
      tag: string | null;
      status: string;
      booking_id: string | null;
      created_at: string;
      ticket_messages: Array<{ sender_id: string; message: string; attachment_name: string | null; created_at: string }>;
    };
    type Booking = Record<string, unknown> & { renter_id: string; owner_id: string; commission: unknown };

    const exportedAt = new Date().toISOString();
    const document = {
      exported_at: exportedAt,
      notice:
        "Your SafeDrive data. ID numbers and identity images, arrival locations and photos, and other people's personal details are not included.",
      profile: { ...profileRow, payout_account_number: lastFour(profileRow.payout_account_number) },
      bookings: ((bookings.data ?? []) as Booking[]).map(({ renter_id, owner_id, commission, ...booking }) => ({
        your_role: renter_id === me ? "renter" : "lister",
        ...booking,
        ...(owner_id === me ? { commission } : {}),
      })),
      vehicles: vehicles.data ?? [],
      reviews_written: written.data ?? [],
      reviews_received: received.data ?? [],
      support_tickets: ((tickets.data ?? []) as Ticket[]).map(({ ticket_messages, ...ticket }) => ({
        ...ticket,
        your_messages: (ticket_messages ?? [])
          .filter((message) => message.sender_id === me)
          .map(({ sender_id: _sender, ...message }) => message),
      })),
    };

    await supabase.from("audit_log").insert({
      user_id: me,
      action: "personal_data_exported",
      entity_type: "profile",
      entity_id: me,
      details: {
        bookings: document.bookings.length,
        vehicles: document.vehicles.length,
        support_tickets: document.support_tickets.length,
      },
    });

    return new Response(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="safedrive-my-data-${exportedAt.slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    console.error("Data export failed", error);
    return respond({ error: error instanceof Error ? error.message : "Data export failed" }, 500);
  }
}
