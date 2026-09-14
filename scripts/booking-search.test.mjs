// Searching your own bookings (My Bookings and Lister Bookings).
//
// A lister with many scheduled bookings types what they remember - a car, a
// plate, the renter's name, a reference, a date - and expects that one
// booking, not every booking that shares a digit with it.
import assert from "node:assert/strict";
import test from "node:test";

import { matchesBookingSearch } from "../src/lib/bookingSearch.ts";

// Dates at noon Philippine time, so the calendar day is the same in any
// timezone a test machine is likely to run in.
const vios = {
  id: "1a2b3c4d-0000-4000-8000-000000000000",
  startDate: "2026-09-20T12:00:00+08:00",
  endDate: "2026-09-22T12:00:00+08:00",
  carBrand: "Toyota",
  carModel: "Vios",
  plateNumber: "NNY 3609",
  location: "Dasmarinas, Cavite",
  counterpartName: "Juan Dela Cruz",
};

const earlySeptember = {
  ...vios,
  id: "9f8e7d6c-0000-4000-8000-000000000000",
  startDate: "2026-09-02T12:00:00+08:00",
  endDate: "2026-09-03T12:00:00+08:00",
  carModel: "Innova",
  plateNumber: "QRZ 990",
  counterpartName: "Maria Santos",
};

const finds = (query, booking = vios) => matchesBookingSearch(booking, query);

test("an empty search shows every booking", () => {
  assert.equal(finds(""), true);
  assert.equal(finds("   "), true);
});

test("the car, in any case, alone or with its brand", () => {
  assert.equal(finds("vios"), true);
  assert.equal(finds("TOYOTA"), true);
  assert.equal(finds("toyota vios"), true, "two words that live in two fields");
  assert.equal(finds("honda"), false);
});

test("every word must match, in any order", () => {
  assert.equal(finds("vios juan"), true);
  assert.equal(finds("juan vios"), true);
  assert.equal(finds("vios maria"), false, "right car, wrong renter");
});

test("the plate, with or without its space, whole or partly typed", () => {
  assert.equal(finds("NNY 3609"), true);
  assert.equal(finds("nny3609"), true);
  assert.equal(finds("3609"), true);
  assert.equal(finds("360"), true);
});

test("the booking reference printed on the card", () => {
  assert.equal(finds("SD-BK-1A2B3C4D"), true);
  assert.equal(finds("sd-bk-1a2b"), true);
  assert.equal(finds("SD-BK-9F8E7D6C"), false);
});

test("the other party's name and the pickup location", () => {
  assert.equal(finds("dela cruz"), true);
  assert.equal(finds("cavite"), true);
  assert.equal(finds("dasmarinas, cavite"), true, "a comma is not a word");
});

test("a date finds that day, not every day that shares a digit", () => {
  assert.equal(finds("sep 20"), true, "the start date");
  assert.equal(finds("sep 22"), true, "the end date");
  assert.equal(finds("september"), true);
  assert.equal(finds("sep 20", earlySeptember), false, "20 is not the 20 in 2026");
  assert.equal(finds("sep 2", earlySeptember), true);
  assert.equal(finds("sep 2", vios), false, "nor the 2 in 20 or 22");
  assert.equal(finds("2026"), true, "a year may still be typed");
});

test("a booking with missing details is searched, not crashed on", () => {
  const sparse = {
    id: vios.id,
    startDate: "not a date",
    endDate: vios.endDate,
    carBrand: null,
    carModel: undefined,
    plateNumber: null,
    location: null,
    counterpartName: null,
  };
  assert.equal(finds("sep 22", sparse), true);
  assert.equal(finds("vios", sparse), false);
});
