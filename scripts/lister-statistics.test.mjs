// A lister's statistics follow the period chosen, vehicles included: a car
// added in October and deleted in November is in October's figures and gone
// from the present.
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildListerStatistics,
  listerStatisticsCsvRows,
} from "../src/lib/listerStatistics.ts";

const cars = [
  { id: "x", label: "Toyota Vios", plate_number: "ABC 1234", created_at: "2026-05-02T02:00:00Z", deleted_at: null },
  { id: "z", label: "Honda City", plate_number: "DELETED-7f3a91c2", created_at: "2026-10-05T02:00:00Z", deleted_at: "2026-11-03T02:00:00Z" },
  { id: "y", label: "Ford Ranger", plate_number: "XYZ 999", created_at: "2026-11-20T02:00:00Z", deleted_at: null },
];

const booking = (id, car_id, start_date, section, extra = {}) => ({
  id,
  car_id,
  start_date,
  base_price: 2000,
  commission: 200,
  section,
  awaitingPayment: false,
  completed: section === "completed",
  ...extra,
});

const bookings = [
  booking("1", "x", "2026-10-10", "completed"),
  booking("2", "z", "2026-10-20", "completed"),
  booking("3", "z", "2026-10-25", "issues"),
  booking("4", "x", "2026-12-01", "incoming"),
];

const october = { from: "2026-10-01", to: "2026-10-31" };
const december = { from: "2026-12-01", to: "2026-12-31" };

test("car Z is in October's figures, with its bookings, marked as deleted", () => {
  const stats = buildListerStatistics({ bookings, cars, range: october });
  assert.deepEqual(stats.vehicles.map((v) => v.id), ["z", "x"]);
  const z = stats.vehicles[0];
  assert.equal(z.bookings, 2);
  assert.equal(z.completed, 1);
  assert.equal(z.issues, 1);
  assert.equal(z.payout, 1800);
  assert.equal(z.deletedOn, "2026-11-03");
  assert.equal(z.plate, "", "an erased plate is not shown");
  assert.equal(stats.totalPayout, 3600);
  assert.equal(stats.completionRate, 67);
  assert.equal(stats.bookingCount, 3);
});

test("car Z is gone from the present, and a car added later appears from then on", () => {
  const stats = buildListerStatistics({ bookings, cars, range: december });
  assert.deepEqual(stats.vehicles.map((v) => v.id).sort(), ["x", "y"]);
  assert.equal(stats.bookingCount, 1);
  assert.equal(stats.statusBuckets.find((b) => b.label === "Incoming").value, 1);
});

test("a car listed before the period with no bookings in it still shows, at zero", () => {
  const stats = buildListerStatistics({ bookings: [], cars, range: december });
  const x = stats.vehicles.find((v) => v.id === "x");
  assert.deepEqual([x.bookings, x.payout, x.deletedOn], [0, 0, null]);
});

test("the chart has a bar for every month, starting when anything first happened", () => {
  const stats = buildListerStatistics({ bookings, cars, range: { from: "2000-01-01", to: "2026-12-31" } });
  assert.equal(stats.months[0].key, "2026-05");
  assert.equal(stats.months.at(-1).key, "2026-12");
  assert.equal(stats.months.length, 8);
  assert.equal(stats.months.find((m) => m.key === "2026-10").payout, 3600);
});

test("the CSV has a row per vehicle and a total", () => {
  const stats = buildListerStatistics({ bookings, cars, range: october });
  const rows = listerStatisticsCsvRows(stats.vehicles);
  assert.deepEqual(rows[0], ["Honda City", "", "Deleted 2026-11-03", 2, 1, 1, "1800.00"]);
  assert.deepEqual(rows.at(-1), ["Total", "", "", 3, 2, 1, "3600.00"]);
});
