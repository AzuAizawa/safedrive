// A short, receipt-style reference for a booking - meant to be read or
// quoted by a person (in a support chat, a dispute, a screenshot), unlike
// the full UUID stored in the database. Same "SD-<type>-<first 8 hex
// chars>" pattern already used for payment/refund receipt document numbers
// (MyBookingsPage.tsx's documentNo), just for bookings instead of payments.
//
// Not unique in the cryptographic sense (a UUID's first 8 hex chars could
// theoretically collide), but collisions are astronomically unlikely at this
// platform's scale and the full booking ID is always still the real key
// behind the scenes - this is a display convenience, not a lookup key.
export const getBookingReference = (bookingId: string): string =>
  `SD-BK-${bookingId.slice(0, 8).toUpperCase()}`;
