import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendCriticalWritePattern =
  /[.]from\("(?<table>bookings|payments|booking_extensions)"\)\s*[.]\s*(?<operation>insert|update|delete|upsert)\s*[(]/gs;

const checks = [
  {
    file: "src/components/ArrivalPhotoCapture.tsx",
    markers: [
      "Confirm Arrival Now",
      "Confirm With Location",
      "navigator.geolocation.getCurrentPosition",
      "ArrivalLocationEvidence",
    ],
  },
  {
    file: "api/booking-action.ts",
    markers: [
      "arrivalLocation",
      "normalizeArrivalLocation",
      "arrivalLocationStored",
      "fallbackPayload",
      "with an optional location check",
      "getCancellationRefundPlan",
      "renterLateCancellation",
      "short_notice_partial_policy",
      "renter refund must be handled regardless of the renter grace window",
      "existingRefundPayment",
      "payMongoRefundAlreadyPending",
      "Manual refund review cannot be created without a captured refundable amount.",
      "reusedExistingTicket",
      "ticket?.id && !reusedExistingTicket",
      "bookingStateChanged",
      "activatedByThisRequest",
      "completedByThisRequest",
      "Claim the cancellable booking row before starting refund work",
      "This booking changed state before arrival could be recorded",
      "This booking changed state before completion could be recorded",
      "fetchArrivalCheckinLeadHours",
      "Arrival check-in opens",
      "You can't finish a trip before it starts",
    ],
  },
  {
    file: "src/pages/admin/AdminPlatformSettingsPage.tsx",
    markers: [
      "arrival_checkin_lead_hours",
      "deposit_claim_window_hours",
      "lister_completion_timeout_hours",
      "apply live to every booking",
    ],
  },
  {
    file: "api/lib/bookingCompletion.ts",
    markers: [
      "runBookingCompletionSideEffects",
      "fetchDepositClaimWindowHours",
      "platform_commission_earned",
      "return_review",
    ],
  },
  {
    file: "api/lib/securityDeposit.ts",
    markers: [
      "runSecurityDepositRelease",
      "enforceClaimWindow",
      "The lister claim window is still open",
      "safedrive-deposit-refund-",
    ],
  },
  {
    file: "api/security-deposit-action.ts",
    markers: [
      "lister_confirm_return",
      "runSecurityDepositRelease",
      "security_deposit_lister_confirmed_return",
    ],
  },
  {
    file: "api/expire-booking-deadlines.ts",
    markers: [
      "owner_completion_auto_after_timeout",
      "lister_completion_timeout_hours",
      "runBookingCompletionSideEffects",
      "runSecurityDepositRelease",
      "depositAutoReleased",
    ],
  },
  {
    file: "api/submit-trip-condition-report.ts",
    markers: [
      'requiredCategories = ["front", "back", "odometer", "fuel_or_battery"]',
      "evidenceWaived",
      "optionalReading",
      "missing_photo_categories",
    ],
    absentMarkers: [
      '"front", "back", "left", "right", "interior", "odometer", "fuel_or_battery"',
    ],
  },
  {
    file: "api/booking-action.ts",
    markers: [
      "if (report.evidence_waived) return true;",
      "id, evidence_waived, trip_condition_photos(category)",
    ],
  },
  {
    file: "src/pages/TripConditionReportPage.tsx",
    markers: [
      "Required photos (4)",
      "optionalPhotos",
      "Submit without the",
      "evidenceWaived",
    ],
  },
  {
    file: "src/pages/MyBookingsPage.tsx",
    markers: [
      "Next step",
      "Trip progress",
      "Finish Trip",
      "Skip for now",
      "booking_reviews",
      "maybeSingle",
    ],
    absentMarkers: [
      "booking_reviews exists in the live schema but is not part of the generated types yet",
      "booking_reviews is added by a project migration and is not part of the generated Supabase type yet",
      "(supabase as any).from(\"booking_reviews\")",
    ],
    absentRegex: [
      "\\.from\\(\"booking_extensions\"\\)\\s*\\.\\s*(insert|update|delete)\\s*\\(",
    ],
  },
  {
    file: "src/pages/CarDetailPage.tsx",
    markers: [
      "/api/create-booking",
      "/api/create-car-inquiry",
      "getSession",
      "awaiting_payment",
    ],
    absentMarkers: [
      '.from("bookings").insert',
      "booking_created",
      "supabase as any",
    ],
    absentRegex: [
      "\\.from\\(\"bookings\"\\)\\s*\\.\\s*insert\\s*\\(",
    ],
  },
  {
    file: "src/pages/PaymentSuccessPage.tsx",
    markers: [
      "MAX_PAYMENT_CONFIRMATION_ATTEMPTS",
      "checkBookingPaymentConfirmation",
      "checkSubscriptionConfirmation",
      "booking_extensions",
      "extension_id",
      "Payment Still Confirming",
      "PayMongo sent you back to SafeDrive, but",
    ],
    absentMarkers: [
      "Payment Successful!",
    ],
  },
  {
    file: "api/create-booking.ts",
    markers: [
      "server_authoritative",
      "platform_settings",
      "ACTIVE_BOOKING_STATUSES",
      "Booking dates must stay within the next 30 days",
      "Selected dates overlap with an existing booking",
    ],
  },
  {
    file: "api/booking-extension-action.ts",
    markers: [
      "getSupabaseAdmin",
      "extensionAmount",
      "totalAdditionalAmount",
      "booking_extension_requested",
      "booking_extension_approved",
      "extensionStateChanged",
      "This extension request changed state before",
    ],
  },
  {
    file: "api/create-booking-extension-checkout.ts",
    markers: [
      "getSupabaseAdmin",
      "booking-extension:",
      "extension_id=",
      "checkoutStateSaved",
      "total_additional_amount",
      "paymongo_checkout_id",
    ],
  },
  {
    file: "api/create-checkout.ts",
    markers: [
      "checkoutStateSaved",
      "This booking changed state before checkout could be saved",
      "reservation payment deadline has passed",
    ],
  },
  {
    file: "api/expire-booking-deadlines.ts",
    markers: [
      "CRON_SECRET must be configured",
      "owner_response_expired",
      "payment_expired",
      "owner_response_deadline",
      "payment_deadline",
    ],
  },
  {
    file: "api/create-car-inquiry.ts",
    markers: [
      "You cannot inquire about your own listing",
      "support_tickets",
      "ticket_messages",
      "car_inquiry_sent",
    ],
  },
  {
    file: "api/create-balance-checkout.ts",
    markers: [
      "checkoutStateSaved",
      "This booking changed state before balance checkout could be saved",
    ],
  },
  {
    file: "api/lib/payoutAutomation.ts",
    markers: [
      "PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION",
      "isPayMongoTestKey",
      "Demo payout completion refuses non-test PayMongo keys",
      "so no payout was sent",
      "payout_sandbox_completed",
      "Lister payout recorded (demo mode)",
      "payout:${sandboxTransactionId}",
      "PAYMONGO_PAYOUT_WALLET_ID",
      "createBatchTransfer",
      "ActivePayoutExistsError",
      "An active payout was created by another request",
    ],
  },
  {
    file: "api/webhooks/paymongo-payouts.ts",
    markers: [
      "payout_callback_ignored_terminal_state",
      "completed_unchanged",
      "failed_unchanged",
    ],
  },
  {
    file: "api/webhooks/paymongo.ts",
    markers: [
      "insertCompletedPaymentIfMissing",
      "Downpayment webhook payment row existed but booking state was already claimed",
      "Balance webhook payment row existed but booking state was already claimed",
      "Full-payment webhook payment rows existed but booking state was already claimed",
      "Extension webhook payment row existed but extension state was already claimed",
      "Duplicate subscription webhook found an already-active subscription",
    ],
  },
  {
    file: "api/lib/refundAutomation.ts",
    markers: [
      "Source transaction IDs",
      "A PayMongo refund is already pending for this booking",
      "getAppRefundStatus",
      "booking_refund_failed_auto",
    ],
  },
  {
    file: "api/mark-manual-refund.ts",
    markers: [
      "GCash/Maya return method",
      "A PayMongo refund is already pending",
      "Wait for provider confirmation",
      "manualRefundStateChanged",
      "This refund changed state before it could be marked released",
    ],
    absentMarkers: [
      'normalized === "paymongo"',
      "return \"PayMongo\"",
    ],
  },
  {
    file: "src/pages/ListerBookingsPage.tsx",
    markers: [
      "Next step",
      "Trip progress",
      "Finish Trip",
      "Skip for now",
      "booking_reviews",
      "maybeSingle",
    ],
    absentMarkers: [
      "booking_reviews exists in the live schema but is not part of the generated types yet",
      "booking_reviews is added by a project migration and is not part of the generated Supabase type yet",
      "(supabase as any).from(\"booking_reviews\")",
    ],
    absentRegex: [
      "\\.from\\(\"booking_extensions\"\\)\\s*\\.\\s*(insert|update|delete)\\s*\\(",
    ],
  },
  {
    file: "src/types/database.ts",
    markers: [
      "booking_reviews",
      "export type BookingReview",
      "booking_reviews_booking_id_fkey",
    ],
  },
  {
    file: "src/pages/admin/AdminSupportTicketsPage.tsx",
    markers: [
      "Linked booking arrival timeline",
      "Renter check-in",
      "Lister check-in",
      "getMapUrl",
    ],
    absentMarkers: [
      "supabase as any",
      "no-explicit-any",
    ],
  },
  {
    file: "src/pages/admin/AdminRefundReviewPage.tsx",
    markers: [
      "Refund Review",
      "Retry PayMongo",
      "Mark Manual Released",
      "bookings(",
      "Provider refund failed",
      "GCash/Maya reference",
      "Refund retry skipped",
      "getRefundRetryToastCopy",
    ],
    absentMarkers: [
      "supabase as any",
      "no-explicit-any",
      '<option value="PayMongo">PayMongo</option>',
    ],
  },
  {
    file: "src/pages/SupportTicketsPage.tsx",
    markers: [
      "support_tickets",
      "ticket_messages",
      "serializeTicketTags",
    ],
    absentMarkers: [
      "SupportDb",
      "SupportTable",
      "supabase as any",
    ],
  },
  {
    file: "src/pages/admin/AdminDashboard.tsx",
    markers: [
      "Admin Work Center",
      "Profiles to verify",
      "Vehicles to approve",
      "Support needing reply",
      "Guest inquiries",
      "isSuperAdmin",
      "Payout attention",
      "Deposit review",
      "Oldest waiting",
    ],
  },
  {
    file: "src/pages/admin/AdminPayoutsPage.tsx",
    markers: [
      "Payouts are released entirely in-app",
      "no admin ever sends money by hand outside SafeDrive",
      "a payout skips instead of marking money released",
      "net of the SafeDrive commission",
      "describePayoutRelease",
      "Released via",
    ],
    absentMarkers: [
      "openManualPayout",
      "markManualPayoutPaid",
      "/api/mark-manual-payout",
      "Manual Paid",
    ],
  },
  {
    file: "database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql",
    markers: [
      "renter_arrival_latitude",
      "renter_arrival_longitude",
      "lister_arrival_latitude",
      "lister_arrival_longitude",
    ],
  },
  {
    file: "database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql",
    markers: [
      'drop policy if exists "Renters can create bookings"',
      'drop policy if exists "Participants insert payments"',
      'drop policy if exists "Participants can update booking extensions"',
    ],
  },
  {
    file: "database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql",
    markers: [
      "bookings_no_active_date_overlap",
      "exclude using gist",
      "daterange(start_date, end_date, '[]')",
      "'awaiting_payment'",
    ],
  },
  {
    file: "database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql",
    markers: [
      "payments_one_active_payout_per_booking",
      "payment_type = 'payout'",
      "status in ('pending', 'completed')",
    ],
  },
  {
    file: "database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql",
    markers: [
      "payments_one_completed_checkout_event",
      "payment_type in ('downpayment', 'balance', 'extension', 'security_deposit')",
      "transaction_id is not null",
    ],
  },
  {
    file: "database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql",
    markers: [
      "subscriptions_one_active_plan_per_user",
      "where status = 'active'",
    ],
  },
  {
    file: "database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql",
    markers: [
      "protect_car_submission_fields",
      "Listers cannot change vehicle approval status",
      "Active booking participants can read meetup verification images",
      "Users can insert own notifications",
      "Users can create own unassigned tickets",
      "notify_admins_of_vehicle_submission",
      "notify_admins_of_pending_verification",
    ],
  },
];

const failures = [];

const collectSourceFiles = (directory) => {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
};

for (const filePath of collectSourceFiles(path.join(rootDir, "src"))) {
  const relativePath = path.relative(rootDir, filePath);
  const contents = fs.readFileSync(filePath, "utf8");
  for (const match of contents.matchAll(frontendCriticalWritePattern)) {
    failures.push(
      `${relativePath}: frontend must not ${match.groups.operation} ${match.groups.table}; route critical booking/payment writes through API handlers`,
    );
  }
}

for (const check of checks) {
  const filePath = path.join(rootDir, check.file);
  if (!fs.existsSync(filePath)) {
    failures.push(`${check.file}: file is missing`);
    continue;
  }

  const contents = fs.readFileSync(filePath, "utf8");
  for (const marker of check.markers) {
    if (!contents.includes(marker)) {
      failures.push(`${check.file}: missing marker "${marker}"`);
    }
  }

  for (const marker of check.absentMarkers ?? []) {
    if (contents.includes(marker)) {
      failures.push(`${check.file}: forbidden marker "${marker}" is present`);
    }
  }

  for (const pattern of check.absentRegex ?? []) {
    const regex = new RegExp(pattern, "s");
    if (regex.test(contents)) {
      failures.push(`${check.file}: forbidden pattern /${pattern}/ is present`);
    }
  }
}

if (failures.length > 0) {
  console.error("Booking flow smoke check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Booking flow smoke check passed.");
