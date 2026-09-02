import { createSupabaseAdmin } from "./lib/payoutAutomation";
import { sendReturnReminderEmail, type TransactionalEmailResult } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

type ReminderBooking = {
  id: string;
  status: string;
  end_date: string;
  dropoff_time: string | null;
  renter_id: string;
  owner_id: string;
  renter: { email: string; full_name: string | null };
  owner: { email: string; full_name: string | null };
  cars: {
    plate_number: string;
    car_models: {
      name: string;
      car_brands: { name: string };
    };
  };
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const getBearerToken = (req: Request) => {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
};

const getReturnDeadline = (endDate: string, dropoffTime: string | null) => {
  const [year, month, day] = endDate.split("-").map(Number);
  const [hour, minute] = (dropoffTime || "18:00").split(":").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, hour || 18, minute || 0, 0, 0);
};

const getVehicleLabel = (booking: ReminderBooking) =>
  `${booking.cars.car_models.car_brands.name} ${booking.cars.car_models.name} (${booking.cars.plate_number})`;

const getReminderState = (booking: ReminderBooking, now = new Date()) => {
  const deadline = getReturnDeadline(booking.end_date, booking.dropoff_time);
  const diffMinutes = Math.round((deadline.getTime() - now.getTime()) / 60000);

  if (diffMinutes > 24 * 60) return null;
  if (diffMinutes < -48 * 60) return null;

  return {
    kind: diffMinutes >= 0 ? "due_soon" : "overdue",
    deadline,
    title: diffMinutes >= 0 ? "SafeDrive return reminder" : "SafeDrive return overdue",
    body:
      diffMinutes >= 0
        ? `${getVehicleLabel(booking)} is close to its agreed return time. Please prepare the vehicle handoff and completion proof.`
        : `${getVehicleLabel(booking)} is past the agreed return time. Please coordinate immediately and document the handoff in SafeDrive.`,
  };
};

const sendGmailWebhook = async (payload: {
  to: string;
  subject: string;
  body: string;
}): Promise<TransactionalEmailResult> => {
  const webhookUrl = process.env.GMAIL_RETURN_REMINDER_WEBHOOK_URL;
  if (!webhookUrl) {
    return { state: "not_configured" };
  }

  const webhookSecret = process.env.GMAIL_WEBHOOK_SHARED_SECRET;
  if (!webhookSecret) {
    return {
      state: "failed",
      reason: "GMAIL_WEBHOOK_SHARED_SECRET is not configured",
    };
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret: webhookSecret }),
  });

  const result = (await response.json().catch(() => null)) as {
    ok?: boolean;
  } | null;

  if (!response.ok || result?.ok !== true) {
    return {
      state: "failed",
      reason: "Gmail webhook rejected the email request",
    };
  }

  return { state: "sent" };
};

const reminderDeadlineText = (deadline: Date) =>
  new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(deadline);

export default async function handler(req: Request) {
  if (!["GET", "POST"].includes(req.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return jsonResponse(
        { error: "CRON_SECRET must be configured before reminders can run" },
        500,
      );
    }

    const bearerToken = getBearerToken(req);
    const headerSecret = req.headers.get("x-cron-secret");

    if (bearerToken !== cronSecret && headerSecret !== cronSecret) {
      return jsonResponse({ error: "Unauthorized reminder run" }, 401);
    }

    const supabase = createSupabaseAdmin();
    const now = new Date();
    const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const floor = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("bookings")
      .select(
        `
        id,
        status,
        end_date,
        dropoff_time,
        renter_id,
        owner_id,
        renter:profiles!bookings_renter_id_fkey(email, full_name),
        owner:profiles!bookings_owner_id_fkey(email, full_name),
        cars(plate_number, car_models(name, car_brands(name)))
      `,
      )
      .in("status", ["fully_paid", "active"])
      .gte("end_date", floor)
      .lte("end_date", horizon);

    if (error) throw error;

    const candidates = ((data ?? []) as unknown as ReminderBooking[])
      .map((booking) => ({
        booking,
        reminder: getReminderState(booking, now),
      }))
      .filter(
        (item): item is { booking: ReminderBooking; reminder: NonNullable<ReturnType<typeof getReminderState>> } =>
          Boolean(item.reminder),
      );

    let notificationCount = 0;
    let emailCount = 0;
    const emailStates: Record<string, number> = {};

    for (const { booking, reminder } of candidates) {
      const recipients = [
        {
          userId: booking.renter_id,
          email: booking.renter.email,
          name: booking.renter.full_name,
          link: `/my-bookings?bookingId=${booking.id}&notice=${reminder.kind}`,
        },
        {
          userId: booking.owner_id,
          email: booking.owner.email,
          name: booking.owner.full_name,
          link: `/lister-bookings?bookingId=${booking.id}&notice=${reminder.kind}`,
        },
      ];
      const existenceChecks = await Promise.all(
        recipients.map(async (recipient) => {
          const { data } = await supabase
            .from("notifications")
            .select("id")
            .eq("user_id", recipient.userId)
            .eq("link", recipient.link)
            .limit(1);
          return Boolean(data?.length);
        }),
      );
      const pendingRecipients = recipients.filter((_, index) => !existenceChecks[index]);
      if (!pendingRecipients.length) continue;

      const notificationTitle = reminder.kind === "overdue" ? "Return overdue" : "Return due soon";
      const { error: notificationError } = await supabase.from("notifications").insert(
        pendingRecipients.map((recipient) => ({
          user_id: recipient.userId,
          title: notificationTitle,
          message: reminder.body,
          type: reminder.kind === "overdue" ? "error" : "warning",
          link: recipient.link,
        })),
      );
      if (notificationError) throw notificationError;
      notificationCount += pendingRecipients.length;

      if (pendingRecipients.length) {
        const vehicle = getVehicleLabel(booking);
        const deadline = reminderDeadlineText(reminder.deadline);
        for (const recipient of pendingRecipients) {
          let emailResult = await sendReturnReminderEmail({
            to: recipient.email,
            name: recipient.name,
            title: reminder.title,
            body: reminder.body,
            vehicle,
            deadline,
            link: recipient.link,
            baseOrigin: new URL(req.url).origin,
            eventKey: `${booking.id}:${reminder.kind}:${recipient.userId}`,
          });

          // Preserve Apps Script only when Resend is absent. Falling back after
          // a Resend attempt can create duplicate messages for the same event.
          if (emailResult.state === "not_configured") {
            emailResult = await sendGmailWebhook({
              to: recipient.email,
              subject: reminder.title,
              body: `${reminder.body}\n\nVehicle: ${vehicle}\nReturn deadline: ${deadline}\n\nOpen SafeDrive and complete the return steps after handoff.`,
            });
          }
          emailStates[emailResult.state] = (emailStates[emailResult.state] ?? 0) + 1;
          if (emailResult.state === "sent") emailCount += 1;
        }
      }
    }

    await supabase.from("audit_log").insert({
      user_id: null,
      action: "return_reminder_sweep",
      entity_type: "booking",
      details: {
        checked: candidates.length,
        notifications_created: notificationCount,
        email_reminders: emailCount,
        email_states: emailStates,
        mode: process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL
          ? "resend"
          : process.env.GMAIL_RETURN_REMINDER_WEBHOOK_URL
            ? "gmail_fallback"
            : "not_configured",
      },
    });

    return jsonResponse({
      success: true,
      checked: candidates.length,
      notificationsCreated: notificationCount,
      emailReminders: emailCount,
      mode: process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL
        ? "resend"
        : process.env.GMAIL_RETURN_REMINDER_WEBHOOK_URL
          ? "gmail_fallback"
          : "not_configured",
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected return reminder error",
      },
      500,
    );
  }
}
