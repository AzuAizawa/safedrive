import { createClient } from "@supabase/supabase-js";
import { sendUserNotificationEmail } from "./lib/email.js";

export const config = {
  runtime: "edge",
};

const DEFAULT_COMMISSION_RATE = 0.1;
const MAX_BOOKING_TOTAL = 100000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_TIME_ZONE = "Asia/Manila";
const ACTIVE_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "awaiting_payment",
  "downpayment_paid",
  "fully_paid",
  "active",
];

type CreateBookingPayload = {
  carId?: string;
  startDate?: string;
  endDate?: string;
  pickupTime?: string;
  dropoffTime?: string;
  agreementAccepted?: boolean;
  agreementVersionId?: string;
};

type DateOnly = {
  iso: string;
  year: number;
  month: number;
  day: number;
  utcMs: number;
};

type ProfileRecord = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  verified_status: string | null;
};

type CarRecord = {
  id: string;
  owner_id: string;
  status: string | null;
  price_per_day: number | string;
  plate_number: string;
  car_models:
    | {
        name: string;
        car_brands:
          | {
              name: string;
            }
          | null;
      }
    | null;
};

type ExistingBookingRecord = {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
};

const normalizeCommissionRate = (value: unknown) => {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    return DEFAULT_COMMISSION_RATE;
  }

  return rate;
};

const parseDateOnly = (value: unknown): DateOnly | null => {
  if (typeof value !== "string") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const date = new Date(utcMs);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    iso: value,
    year,
    month,
    day,
    utcMs,
  };
};

const parseTime = (value: unknown) => {
  if (typeof value !== "string") return null;

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;

  return Number(match[1]) * 60 + Number(match[2]);
};

const getTodayInManila = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  if (!year || !month || !day) {
    throw new Error("Unable to resolve today's booking date");
  }

  return Date.UTC(year, month - 1, day);
};

const getVehicleLabel = (car: CarRecord) => {
  const brand = car.car_models?.car_brands?.name;
  const model = car.car_models?.name;
  const vehicle = [brand, model].filter(Boolean).join(" ") || "vehicle";
  return `${vehicle} (${car.plate_number})`;
};

const isOverlapping = (
  requestedStart: DateOnly,
  requestedEnd: DateOnly,
  booking: ExistingBookingRecord,
) => {
  const bookingStart = parseDateOnly(booking.start_date);
  const bookingEnd = parseDateOnly(booking.end_date);
  if (!bookingStart || !bookingEnd) return false;

  return requestedStart.utcMs <= bookingEnd.utcMs && requestedEnd.utcMs >= bookingStart.utcMs;
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing authorization token" }, 401);
    }

    const payload = (await req.json()) as CreateBookingPayload;
    const carId = payload.carId?.trim();
    const startDate = parseDateOnly(payload.startDate);
    const endDate = parseDateOnly(payload.endDate);
    const pickupMinutes = parseTime(payload.pickupTime);
    const dropoffMinutes = parseTime(payload.dropoffTime);

    if (!carId || !startDate || !endDate) {
      return jsonResponse(
        { error: "Car, start date, and end date are required" },
        400,
      );
    }

    if (pickupMinutes === null || dropoffMinutes === null) {
      return jsonResponse(
        { error: "Valid pickup and drop-off times are required" },
        400,
      );
    }

    const todayUtcMs = getTodayInManila();
    // A car left idle is wasted, so a trip may start as soon as the next day.
    // The 24-hour owner-response and 24-hour payment windows below still apply,
    // and both are capped so they never run past the trip start: if the lister
    // has not accepted and the renter has not paid before pickup, the booking
    // auto-cancels through api/expire-booking-deadlines.ts. Same-day starts stay
    // disabled pending transport/insurance/handover review (see master doc K.2).
    const minStartUtcMs = todayUtcMs + 1 * DAY_MS;
    const maxStartUtcMs = todayUtcMs + 30 * DAY_MS;

    if (startDate.utcMs < minStartUtcMs) {
      return jsonResponse(
        { error: "The earliest a trip can start is tomorrow" },
        400,
      );
    }

    if (startDate.utcMs > maxStartUtcMs) {
      return jsonResponse(
        { error: "Bookings can only be requested up to 30 days in advance" },
        400,
      );
    }

    if (endDate.utcMs > maxStartUtcMs) {
      return jsonResponse(
        { error: "Booking dates must stay within the next 30 days" },
        400,
      );
    }

    if (endDate.utcMs <= startDate.utcMs) {
      return jsonResponse({ error: "End date must be after start date" }, 400);
    }

    const pickupAbsoluteMinutes = startDate.utcMs / 60000 + pickupMinutes;
    const dropoffAbsoluteMinutes = endDate.utcMs / 60000 + dropoffMinutes;

    if (dropoffAbsoluteMinutes <= pickupAbsoluteMinutes) {
      return jsonResponse({ error: "Drop-off must be after pickup" }, 400);
    }

    // The real pickup instant, for capping the owner-response deadline below.
    // startDate.utcMs is a naive Date.UTC(y,m,d) of the Manila calendar date -
    // correct for the date-only comparisons above (both sides shift by the
    // same missing offset, so their differences stay right), but wrong once
    // combined with a time-of-day and compared against a real clock: it reads
    // 8 hours late. Subtract the Manila (UTC+8) offset to get the true instant.
    const pickupInstantMs =
      startDate.utcMs + pickupMinutes * 60_000 - 8 * 60 * 60 * 1000;

    const supabase = getSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, verified_status")
      .eq("id", user.id)
      .single();

    if (profileError || !profileData) {
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    const profile = profileData as ProfileRecord;
    if (profile.verified_status !== "verified") {
      return jsonResponse(
        { error: "Identity verification is required before booking" },
        403,
      );
    }

    if (profile.role === "lister" || profile.role === "admin" || profile.role === "super_admin") {
      return jsonResponse(
        { error: "This account type cannot create renter bookings" },
        403,
      );
    }

    // Driver's licence gate. Read in a SEPARATE query so a deployment that
    // lands before CHAPTER 29 runs (missing columns) degrades to "no gate"
    // instead of failing every booking.
    let licenseExpiry: string | null = null;
    let licenseTransmission: string | null = null;
    {
      const { data: lic } = await supabase
        .from("profiles")
        .select("license_expiry, license_transmission")
        .eq("id", user.id)
        .maybeSingle();
      if (lic) {
        licenseExpiry = (lic as { license_expiry: string | null }).license_expiry;
        licenseTransmission = (
          lic as { license_transmission: string | null }
        ).license_transmission;
      }
    }

    // Only an EXPLICIT past expiry blocks - an account verified before this
    // check has license_expiry = null and is grandfathered.
    if (licenseExpiry) {
      const licenceEnd = new Date(`${licenseExpiry}T23:59:59`);
      if (!Number.isNaN(licenceEnd.getTime()) && licenceEnd.getTime() < Date.now()) {
        return jsonResponse(
          {
            error:
              "Your driver's licence has expired. Submit an updated licence from Account & Identity so an admin can restore your booking access.",
          },
          403,
        );
      }
    }

    // An unresolved non-return incident (renter still holding a car past its
    // return date) blocks new bookings. Separate query so a deploy before
    // CHAPTER 31 degrades to "no gate".
    {
      const { data: openIncident } = await supabase
        .from("bookings")
        .select("id")
        .eq("renter_id", user.id)
        .eq("dispute_status", "open")
        .limit(1)
        .maybeSingle();
      if (openIncident) {
        return jsonResponse(
          {
            error:
              "You have an open case for a vehicle that was not returned on time. Resolve it with SafeDrive support before booking again.",
          },
          403,
        );
      }
    }

    const { data: carData, error: carError } = await supabase
      .from("cars")
      .select(
        `
        id,
        owner_id,
        status,
        price_per_day,
        plate_number,
        car_models (
          name,
          car_brands (name)
        )
      `,
      )
      .eq("id", carId)
      .single();

    if (carError || !carData) {
      return jsonResponse({ error: "Car not found" }, 404);
    }

    const car = carData as unknown as CarRecord;
    if (!["approved", "active"].includes(car.status ?? "")) {
      return jsonResponse({ error: "This car is not available for booking" }, 409);
    }

    // Transmission gate (separate query, same graceful-degradation reason as
    // the licence read): only an explicit automatic-only licence against an
    // explicit manual car is blocked.
    if (licenseTransmission === "automatic_only") {
      const { data: carTx } = await supabase
        .from("cars")
        .select("transmission")
        .eq("id", carId)
        .maybeSingle();
      if ((carTx as { transmission: string | null } | null)?.transmission === "manual") {
        return jsonResponse(
          {
            error:
              "This vehicle has a manual transmission and your driver's licence is automatic-only. Submit an updated licence if this has changed.",
          },
          403,
        );
      }
    }

    if (car.owner_id === user.id) {
      return jsonResponse({ error: "You cannot book your own car" }, 403);
    }

    if (payload.agreementAccepted !== true) {
      return jsonResponse({ error: "Review and accept the approved vehicle rental agreement before booking" }, 400);
    }

    if (!payload.agreementVersionId) {
      return jsonResponse({ error: "The accepted rental-agreement version is required" }, 400);
    }

    const { data: agreementVersion, error: agreementError } = await supabase
      .from("car_agreement_versions")
      .select("id, storage_path, content_sha256, version_number")
      .eq("car_id", car.id)
      .eq("status", "approved")
      .maybeSingle();
    if (agreementError) throw agreementError;
    if (!agreementVersion) {
      return jsonResponse({ error: "This vehicle needs an approved rental-agreement version before it can be booked" }, 409);
    }
    if (agreementVersion.id !== payload.agreementVersionId) {
      return jsonResponse(
        { error: "The rental agreement changed. Review and accept the current approved version before booking" },
        409,
      );
    }

    const pricePerDay = Number(car.price_per_day);
    if (!Number.isFinite(pricePerDay) || pricePerDay <= 0) {
      return jsonResponse(
        { error: "This listing has an invalid daily price" },
        409,
      );
    }

    const { data: settingData, error: settingError } = await supabase
      .from("platform_settings")
      .select(
        "commission_rate, payment_processing_fee_rate, payment_processing_fixed_centavos, downpayment_rate, refund_full_hours, refund_late_renter_percent",
      )
      .eq("id", "default")
      .maybeSingle();

    if (settingError) throw settingError;

    const rawDownpaymentRate = Number(settingData?.downpayment_rate);
    const downpaymentRate =
      Number.isFinite(rawDownpaymentRate) &&
      rawDownpaymentRate >= 0.2 &&
      rawDownpaymentRate <= 1
        ? rawDownpaymentRate
        : 0.5;
    const rawRefundFullHours = Number(settingData?.refund_full_hours);
    const refundFullHours =
      Number.isFinite(rawRefundFullHours) &&
      rawRefundFullHours >= 0 &&
      rawRefundFullHours <= 720
        ? Math.round(rawRefundFullHours)
        : 24;
    const rawLatePercent = Number(settingData?.refund_late_renter_percent);
    const refundLateRenterPercent =
      Number.isFinite(rawLatePercent) &&
      rawLatePercent >= 0 &&
      rawLatePercent <= 100
        ? rawLatePercent
        : 50;

    const totalDays = Math.round((endDate.utcMs - startDate.utcMs) / DAY_MS);
    const commissionRate = normalizeCommissionRate(settingData?.commission_rate);
    const basePrice = pricePerDay * totalDays;
    const commission = basePrice * commissionRate;
    const subtotal = basePrice + commission;
    const processingRate = Math.min(0.25, Math.max(0, Number(settingData?.payment_processing_fee_rate ?? 0)));
    const processingFixed = Math.max(0, Number(settingData?.payment_processing_fixed_centavos ?? 0)) / 100;
    const grossTotal = processingRate < 1 ? (subtotal + processingFixed) / (1 - processingRate) : subtotal;
    const paymentProcessingFee = Math.max(0, Math.round((grossTotal - subtotal) * 100) / 100);
    const totalPrice = subtotal + paymentProcessingFee;
    const downpayment = Math.ceil(totalPrice * downpaymentRate);
    const balance = totalPrice - downpayment;

    if (totalPrice > MAX_BOOKING_TOTAL) {
      return jsonResponse(
        {
          error: `Booking total must be PHP ${MAX_BOOKING_TOTAL.toLocaleString()} or below`,
        },
        400,
      );
    }

    const { data: existingBookings, error: bookingLookupError } = await supabase
      .from("bookings")
      .select("id, start_date, end_date, status")
      .eq("car_id", car.id)
      .in("status", ACTIVE_BOOKING_STATUSES);

    if (bookingLookupError) throw bookingLookupError;

    const hasConflict = ((existingBookings ?? []) as ExistingBookingRecord[]).some(
      (booking) => isOverlapping(startDate, endDate, booking),
    );

    if (hasConflict) {
      return jsonResponse(
        { error: "Selected dates overlap with an existing booking" },
        409,
      );
    }

    // A renter can only be on one trip at a time - in a peer-to-peer rental the
    // verified account holder is the person who meets the lister and drives the
    // car. Block a second booking that overlaps these dates on ANY car, not just
    // this one; a car for someone else must be booked from that person's own
    // account.
    const { data: renterBookings, error: renterBookingError } = await supabase
      .from("bookings")
      .select("id, start_date, end_date, status")
      .eq("renter_id", user.id)
      .in("status", ACTIVE_BOOKING_STATUSES);
    if (renterBookingError) throw renterBookingError;

    const renterHasOverlap = ((renterBookings ?? []) as ExistingBookingRecord[]).some(
      (booking) => isOverlapping(startDate, endDate, booking),
    );
    if (renterHasOverlap) {
      return jsonResponse(
        {
          error:
            "You already have a booking for these dates. You can only be on one trip at a time - the account holder has to be the driver. If this car is for someone else, they need to book it from their own account.",
        },
        409,
      );
    }

    const { data: bookingData, error: createError } = await supabase
      .from("bookings")
      .insert({
        car_id: car.id,
        renter_id: user.id,
        owner_id: car.owner_id,
        start_date: startDate.iso,
        end_date: endDate.iso,
        total_days: totalDays,
        base_price: basePrice,
        commission,
        total_price: totalPrice,
        downpayment_amount: downpayment,
        balance_amount: balance,
        status: "pending",
        // 24 hours to respond, but never later than the trip's pickup time.
        owner_response_deadline: new Date(
          Math.min(Date.now() + DAY_MS, pickupInstantMs),
        ).toISOString(),
        renter_completed: false,
        owner_completed: false,
        pickup_time: payload.pickupTime,
        dropoff_time: payload.dropoffTime,
        agreement_version_id: agreementVersion.id,
        agreement_storage_path_snapshot: agreementVersion.storage_path,
        agreement_sha256_snapshot: agreementVersion.content_sha256,
        payment_processing_fee: paymentProcessingFee,
        downpayment_rate_snapshot: downpaymentRate,
        refund_full_hours_snapshot: refundFullHours,
        refund_late_renter_percent_snapshot: refundLateRenterPercent,
      })
      .select(
        "id, total_days, base_price, commission, total_price, downpayment_amount, balance_amount, status",
      )
      .single();

    if (createError || !bookingData) {
      throw createError ?? new Error("Failed to create booking");
    }

    const bookingId = (bookingData as { id: string }).id;

    const { error: acceptanceError } = await supabase.from("booking_agreement_acceptances").insert({
      booking_id: bookingId,
      agreement_version_id: agreementVersion.id,
      renter_id: user.id,
      acceptance_text_version: "2026-07-27",
    });
    if (acceptanceError) {
      await supabase.from("bookings").delete().eq("id", bookingId);
      throw acceptanceError;
    }

    const vehicleLabel = getVehicleLabel(car);

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "booking_created",
      entity_type: "booking",
      entity_id: bookingId,
      details: {
        car_id: car.id,
        total_price: totalPrice,
        commission_rate: commissionRate,
        agreement_version_id: agreementVersion.id,
        agreement_version_number: agreementVersion.version_number,
        payment_processing_fee: paymentProcessingFee,
        pricing_source: "server_authoritative",
      },
    });

    const requesterLabel = profile.full_name || profile.email || "A renter";
    await supabase.from("notifications").insert({
      user_id: car.owner_id,
      title: "New Booking Request",
      message: `${requesterLabel} requested to book ${vehicleLabel}.`,
      type: "info",
      link: "/lister-bookings",
    });
    await sendUserNotificationEmail(supabase, {
      userId: car.owner_id,
      title: "New Booking Request",
      message: `${requesterLabel} requested to book ${vehicleLabel} for ${startDate.iso} to ${endDate.iso}. Open SafeDrive to accept or decline it within 24 hours - it auto-expires after that.`,
      link: "/lister-bookings",
      baseOrigin: new URL(req.url).origin,
      eventKey: `booking-requested:${bookingId}`,
    });

    return jsonResponse({
      success: true,
      bookingId,
      state: "pending",
      booking: bookingData as Record<string, unknown>,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Create booking error:", message);
    return jsonResponse({ error: message }, 500);
  }
}
