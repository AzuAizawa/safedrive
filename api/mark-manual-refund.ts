import { createSupabaseAdmin } from "../server/payoutAutomation.js";
import { sendRefundReceiptEmail, sendUserNotificationEmail } from "../server/email.js";
import { postCompletedRefundToLedger } from "../server/ledger.js";
import {
  releaseCancellationCompensation,
  type CompensationResult,
} from "../server/cancellationCompensation.js";
import { releaseDecidedRefundToSource } from "../server/refundAutomation.js";
import {
  classifyManualRefund,
  decideRefund,
  getRefundCapacity,
  MANUAL_REFUND_KINDS,
  type ManualRefundKind,
} from "../server/refundDecision.js";

export const config = {
  runtime: "edge",
};

type ManualRefundPayload = {
  paymentId?: string;
  refundMethod?: string;
  referenceNumber?: string;
  note?: string | null;
  // The super admin's decision (server/refundDecision.ts). Omitted means the
  // recommended amount - the release that existed before decisions could be
  // made. A different amount, or 0 to deny, needs `reason`.
  amount?: number | string | null;
  reason?: string | null;
  // Set only after SafeDrive has said the provider cannot carry this refund.
  // Without it the release goes back to the account the renter paid from, so
  // nobody has to choose a destination SafeDrive was never given.
  manualTransfer?: boolean;
};

type RefundPaymentRecord = {
  id: string;
  booking_id: string;
  amount: number;
  payment_type: string;
  status: string;
  payment_method: string | null;
  transaction_id: string | null;
  notes: string | null;
  bookings: {
    id: string;
    status: string;
    renter_id: string;
    owner_id: string;
    cars: {
      plate_number: string;
      car_models: {
        name: string;
        car_brands: { name: string };
      };
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

const normalizeRefundMethod = (value: string | undefined | null) => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "gcash") return "GCash";
  if (normalized === "maya") return "Maya";
  return null;
};

const getVehicleLabel = (payment: RefundPaymentRecord) =>
  `${payment.bookings.cars.car_models.car_brands.name} ${payment.bookings.cars.car_models.name} (${payment.bookings.cars.plate_number})`;

const peso = (amount: number) =>
  `PHP ${amount.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: "Missing authorization token" }, 401);
    }

    const payload = (await req.json().catch(() => ({}))) as ManualRefundPayload;
    const paymentId = payload.paymentId?.trim();
    const refundMethod = normalizeRefundMethod(payload.refundMethod);
    const referenceNumber = payload.referenceNumber?.trim();
    const note = payload.note?.trim() || null;
    const requestedAmount =
      payload.amount === undefined || payload.amount === null || String(payload.amount).trim() === ""
        ? null
        : Number(payload.amount);

    if (!paymentId) {
      return jsonResponse({ error: "Refund payment is required." }, 400);
    }

    const supabase = createSupabaseAdmin();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized request" }, 401);
    }

    const { data: requesterProfile, error: requesterError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (requesterError || requesterProfile?.role !== "super_admin") {
      return jsonResponse(
        { error: "Only a super admin can mark refunds as released." },
        403,
      );
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select(
        `
        id,
        booking_id,
        amount,
        payment_type,
        status,
        payment_method,
        transaction_id,
        notes,
        bookings(
          id,
          status,
          renter_id,
          owner_id,
          cars(plate_number, car_models(name, car_brands(name)))
        )
      `,
      )
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      return jsonResponse({ error: "Refund payment record not found." }, 404);
    }

    const refundPayment = payment as unknown as RefundPaymentRecord;

    if (refundPayment.payment_type !== "refund") {
      return jsonResponse({ error: "Selected payment is not a refund." }, 422);
    }

    if (refundPayment.status === "completed") {
      // The renter's half is done. If the lister's half was interrupted, this
      // is the only place a super admin can reach it again, so try it here.
      const retried = await releaseCancellationCompensation(supabase, {
        bookingId: refundPayment.booking_id,
        actorId: user.id,
        baseOrigin: new URL(req.url).origin,
      }).catch((error: unknown) => ({
        state: "failed" as const,
        reason: error instanceof Error ? error.message : "Compensation retry failed",
      }));
      if (retried.state === "completed" || retried.state === "pending") {
        return jsonResponse({
          success: true,
          state: "already_completed",
          paymentId: refundPayment.id,
          compensation: retried,
        });
      }
      return jsonResponse({ error: "This refund is already completed.", compensation: retried }, 409);
    }

    const providerRefundStillPending =
      refundPayment.status === "pending" &&
      refundPayment.payment_method?.toLowerCase() === "paymongo" &&
      Boolean(refundPayment.transaction_id);

    if (providerRefundStillPending) {
      return jsonResponse(
        {
          error:
            "A PayMongo refund is already pending. Wait for provider confirmation or retry only after it fails before using manual fallback.",
        },
        409,
      );
    }

    // Guard against releasing more than the booking ever collected. This row
    // being pending was previously the only check - nothing looked at the
    // OTHER refunds on the same booking. If a full refund already went
    // through (for example via a "Retry PayMongo" that ignored this partial
    // row), releasing this one on top of it sends real cash out the door
    // twice. The booking's own payments plus extension payments: an extension
    // payment that could not be applied is refunded through this same queue
    // (api/webhooks/paymongo.ts), and its money was collected like any other.
    const { data: siblingPayments, error: siblingPaymentsError } = await supabase
      .from("payments")
      .select("id, amount, payment_type, status")
      .eq("booking_id", refundPayment.booking_id);
    if (siblingPaymentsError) throw siblingPaymentsError;

    const capacity = getRefundCapacity(siblingPayments ?? [], refundPayment.id);
    const recommendedAmount = Math.abs(Number(refundPayment.amount || 0));
    // Only a policy/claim review row can be decided. A failed provider refund
    // is simply owed, so it is released as it stands.
    const kind: ManualRefundKind =
      refundPayment.payment_method === "manual_review"
        ? classifyManualRefund(refundPayment.notes)
        : "automatic_refund_failed";

    const decision = decideRefund({
      kind,
      bookingStatus: refundPayment.bookings.status,
      recommended: recommendedAmount,
      requested: requestedAmount,
      available: capacity.available,
      reservedByOtherRefunds: capacity.reservedByOtherRefunds,
      reason: payload.reason,
    });
    if (!decision.ok) {
      return jsonResponse(
        {
          error:
            decision.code === "over_capacity"
              ? `${decision.error} Collected ${peso(capacity.collected)}, already refunded ${peso(capacity.refunded)}. Cancel this row instead if it was superseded by a full refund.`
              : decision.error,
        },
        decision.code === "over_capacity" ? 409 : 400,
      );
    }
    const finalAmount = decision.amount;
    const changedByDecision = decision.decision !== "as_recommended";

    // A refund of PHP 0 - the fee used up everything the renter paid, or the
    // super admin denied it - has nothing to send back, so there is no
    // GCash/Maya transfer to record. It used to demand a reference anyway and
    // then fail in the ledger after the row was already marked completed, and a
    // completed row has no button, so the lister's compensation below was
    // stranded. Settling it is still the super admin's click: that click
    // releases the compensation.
    const noRefundDue = Math.round(finalAmount * 100) === 0;
    // A manual transfer needs a destination; a provider refund does not, because
    // it goes back through the original payment. So these are required only once
    // SafeDrive has answered that the provider cannot carry this one.
    const manualTransfer = payload.manualTransfer === true;
    if (!noRefundDue && manualTransfer && (!refundMethod || !referenceNumber)) {
      return jsonResponse(
        {
          error:
            "Refund payment, GCash/Maya return method, and reference number are required.",
        },
        400,
      );
    }

    const decisionLine = !changedByDecision
      ? null
      : decision.decision === "denied"
        ? `Decision: no refund, instead of the recommended ${peso(recommendedAmount)}. Reason: ${decision.reason}`
        : `Decision: ${peso(finalAmount)} refunded instead of the recommended ${peso(recommendedAmount)}. Reason: ${decision.reason}`;
    const notes = [
      noRefundDue
        ? decision.decision === "denied"
          ? "Settled by super admin: refund denied after review."
          : "Settled by super admin: no refund was due under the cancellation policy."
        : `Refund released by super admin through ${refundMethod}.`,
      decisionLine,
      note,
    ]
      .filter(Boolean)
      .join(" ");

    // Back to the account the money came from, wherever the provider can carry
    // it. PayMongo refunds against the original payment, so the destination is
    // the one the renter actually paid from - SafeDrive never has to ask for a
    // wallet number, and the admin never has to choose one. The automatic path
    // could not do this for a policy decision because it only ever refunds a
    // whole captured payment; this sends the decided amount instead.
    let providerRefundId: string | null = null;
    let providerPending = false;
    let providerMethodLabel: string | null = null;

    if (!noRefundDue && !manualTransfer && refundPayment.payment_method === "manual_review") {
      const attempt = await releaseDecidedRefundToSource({
        supabase,
        bookingId: refundPayment.booking_id,
        refundPaymentId: refundPayment.id,
        amount: finalAmount,
        actorId: user.id,
        note: decisionLine ?? note ?? null,
      });

      // Someone released this refund first. Offering a manual transfer here
      // would invite a second, real payment for money that may already be on
      // its way, so this one only sends the admin back to look.
      if (attempt.state === "stale") {
        return jsonResponse(
          {
            error: `${attempt.reason} Refresh Financial Reviews and check this refund before doing anything else.`,
          },
          409,
        );
      }

      if (attempt.state === "unavailable" || attempt.state === "failed") {
        // Nothing was changed. The admin is told why, and only then are the
        // manual fields asked for - so a manual transfer is always a decision
        // someone made, never the default.
        return jsonResponse(
          {
            error: `${attempt.reason} Send the refund manually, then record the method and reference here.`,
            needsManualTransfer: true,
            reason: attempt.reason,
          },
          409,
        );
      }

      providerRefundId = attempt.refundId;
      providerPending = attempt.state === "pending";
      providerMethodLabel = attempt.method;
    }

    // A provider refund has already rewritten this row - status, amount,
    // reference and note - under its own guard, so the manual update below runs
    // only for a PHP 0 settlement or a transfer the admin sent themselves.
    if (!providerRefundId) {
      let releaseRefundQuery = supabase
        .from("payments")
        .update({
          status: "completed",
          amount: noRefundDue ? 0 : -Math.abs(finalAmount),
          payment_method: noRefundDue ? "No refund due" : refundMethod,
          // No transfer means no reference, and reconciliation only expects a
          // ledger journal for a completed refund that carries one.
          transaction_id: noRefundDue ? null : referenceNumber,
          notes,
        })
        .eq("id", refundPayment.id)
        .eq("payment_type", "refund")
        .eq("status", refundPayment.status)
        // The amount decided on is the amount this row still held when the
        // review was opened - a row changed in between is refused below.
        .eq("amount", refundPayment.amount);

      releaseRefundQuery = refundPayment.payment_method
        ? releaseRefundQuery.eq("payment_method", refundPayment.payment_method)
        : releaseRefundQuery.is("payment_method", null);

      releaseRefundQuery = refundPayment.transaction_id
        ? releaseRefundQuery.eq("transaction_id", refundPayment.transaction_id)
        : releaseRefundQuery.is("transaction_id", null);

      const { data: manualRefundStateChanged, error: updateError } =
        await releaseRefundQuery.select("id").maybeSingle();

      if (updateError) throw updateError;

      if (!manualRefundStateChanged) {
        return jsonResponse(
          {
            error:
              "This refund changed state before it could be marked released. Please refresh and try again.",
          },
          409,
        );
      }
    }

    // This is the terminal path for EVERY manual-review refund - short-notice
    // cancellations, renter no-show, balance-deadline auto-cancel, unapplied
    // payments - and it previously wrote no journal at all. The money left the
    // business, the payment row said completed, and the ledger still carried
    // the refund payable, so run-reconciliation.ts raised a permanent critical
    // that nothing could clear (sync-paymongo-refund.ts can't help: it only
    // handles paymongo rows with a `ref_` transaction id).
    //
    // The event key is `refund:<transaction_id>`, which is exactly what
    // reconciliation looks for, and posting is idempotent on that key - so a
    // retry after a transient failure cannot double-post. It posts the amount
    // actually decided, so the lister's compensation below is what is left.
    // Only for a transfer the admin sent themselves: a provider refund posts
    // its own journal when PayMongo confirms it, and a pending one has not
    // moved money yet, so posting here would book a refund twice.
    if (!providerRefundId && !noRefundDue && referenceNumber) {
      await postCompletedRefundToLedger(supabase, {
        bookingId: refundPayment.booking_id,
        amount: finalAmount,
        refundId: referenceNumber,
        actorId: user.id,
      });
    }

    // A refund still travelling through PayMongo is not finished, so its case
    // stays open until the provider confirms it (Sync PayMongo Status).
    if (!providerPending) {
      await supabase
        .from("support_tickets")
        .update({ status: "closed" })
        .eq("booking_id", refundPayment.booking_id)
        .eq("tag", "manual_refund");
    }

    const vehicle = getVehicleLabel(refundPayment);
    const baseOrigin = new URL(req.url).origin;
    const renterNotice = noRefundDue
      ? decision.decision === "denied"
        ? {
            title: "Refund Decision",
            message: `SafeDrive reviewed the refund for ${vehicle} and decided that no refund is due. Reason: ${decision.reason}`,
            type: "info",
          }
        : {
            title: "Cancellation Settled",
            message: `No refund was due for ${vehicle} under the cancellation policy - the fee covered what was paid.`,
            type: "info",
          }
      : providerPending
        ? {
            // Nothing to ask the renter for: it is going back where it came from.
            title: "Refund On The Way",
            message: `Your SafeDrive refund of ${peso(finalAmount)} for ${vehicle} is on its way back to the payment method you used at checkout. Reference: ${providerRefundId}.${
              changedByDecision
                ? ` SafeDrive reviewed the case and changed it from the recommended ${peso(recommendedAmount)}. Reason: ${decision.reason}`
                : ""
            }`,
            type: "info",
          }
        : {
            title: "Refund Released",
            message: providerRefundId
              ? `Your SafeDrive refund of ${peso(finalAmount)} for ${vehicle} was returned to the payment method you used at checkout. Reference: ${providerRefundId}.${
                  changedByDecision
                    ? ` SafeDrive reviewed the case and changed it from the recommended ${peso(recommendedAmount)}. Reason: ${decision.reason}`
                    : ""
                }`
              : `Your SafeDrive refund of ${peso(finalAmount)} for ${vehicle} was marked released through ${refundMethod}. Reference: ${referenceNumber}.${
                  changedByDecision
                    ? ` SafeDrive reviewed the case and changed it from the recommended ${peso(recommendedAmount)}. Reason: ${decision.reason}`
                    : ""
                }`,
            type: "success",
          };

    await supabase.from("notifications").insert({
      user_id: refundPayment.bookings.renter_id,
      title: renterNotice.title,
      message: renterNotice.message,
      type: renterNotice.type,
      link: "/my-bookings",
    });

    // A changed or denied refund decides the lister's share too, so both sides
    // are told what was decided and why.
    if (changedByDecision) {
      const listerMessage = `SafeDrive reviewed the refund for ${vehicle}: the renter ${
        noRefundDue ? "was not refunded" : `was refunded ${peso(finalAmount)}`
      } instead of the recommended ${peso(recommendedAmount)}. Reason: ${decision.reason}`;
      await supabase.from("notifications").insert({
        user_id: refundPayment.bookings.owner_id,
        title: "Refund decision on your booking",
        message: listerMessage,
        type: "info",
        link: "/lister-bookings",
      });
      await Promise.all([
        sendUserNotificationEmail(supabase, {
          userId: refundPayment.bookings.renter_id,
          title: renterNotice.title,
          message: renterNotice.message,
          link: "/my-bookings",
          baseOrigin,
          eventKey: `refund-decision:${refundPayment.id}`,
        }),
        sendUserNotificationEmail(supabase, {
          userId: refundPayment.bookings.owner_id,
          title: "Refund decision on your booking",
          message: listerMessage,
          link: "/lister-bookings",
          baseOrigin,
          eventKey: `refund-decision:${refundPayment.id}`,
        }),
      ]).catch((emailError) => console.warn("Refund decision email was not delivered", emailError));
    } else if (noRefundDue) {
      // A PHP 0 settlement has no refund receipt, so without this the renter
      // would learn by email of every refund except the one that returned nothing.
      await sendUserNotificationEmail(supabase, {
        userId: refundPayment.bookings.renter_id,
        title: renterNotice.title,
        message: renterNotice.message,
        link: "/my-bookings",
        baseOrigin,
        eventKey: `refund-decision:${refundPayment.id}`,
      }).catch((emailError) => console.warn("Refund settlement email was not delivered", emailError));
    }

    // A receipt is proof the money went back, so it waits for the provider to
    // confirm. A pending refund gets the notice above instead.
    const receiptReference = providerRefundId ?? referenceNumber;
    const receiptMethod = providerMethodLabel ?? refundMethod;
    if (!noRefundDue && !providerPending && receiptMethod && receiptReference) {
      const receipt = await sendRefundReceiptEmail(supabase, {
        bookingId: refundPayment.booking_id,
        amount: finalAmount,
        refundId: receiptReference,
        refundMethod: receiptMethod,
        baseOrigin,
      });
      if (receipt.state !== "sent" && receipt.state !== "not_configured") {
        console.warn("Refund receipt email was not delivered", {
          state: receipt.state,
          bookingId: refundPayment.booking_id,
        });
      }
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "refund_marked_manual",
      entity_type: "payment",
      entity_id: refundPayment.id,
      details: {
        amount: finalAmount,
        recommended_amount: recommendedAmount,
        decision: decision.decision,
        decision_reason: decision.reason,
        review_kind: kind,
        review_kind_label: MANUAL_REFUND_KINDS[kind].label,
        refund_method: providerMethodLabel ?? refundMethod,
        reference_number: providerRefundId ?? referenceNumber,
        booking_id: refundPayment.booking_id,
        // Which road the money took, so a later reader can tell a refund that
        // went back to its source from one an admin sent by hand.
        mode: noRefundDue
          ? "no_refund_due"
          : providerRefundId
            ? providerPending
              ? "provider_pending"
              : "provider_returned_to_source"
            : "manual",
      },
    });

    // One decision settles both sides of a short-notice cancellation: the
    // renter's share above, and here whatever the ledger still holds as owed to
    // the lister, with no commission because the trip never happened. It only
    // acts on a cancelled booking with something left over, so a lister-side
    // cancellation (full refund) is left alone. A failure here does not undo
    // the renter's refund - it is reported back, and repeating the release
    // retries only this half.
    let compensation: CompensationResult | { state: "failed"; reason: string };
    try {
      compensation = await releaseCancellationCompensation(supabase, {
        bookingId: refundPayment.booking_id,
        actorId: user.id,
        baseOrigin,
      });
    } catch (compensationError) {
      console.error("Short-notice compensation was not released", compensationError);
      compensation = {
        state: "failed",
        reason:
          compensationError instanceof Error
            ? compensationError.message
            : "Short-notice compensation could not be released",
      };
    }

    return jsonResponse({
      success: true,
      // A provider refund that PayMongo has not confirmed yet is not finished:
      // the row stays pending and "Sync PayMongo Status" closes it out.
      state: providerPending ? "pending" : "completed",
      paymentId: refundPayment.id,
      transactionId: providerRefundId ?? referenceNumber,
      amount: finalAmount,
      decision: decision.decision,
      // True when the money went back through the original payment, so the UI
      // can say where it landed instead of naming a method someone chose.
      returnedToSource: Boolean(providerRefundId),
      method: providerMethodLabel ?? refundMethod,
      compensation,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected manual refund error",
      },
      500,
    );
  }
}
