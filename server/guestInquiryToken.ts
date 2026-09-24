// The secret a visitor's browser holds for an inquiry sent without an account.
// It stands in for the email a reply used to need: whoever holds it can read
// that one thread and follow up. Only its hash is stored (CHAPTER 107), so a
// leaked row does not hand anyone the thread.

const toHex = (buffer: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const GUEST_INQUIRY_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const createGuestInquiryToken = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

export const hashGuestInquiryToken = async (token: string) =>
  toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
