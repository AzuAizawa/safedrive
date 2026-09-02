import { supabase } from "@/lib/supabase";

type ReminderBooking = {
  id: string;
  status: string;
  end_date: string;
  dropoff_time: string | null;
  label: string;
};

type NoShowBooking = {
  status: string;
  start_date: string;
  pickup_time: string | null;
  renter_arrived_at: string | null;
  lister_arrived_at: string | null;
};

type ReturnReminderState = {
  kind: "due_soon" | "overdue";
  deadline: Date;
  title: string;
  body: string;
  footnote: string;
  tone: string;
};

export const getBookingReturnDeadline = (
  endDate: string,
  dropoffTime: string | null,
) => {
  const [year, month, day] = endDate.split("-").map(Number);
  const [hour, minute] = (dropoffTime || "18:00").split(":").map(Number);

  return new Date(year, (month || 1) - 1, day || 1, hour || 18, minute || 0, 0, 0);
};

export const getBookingPickupTime = (
  startDate: string,
  pickupTime: string | null,
) => {
  const [year, month, day] = startDate.split("-").map(Number);
  const [hour, minute] = (pickupTime || "09:00").split(":").map(Number);

  return new Date(year, (month || 1) - 1, day || 1, hour || 9, minute || 0, 0, 0);
};

export const NO_SHOW_GRACE_WINDOW_MINUTES = 30;

export const getNoShowWindowState = (
  booking: NoShowBooking,
  actor: "renter" | "owner",
  now = new Date(),
) => {
  if (!["fully_paid", "active"].includes(booking.status)) return null;

  const actorArrived =
    actor === "renter" ? booking.renter_arrived_at : booking.lister_arrived_at;
  const counterpartyArrived =
    actor === "renter" ? booking.lister_arrived_at : booking.renter_arrived_at;

  if (!actorArrived || counterpartyArrived) return null;

  const pickupAt = getBookingPickupTime(booking.start_date, booking.pickup_time);
  const reportReadyAt = new Date(
    pickupAt.getTime() + NO_SHOW_GRACE_WINDOW_MINUTES * 60 * 1000,
  );
  const msRemaining = reportReadyAt.getTime() - now.getTime();

  return {
    pickupAt,
    reportReadyAt,
    canReport: msRemaining <= 0,
    minutesRemaining: Math.max(0, Math.ceil(msRemaining / 60000)),
  };
};

export const getReturnReminderState = (
  booking: Pick<ReminderBooking, "status" | "end_date" | "dropoff_time">,
  now = new Date(),
): ReturnReminderState | null => {
  if (!["fully_paid", "active"].includes(booking.status)) return null;

  const deadline = getBookingReturnDeadline(booking.end_date, booking.dropoff_time);
  const diffMs = deadline.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes > 24 * 60) return null;

  if (diffMinutes >= 0) {
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    const timeLabel =
      hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
    return {
      kind: "due_soon",
      deadline,
      title: "Return due soon",
      body: "This booking is close to its agreed return time. Plan the handoff and keep the required check-in or completion evidence ready.",
      footnote: `Return deadline: ${deadline.toLocaleString()} • ${timeLabel}`,
      tone: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  const overdueMinutes = Math.abs(diffMinutes);
  const overdueHours = Math.floor(overdueMinutes / 60);
  const overdueRemainder = overdueMinutes % 60;
  const overdueLabel =
    overdueHours > 0
      ? `${overdueHours}h ${overdueRemainder}m overdue`
      : `${overdueRemainder}m overdue`;

  return {
    kind: "overdue",
    deadline,
    title: "Return overdue",
    body: "The agreed return time has passed. Coordinate immediately and document the handoff or issue through the platform.",
    footnote: `Scheduled return: ${deadline.toLocaleString()} • ${overdueLabel}`,
    tone: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
  };
};

export const ensureReturnReminderNotifications = async (
  userId: string,
  bookings: ReminderBooking[],
  linkBase: string,
) => {
  const candidates = bookings
    .map((booking) => ({
      booking,
      reminder: getReturnReminderState(booking),
    }))
    .filter(
      (
        item,
      ): item is {
        booking: ReminderBooking;
        reminder: ReturnReminderState;
      } => Boolean(item.reminder),
    );

  if (candidates.length === 0) return;

  const links = candidates.map(
    ({ booking, reminder }) =>
      `${linkBase}?bookingId=${booking.id}&notice=${reminder.kind}`,
  );

  const { data: existing } = await supabase
    .from("notifications")
    .select("link")
    .eq("user_id", userId)
    .in("link", links);

  const existingLinks = new Set((existing ?? []).map((row) => row.link));

  const inserts = candidates
    .filter(
      ({ booking, reminder }) =>
        !existingLinks.has(`${linkBase}?bookingId=${booking.id}&notice=${reminder.kind}`),
    )
    .map(({ booking, reminder }) => ({
      user_id: userId,
      title: reminder.title,
      message: `${booking.label}: ${reminder.body}`,
      type: reminder.kind === "overdue" ? "error" : "warning",
      link: `${linkBase}?bookingId=${booking.id}&notice=${reminder.kind}`,
    }));

  if (inserts.length > 0) {
    await supabase.from("notifications").insert(inserts);
  }
};
