// Turning admin money records into a file an accountant can open.
//
// SafeDrive does not file taxes and does not issue BIR-accredited receipts (the
// PDF receipts say so). What it owes a bookkeeper is the underlying record:
// complete for the period asked for, in pesos, and openable in Excel without
// mangling. The pure builder here is proved in scripts/process-logic.test.mjs;
// only `downloadCsv` touches the browser.

/** A cell as it should read in the file. Numbers stay unformatted for Excel. */
export type CsvCell = string | number | null | undefined;

/**
 * RFC 4180 quoting: wrap when the value carries a comma, a quote, a newline or
 * edge whitespace, and double any inner quote. A memo like
 * `Reverse lister payable, per review` would otherwise split into two columns.
 */
export const toCsvCell = (value: CsvCell) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const buildCsv = (headers: string[], rows: CsvCell[][]) =>
  [headers, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\r\n");

/** Centavos as a plain peso number: 123456 -> "1234.56". Excel reads it as a number. */
export const centavosToPesoCell = (centavos: number | string | null | undefined) => {
  const value = Number(centavos ?? 0);
  if (!Number.isFinite(value)) return "0.00";
  return (Math.round(value) / 100).toFixed(2);
};

/** `safedrive-ledger-2026-09-01_2026-09-30.csv` - the period is in the name. */
export const csvFileName = (prefix: string, from: string, to: string) =>
  `safedrive-${prefix}-${from}_${to}.csv`;

/**
 * Hand the file to the browser. A byte-order mark is prepended because Excel on
 * Windows otherwise reads UTF-8 as the local codepage and turns a peso sign into
 * mojibake.
 *
 * The mark is a real U+FEFF character, held in this one named constant rather
 * than inline: `no-irregular-whitespace` skips string literals but flags
 * template literals, and naming it keeps the invisible character in a single
 * obvious place instead of scattered through the code that builds the file.
 */
const EXCEL_BOM = "﻿";

export const downloadCsv = (fileName: string, csv: string) => {
  const blob = new Blob([EXCEL_BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Let the click start the download before the blob is released.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
