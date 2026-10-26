// Every peso amount reads "₱1,200.00" (panel feedback: currency format for
// monetary values). The browser and server copies must stay the same file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { formatPeso, formatPesoFromCentavos } from "../server/money.ts";

test("the server and the browser use the same formatter", async () => {
  const [server, browser] = await Promise.all([
    readFile(new URL("../server/money.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/money.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(server.replace(/\r\n/g, "\n"), browser.replace(/\r\n/g, "\n"));
});

test("amounts always show the peso sign, separators and two decimals", () => {
  assert.equal(formatPeso(0), "₱0.00");
  assert.equal(formatPeso(1200), "₱1,200.00");
  assert.equal(formatPeso(1200.5), "₱1,200.50");
  assert.equal(formatPeso(1234567.891), "₱1,234,567.89");
  assert.equal(formatPeso("2500"), "₱2,500.00");
});

test("a negative amount puts the minus before the sign, and rounding never shows -₱0.00", () => {
  assert.equal(formatPeso(-180), "-₱180.00");
  assert.equal(formatPeso(-0.004), "₱0.00");
});

test("missing or broken values show ₱0.00 instead of NaN", () => {
  assert.equal(formatPeso(null), "₱0.00");
  assert.equal(formatPeso(undefined), "₱0.00");
  assert.equal(formatPeso("not a number"), "₱0.00");
});

test("centavo figures from the ledger are converted first", () => {
  assert.equal(formatPesoFromCentavos(719640), "₱7,196.40");
  assert.equal(formatPesoFromCentavos(0), "₱0.00");
});

test("the import-free copies (cancellation policy) format exactly like the shared helper", async () => {
  const server = await import("../server/cancellationPolicy.ts");
  const browser = await import("../src/lib/cancellationPolicy.ts");
  for (const amount of [0, 400, 1499.25, 2000, 1234567.891, -180]) {
    assert.equal(server.formatPeso(amount), formatPeso(amount));
    assert.equal(browser.formatPeso(amount), formatPeso(amount));
  }
});

test("no money is still shown the old way", async () => {
  const { execSync } = await import("node:child_process");
  // `PHP ${x.toLocaleString()}`, `PHP {x}` and `₱{x.toLocaleString()}` were the
  // old shapes. PayMongo's own currency code ("PHP") and CSV column headers
  // are not display amounts and are allowed, and so is the two-decimal body
  // the import-free mirrored files carry (checked below).
  let output = "";
  try {
    output = execSync(
      'git grep -nE "PHP \\$\\{|PHP \\{|₱\\$\\{[^}]*toLocaleString\\(\\)|₱\\{[^}]*toLocaleString\\(\\)" -- src server api',
      { encoding: "utf8", cwd: new URL("..", import.meta.url) },
    ).trim();
  } catch (error) {
    // git grep exits 1 when nothing matches - the result we want.
    if (error.status !== 1) throw error;
  }
  assert.equal(output, "", `old money formatting left:\n${output}`);
});
