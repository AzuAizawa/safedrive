// A lister's statistics for one period: the totals, the booking mix, a bar per
// month and a row per vehicle, plus the same rows as a CSV.
//
// One period drives all of it, as on the admin's Earnings page, so the figures
// never describe different spans of time. A booking belongs to the period its
// pickup day falls in. A vehicle belongs to a period it was on SafeDrive for at
// some point - listed on or before the last day and not deleted before the
// first - or that it had a booking in. So a car added in October and deleted in
// November appears for October and is gone from the present.
//
// Kept free of React and Supabase so it is proved on its own in
// scripts/lister-statistics.test.mjs.
import { manilaToday, type PeriodRange } from "./earningsPeriod";

export type StatsSection = "incoming" | "active" | "completed" | "issues" | "other";

export type StatsBooking = {
  id: string;
  car_id: string;
  start_date: string;
  base_price: number | string | null;
  commission: number | string | null;
  /** Where the booking stands, as the bookings list sorts it. */
  section: StatsSection;
  /** Waiting on the renter's payment. */
  awaitingPayment: boolean;
  completed: boolean;
};

export type StatsCar = {
  id: string;
  label: string;
  plate_number: string;
  created_at: string;
  deleted_at: string | null;
};

export type VehicleRow = {
  id: string;
  label: string;
  /** Empty for a deleted car: its plate was erased (CHAPTER 120). */
  plate: string;
  /** Manila day the car was deleted, or null while it is listed. */
  deletedOn: string | null;
  bookings: number;
  completed: number;
  issues: number;
  payout: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const payoutOf = (booking: StatsBooking) =>
  Number(booking.base_price || 0) - Number(booking.commission || 0);

const dayOf = (timestamp: string) => manilaToday(new Date(timestamp));

const monthKeys = (fromMonth: string, toMonth: string) => {
  const keys: string[] = [];
  let [year, month] = fromMonth.split("-").map(Number);
  const [endYear, endMonth] = toMonth.split("-").map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
};

export function buildListerStatistics(input: {
  bookings: StatsBooking[];
  cars: StatsCar[];
  range: PeriodRange;
}) {
  const { range } = input;
  const bookings = input.bookings.filter((booking) => {
    const day = booking.start_date.slice(0, 10);
    return day >= range.from && day <= range.to;
  });

  const statusBuckets = [
    { label: "Incoming", value: bookings.filter((b) => b.section === "incoming").length, color: "#f59e0b" },
    { label: "Payment", value: bookings.filter((b) => b.awaitingPayment).length, color: "#3b82f6" },
    { label: "Active", value: bookings.filter((b) => b.section === "active").length, color: "#10b981" },
    { label: "Completed", value: bookings.filter((b) => b.section === "completed").length, color: "#22c55e" },
    { label: "Issues", value: bookings.filter((b) => b.section === "issues").length, color: "#ef4444" },
  ];
  const mixTotal = Math.max(1, statusBuckets.reduce((sum, bucket) => sum + bucket.value, 0));
  let cursor = 0;
  const conicStops = statusBuckets
    .filter((bucket) => bucket.value > 0)
    .map((bucket) => {
      const start = cursor;
      cursor += (bucket.value / mixTotal) * 100;
      return `${bucket.color} ${start}% ${cursor}%`;
    })
    .join(", ");

  const completed = bookings.filter((booking) => booking.completed);
  const totalPayout = completed.reduce((sum, booking) => sum + payoutOf(booking), 0);
  const completionRate = bookings.length ? Math.round((completed.length / bookings.length) * 100) : 0;

  // A bar for every month of the period - from the first month anything
  // happened, so "All time" does not start in the year 2000.
  const firstActivity = [
    ...input.bookings.map((booking) => booking.start_date.slice(0, 10)),
    ...input.cars.map((car) => dayOf(car.created_at)),
  ]
    .filter(Boolean)
    .sort()[0];
  const fromDay = firstActivity && firstActivity > range.from ? firstActivity : range.from;
  const months = monthKeys(fromDay.slice(0, 7), range.to.slice(0, 7)).map((key) => {
    const [year, month] = key.split("-");
    const inMonth = completed.filter((booking) => booking.start_date.slice(0, 7) === key);
    return {
      key,
      label: `${MONTHS[Number(month) - 1]} ${year.slice(2)}`,
      bookings: bookings.filter((booking) => booking.start_date.slice(0, 7) === key).length,
      payout: inMonth.reduce((sum, booking) => sum + payoutOf(booking), 0),
    };
  });

  const bookedCars = new Set(bookings.map((booking) => booking.car_id));
  const vehicles: VehicleRow[] = input.cars
    .filter((car) => {
      const listed = dayOf(car.created_at) <= range.to;
      const stillThere = !car.deleted_at || dayOf(car.deleted_at) >= range.from;
      return (listed && stillThere) || bookedCars.has(car.id);
    })
    .map((car) => {
      const own = bookings.filter((booking) => booking.car_id === car.id);
      const done = own.filter((booking) => booking.completed);
      return {
        id: car.id,
        label: car.label,
        plate: car.plate_number.startsWith("DELETED-") ? "" : car.plate_number,
        deletedOn: car.deleted_at ? dayOf(car.deleted_at) : null,
        bookings: own.length,
        completed: done.length,
        issues: own.filter((booking) => booking.section === "issues").length,
        payout: done.reduce((sum, booking) => sum + payoutOf(booking), 0),
      };
    })
    .sort((a, b) => b.bookings - a.bookings || b.payout - a.payout || a.label.localeCompare(b.label));

  return {
    bookingCount: bookings.length,
    totalPayout,
    completionRate,
    statusBuckets,
    conicStops,
    months,
    maxMonthlyPayout: Math.max(1, ...months.map((month) => month.payout)),
    vehicles,
  };
}

export const LISTER_STATISTICS_HEADERS = [
  "Vehicle",
  "Plate",
  "Status in period",
  "Bookings",
  "Completed",
  "Issues",
  "Payout (PHP)",
];

/** One row per vehicle in the period, then the total. */
export const listerStatisticsCsvRows = (vehicles: VehicleRow[]) => [
  ...vehicles.map((vehicle) => [
    vehicle.label,
    vehicle.plate,
    vehicle.deletedOn ? `Deleted ${vehicle.deletedOn}` : "Listed",
    vehicle.bookings,
    vehicle.completed,
    vehicle.issues,
    vehicle.payout.toFixed(2),
  ]),
  [
    "Total",
    "",
    "",
    vehicles.reduce((sum, vehicle) => sum + vehicle.bookings, 0),
    vehicles.reduce((sum, vehicle) => sum + vehicle.completed, 0),
    vehicles.reduce((sum, vehicle) => sum + vehicle.issues, 0),
    vehicles.reduce((sum, vehicle) => sum + vehicle.payout, 0).toFixed(2),
  ],
];

