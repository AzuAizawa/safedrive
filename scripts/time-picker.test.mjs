// The hour | minute | AM/PM time picker (pickup time, early return time).
//
// Three columns replace a 48-row list. What has to hold: every half hour is
// still reachable, a click never lands on a time the form refuses, and
// changing one column does not quietly scramble the other two.
import assert from "node:assert/strict";
import test from "node:test";

import {
  TIME_OPTIONS,
  isTimePartAvailable,
  pickTimeValue,
  splitTimeValue,
} from "../src/lib/timeOptions.ts";

test("a stored time splits into what the columns show", () => {
  assert.deepEqual(splitTimeValue("17:30"), { hour: 5, minute: "30", period: "PM" });
  assert.deepEqual(splitTimeValue("00:00"), { hour: 12, minute: "00", period: "AM" }, "midnight");
  assert.deepEqual(splitTimeValue("12:00"), { hour: 12, minute: "00", period: "PM" }, "noon");
  assert.equal(splitTimeValue(""), null);
  assert.equal(splitTimeValue("25:00"), null);
});

test("every half hour of the day is reachable in three clicks", () => {
  for (const option of TIME_OPTIONS) {
    const { hour, minute, period } = splitTimeValue(option.value);
    let value = pickTimeValue(TIME_OPTIONS, "", { hour });
    value = pickTimeValue(TIME_OPTIONS, value, { minute });
    value = pickTimeValue(TIME_OPTIONS, value, { period });
    assert.equal(value, option.value, option.label);
  }
});

test("one click on an hour already gives a valid time", () => {
  assert.equal(pickTimeValue(TIME_OPTIONS, "", { hour: 5 }), "05:00");
  assert.equal(pickTimeValue(TIME_OPTIONS, "", { period: "PM" }), "12:00");
});

test("changing one column keeps the other two", () => {
  assert.equal(pickTimeValue(TIME_OPTIONS, "17:30", { hour: 9 }), "21:30", "still :30 PM");
  assert.equal(pickTimeValue(TIME_OPTIONS, "17:30", { minute: "00" }), "17:00");
  assert.equal(pickTimeValue(TIME_OPTIONS, "17:30", { period: "AM" }), "05:30");
  assert.equal(pickTimeValue(TIME_OPTIONS, "12:30", { period: "AM" }), "00:30", "12 PM to 12 AM");
});

// An early return requested today at 3 PM, due back at 8:30 PM: only 3:30 PM
// to 8:00 PM may be chosen.
const earlyReturn = TIME_OPTIONS.filter((o) => o.value > "15:00" && o.value < "20:30");

test("a restricted day: past and too-late times cannot be clicked", () => {
  assert.equal(isTimePartAvailable(earlyReturn, "", { period: "AM" }), false, "the morning is over");
  assert.equal(isTimePartAvailable(earlyReturn, "", { hour: 9 }), false, "9 PM is past the return");
  assert.equal(isTimePartAvailable(earlyReturn, "", { hour: 8 }), true, "8:00 PM is fine");
  assert.equal(isTimePartAvailable(earlyReturn, "15:30", { minute: "00" }), false, "3:00 PM has passed");
  assert.equal(isTimePartAvailable(earlyReturn, "16:30", { minute: "00" }), true);
});

test("a restricted day: a click moves to the nearest time still allowed", () => {
  assert.equal(pickTimeValue(earlyReturn, "", { hour: 5 }), "17:00", "5 means 5 PM here");
  assert.equal(pickTimeValue(earlyReturn, "15:30", { hour: 4 }), "16:30");
  assert.equal(pickTimeValue(earlyReturn, "20:00", { hour: 3 }), "15:30", "3:00 PM has passed");
});

test("a click never lands outside the allowed times", () => {
  const allowed = new Set(earlyReturn.map((o) => o.value));
  for (const current of ["", ...earlyReturn.map((o) => o.value)]) {
    for (const change of [
      ...[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((hour) => ({ hour })),
      { minute: "00" }, { minute: "30" }, { period: "AM" }, { period: "PM" },
    ]) {
      const value = pickTimeValue(earlyReturn, current, change);
      assert.ok(value === null || allowed.has(value), `${current} + ${JSON.stringify(change)}`);
    }
  }
  assert.equal(pickTimeValue([], "", { hour: 5 }), null, "no time left on the day");
});
