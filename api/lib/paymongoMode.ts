// Shared helpers for SafeDrive's demo "money movement" mode.
//
// This is a thesis / demo build: PayMongo stays in test mode permanently and
// real disbursements (payouts) and refunds are not available. When
// PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION=true and the secret key is a test
// key (or absent), SafeDrive records payouts, cancellation refunds, and
// security-deposit releases with the full ledger + notification + receipt trail
// but WITHOUT calling PayMongo. A live `sk_live_` key forces the real path.

export const isPayMongoTestKey = (secretKey: string | undefined) =>
  Boolean(secretKey?.startsWith("sk_test_"));

export const isDemoMoneyMovementEnabled = (secretKey: string | undefined) =>
  process.env.PAYMONGO_ENABLE_SANDBOX_PAYOUT_COMPLETION === "true" &&
  (!secretKey || isPayMongoTestKey(secretKey));
