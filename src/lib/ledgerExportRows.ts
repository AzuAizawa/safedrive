// Shaping money records into the rows an accountant's file needs.
//
// Kept free of the Supabase client so the shaping is proved on its own in
// scripts/process-logic.test.mjs - the pages fetch, this decides what each
// line says. Amounts arrive in centavos and leave as peso strings, because the
// ledger stores centavos and a bookkeeper works in pesos.

import { centavosToPesoCell, type CsvCell } from "./csvExport";

export type ExportJournal = {
  id: string;
  effective_at: string;
  event_type: string;
  event_key: string;
  booking_id: string | null;
  provider_reference: string | null;
  status: string;
  reversal_of: string | null;
  correction_reason: string | null;
};

export type ExportEntry = {
  journal_id: string;
  account_code: string;
  debit_centavos: number | string | null;
  credit_centavos: number | string | null;
  memo: string | null;
};

export const LEDGER_EXPORT_HEADERS = [
  "Date",
  "Record",
  "Booking",
  "Account code",
  "Account name",
  "Debit (PHP)",
  "Credit (PHP)",
  "Memo",
  "Provider reference",
  "Status",
  "Correction of",
  "Correction reason",
  "Event key",
];

/** `2026-09-17 20:45` in Manila, which is how the books are kept. */
export const manilaStamp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(parsed);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
};

/**
 * One line per ledger entry, carrying its journal's context on every line -
 * a bookkeeper filters and pivots a flat file, and a debit row that does not
 * say which booking or event it belongs to cannot be traced back.
 *
 * Journals are emitted in the order given; a journal whose entries are missing
 * still emits one line, so a record can never silently vanish from the file.
 */
export const buildLedgerExportRows = (
  journals: ExportJournal[],
  entries: ExportEntry[],
  accountNames: Record<string, string> = {},
): CsvCell[][] => {
  const byJournal = new Map<string, ExportEntry[]>();
  for (const entry of entries) {
    const list = byJournal.get(entry.journal_id);
    if (list) list.push(entry);
    else byJournal.set(entry.journal_id, [entry]);
  }

  const rows: CsvCell[][] = [];
  for (const journal of journals) {
    const journalEntries = byJournal.get(journal.id) ?? [];
    const context = [
      manilaStamp(journal.effective_at),
      journal.event_type.replace(/_/g, " "),
      journal.booking_id ?? "",
    ];
    const tail = [
      journal.provider_reference ?? "",
      journal.status,
      journal.reversal_of ?? "",
      journal.correction_reason ?? "",
      journal.event_key,
    ];

    if (!journalEntries.length) {
      rows.push([...context, "", "", "0.00", "0.00", "(no lines recorded)", ...tail]);
      continue;
    }

    for (const entry of journalEntries) {
      rows.push([
        ...context,
        entry.account_code,
        accountNames[entry.account_code] ?? "",
        centavosToPesoCell(entry.debit_centavos),
        centavosToPesoCell(entry.credit_centavos),
        entry.memo ?? "",
        ...tail,
      ]);
    }
  }
  return rows;
};

export const EARNINGS_EXPORT_HEADERS = [
  "Month",
  "Commission (PHP)",
  "Subscriptions (PHP)",
  "Total (PHP)",
];

/**
 * The monthly summary, plus a total line. This is SafeDrive's own income -
 * commission and subscriptions - and deliberately not the gross value of
 * bookings, which is mostly money held for listers rather than revenue.
 */
export const buildEarningsExportRows = (
  buckets: Array<{ label: string; commission: number; subscription: number }>,
): CsvCell[][] => {
  const rows = buckets.map((bucket) => [
    bucket.label,
    centavosToPesoCell(bucket.commission),
    centavosToPesoCell(bucket.subscription),
    centavosToPesoCell(bucket.commission + bucket.subscription),
  ]);
  const commission = buckets.reduce((total, bucket) => total + bucket.commission, 0);
  const subscription = buckets.reduce((total, bucket) => total + bucket.subscription, 0);
  rows.push([
    "Total",
    centavosToPesoCell(commission),
    centavosToPesoCell(subscription),
    centavosToPesoCell(commission + subscription),
  ]);
  return rows;
};
