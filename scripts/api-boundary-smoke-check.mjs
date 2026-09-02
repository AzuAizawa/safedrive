import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.SAFEDRIVE_API_TEST_BASE_URL || "http://127.0.0.1:4180";
let appServer;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const stopChild = async (child) => {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    wait(2_000),
  ]);
};

if (!process.env.SAFEDRIVE_API_TEST_BASE_URL) {
  const viteCli = path.join(repositoryRoot, "node_modules", "vite", "bin", "vite.js");
  appServer = spawn(process.execPath, [
    viteCli,
    "--host", "127.0.0.1",
    "--port", "4180",
    "--strictPort",
  ], {
    cwd: repositoryRoot,
    stdio: "ignore",
    windowsHide: true,
  });

  const deadline = Date.now() + 20_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    if (appServer.exitCode !== null) throw new Error(`Vite API test server exited with code ${appServer.exitCode}`);
    try {
      ready = (await fetch(baseUrl)).ok;
    } catch {
      // The local test server is still starting.
    }
    if (!ready) await wait(150);
  }
  if (!ready) {
    await stopChild(appServer);
    throw new Error(`Vite API test server did not become ready at ${baseUrl}`);
  }
}

const json = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const checks = [
  ["guest GET rejected", "/api/create-guest-inquiry", { method: "GET" }, 405],
  ["guest non-JSON rejected", "/api/create-guest-inquiry", { method: "POST", body: "not-json" }, 415],
  ["guest invalid fields rejected", "/api/create-guest-inquiry", json({ name: "A", email: "invalid", topics: [], message: "short" }), 400],
  ["guest honeypot safely ignored", "/api/create-guest-inquiry", json({ company: "automated-spam-field" }), 200],
  ["booking creation requires authentication", "/api/create-booking", json({}), 401],
  ["booking action requires authentication", "/api/booking-action", json({}), 401],
  ["guest reply requires authentication", "/api/reply-guest-inquiry", json({}), 401],
  ["verification decision email requires authentication", "/api/send-verification-decision-email", json({}), 401],
  ["vehicle decision email requires authentication", "/api/send-vehicle-decision-email", json({}), 401],
  ["support reply email requires authentication", "/api/send-support-ticket-reply-email", json({}), 401],
  ["reconciliation requires authentication", "/api/run-reconciliation", json({}), 401],
];

let failures = 0;
try {
  for (const [label, route, options, expectedStatus] of checks) {
    const response = await fetch(`${baseUrl}${route}`, options);
    if (response.status === expectedStatus) console.log(`[OK] ${label}: HTTP ${response.status}`);
    else {
      failures += 1;
      console.error(`[FAIL] ${label}: expected HTTP ${expectedStatus}, received ${response.status}`);
    }
  }
} finally {
  await stopChild(appServer);
}

if (failures) {
  console.error(`API boundary summary: ${failures} failure(s).`);
  process.exitCode = 1;
} else {
  console.log("API boundary summary: all checks passed.");
}
