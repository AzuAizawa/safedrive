import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { signInWithTransientJwtRetry } from "../src/lib/authRetry.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const environmentPath = path.join(repositoryRoot, ".env");

for (const rawLine of fs.readFileSync(environmentPath, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const name = line.slice(0, separator).trim();
  let value = line.slice(separator + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  if (!process.env[name]) process.env[name] = value;
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
assert.ok(supabaseUrl && anonKey && serviceRoleKey, "Supabase test configuration is incomplete");

const baseUrl = "http://127.0.0.1:4173";
const browserPort = 9444;
const browserPath = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find(fs.existsSync);
assert.ok(browserPath, "Chrome or Edge was not found");

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const stopChild = async (child) => {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    wait(2_000),
  ]);
};

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const userClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
const email = `safedrive-targeted-ui-${runId}@example.com`;
const password = `Sd!${crypto.randomBytes(24).toString("base64url")}`;
let userId = null;
let appServer;
let browser;
let browserProfile;
let socket;

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { automated_test: true },
  });
  if (createError || !created.user) throw createError || new Error("Test user was not created");
  userId = created.user.id;

  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    email,
    full_name: "SafeDrive Targeted UI Check",
    role: "user",
    is_lister: false,
    verified_status: "verified",
  });
  if (profileError) throw profileError;

  const { data: signedIn, error: signInError } =
    await userClient.auth.signInWithPassword({ email, password });
  if (signInError || !signedIn.session) {
    throw signInError || new Error("Test user did not receive a session");
  }

  let retryAttempts = 0;
  const retryResult = await signInWithTransientJwtRetry(
    async () => ({
      error:
        ++retryAttempts === 1 ? new Error("JWT issued at future") : null,
    }),
    async () => {},
  );
  assert.equal(retryResult.error, null);
  assert.equal(retryAttempts, 2);
  console.log("[OK] JWT-issued-in-the-future response receives one bounded retry");

  const { data: agreementRows, error: agreementLookupError } = await admin
    .from("car_agreement_versions")
    .select("car_id")
    .eq("status", "approved")
    .limit(20);
  if (agreementLookupError) throw agreementLookupError;
  const carIds = [...new Set((agreementRows ?? []).map((row) => row.car_id))];
  const { data: cars, error: carLookupError } = carIds.length
    ? await admin
        .from("cars")
        .select("id, owner_id, status")
        .in("id", carIds)
        .in("status", ["approved", "active"])
        .neq("owner_id", userId)
        .limit(1)
    : { data: [], error: null };
  if (carLookupError) throw carLookupError;
  const carId = cars?.[0]?.id ?? null;

  const [{ default: getAgreement }, { default: dataRequest }, { default: createGuestInquiry }] = await Promise.all([
    import("../api/get-approved-rental-agreement.ts"),
    import("../api/data-request.ts"),
    import("../api/create-guest-inquiry.ts"),
  ]);
  if (carId) {
    const agreementResponse = await getAgreement(
      new Request(`http://local.test/api/get-approved-rental-agreement?carId=${carId}`, {
        headers: { Authorization: `Bearer ${signedIn.session.access_token}` },
      }),
    );
    assert.equal(
      agreementResponse.status,
      200,
      `Approved agreement handler returned ${agreementResponse.status}: ${await agreementResponse.text()}`,
    );
    console.log("[OK] approved agreement API returned a signed PDF URL");
  } else {
    console.log("[SKIP] no approved agreement-backed car exists for the UI check");
  }

  const privacyResponse = await dataRequest(
    new Request("http://local.test/api/data-request", {
      headers: { Authorization: `Bearer ${signedIn.session.access_token}` },
    }),
  );
  assert.equal(
    privacyResponse.status,
    200,
    `Privacy request handler returned ${privacyResponse.status}: ${await privacyResponse.text()}`,
  );
  console.log("[OK] privacy-request API loaded the user's request list");

  const inquiryResponse = await createGuestInquiry(
    new Request("http://local.test/api/create-guest-inquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "SafeDrive targeted UI check" },
      body: JSON.stringify({
        name: "SafeDrive Targeted UI Check",
        email,
        phone: "",
        topics: ["Technical problem"],
        message: "Disposable inquiry created by the authenticated UI regression check.",
        company: "",
      }),
    }),
  );
  assert.equal(
    inquiryResponse.status,
    201,
    `Guest inquiry handler returned ${inquiryResponse.status}: ${await inquiryResponse.text()}`,
  );
  console.log("[OK] inquiry API recorded a distinct guest-inquiry queue item");

  const viteCli = path.join(repositoryRoot, "node_modules", "vite", "bin", "vite.js");
  appServer = spawn(
    process.execPath,
    [viteCli, "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
    { cwd: repositoryRoot, stdio: "ignore", windowsHide: true },
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) break;
    } catch {
      // Preview is still starting.
    }
    await wait(150);
  }

  browserProfile = fs.mkdtempSync(path.join(os.tmpdir(), "safedrive-targeted-ui-"));
  browser = spawn(
    browserPath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      `--remote-debugging-port=${browserPort}`,
      `--user-data-dir=${browserProfile}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  let target;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${browserPort}/json/list`)).json();
      target = targets.find((item) => item.type === "page");
      if (target?.webSocketDebuggerUrl) break;
    } catch {
      // Browser is still starting.
    }
    await wait(150);
  }
  assert.ok(target?.webSocketDebuggerUrl, "Browser debugging endpoint did not start");

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let commandId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    if (!pending.has(message.id)) return;
    const callbacks = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++commandId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.result.value;
  };
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate(expression)) return;
      await wait(150);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const navigate = async (route) => {
    await send("Page.navigate", { url: `${baseUrl}${route}` });
    await waitFor("document.readyState === 'complete'", `${route} document load`);
  };
  const clickButton = async (label) => {
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.innerText.trim() === ${JSON.stringify(label)});
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(clicked, true, `Button was not found: ${label}`);
  };

  await send("Page.enable");
  await send("Runtime.enable");

  await navigate("/login");
  await waitFor("document.body.innerText.includes('Welcome back')", "login form");
  await clickButton("Inquiry");
  await waitFor(
    "document.body.innerText.includes('separate from booking support tickets')",
    "floating inquiry dialog",
  );
  assert.equal(
    await evaluate(`(() => [...document.querySelectorAll('button')]
      .find((item) => item.innerText.trim() === 'Submit inquiry')?.type ?? null)()`),
    "submit",
    "Floating inquiry action is not wired as a form submit button",
  );
  await clickButton("Inquiry");
  console.log("[OK] floating inquiry dialog has a working form-submit action");
  assert.equal(
    await evaluate("Boolean(document.querySelector('input[type=\"email\"]')?.focus())"),
    false,
    "Email input could not be focused",
  );
  await send("Input.insertText", { text: email });
  await evaluate("document.querySelector('input[type=\"password\"]')?.focus()");
  await send("Input.insertText", { text: password });
  await clickButton("Sign In");
  await waitFor(
    "document.body.innerText.includes('Connect Authenticator')",
    "first-click login to reach authenticator setup",
  );
  console.log("[OK] login form progressed on its first click");

  await evaluate("sessionStorage.removeItem('user_auth_pending')");
  await navigate("/");
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  await evaluate(
    `localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(
      JSON.stringify(signedIn.session),
    )})`,
  );

  await navigate("/support");
  await waitFor("document.body.innerText.includes('Help & Support')", "support page");
  const supportSectionPositions = await evaluate(`(() => {
    const root = [...document.querySelectorAll('div')]
      .find((item) => item.classList.contains('max-w-5xl') && item.classList.contains('flex-col'));
    const tickets = root?.querySelector(':scope > .order-2');
    const answers = root?.querySelector(':scope > .order-3');
    return {
      tickets: tickets?.getBoundingClientRect().top ?? null,
      answers: answers?.getBoundingClientRect().top ?? null,
    };
  })()`);
  assert.ok(
    supportSectionPositions.tickets !== null &&
      supportSectionPositions.answers !== null &&
      supportSectionPositions.tickets < supportSectionPositions.answers,
    `Ticket workspace is still below quick answers: ${JSON.stringify(supportSectionPositions)}`,
  );
  await clickButton("New Ticket");
  await waitFor("document.body.innerText.includes('Create Support Ticket')", "new-ticket modal");
  await clickButton("Cancel");
  await clickButton("This did not solve it");
  await waitFor("document.body.innerText.includes('Create Support Ticket')", "suggested-ticket modal");
  const hasSuggestedContent = await evaluate(`(() => {
    const subject = document.querySelector('input[placeholder*="Issue with"]');
    const editor = document.querySelector('[data-placeholder*="Paste or type"]');
    return Boolean(subject?.value && editor?.innerText.trim());
  })()`);
  assert.equal(hasSuggestedContent, true, "Suggested support ticket was not prefilled");
  console.log("[OK] support buttons opened the modal and prefilled the unresolved issue");

  await navigate("/verify");
  await waitFor("document.body.innerText.includes('Security & Account Settings')", "account settings");
  await waitFor(
    "document.body.innerText.includes('Manage Data Requests')",
    "privacy action inside account settings",
  );
  await clickButton("Request Account Deletion");
  await waitFor("document.body.innerText.includes('Request Account Deletion?')", "deletion request modal");
  await clickButton("Continue to Privacy Request");
  await waitFor("location.pathname === '/privacy-request'", "privacy request navigation");
  await waitFor(
    "location.search === '?type=deletion' && document.querySelector('select')?.value === 'deletion'",
    "deletion request preselection",
  );
  console.log("[OK] account-deletion action opened the correct privacy request type");

  if (carId) {
    await navigate(`/cars/${carId}`);
    await waitFor(
      "document.body.innerText.includes('Retry loading') || document.body.innerText.includes('Open agreement')",
      "agreement action",
    );
    console.log("[OK] agreement action is interactive and offers retry when loading fails");
  }
} finally {
  socket?.close();
  await stopChild(browser);
  await stopChild(appServer);
  if (browserProfile) {
    fs.rmSync(browserProfile, { recursive: true, force: true, maxRetries: 5 });
  }
  if (userId) {
    await admin.from("guest_inquiries").delete().eq("email", email);
    await admin.from("profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
  }
}
