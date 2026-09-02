import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const suppliedBaseUrl = process.env.SAFEDRIVE_BROWSER_BASE_URL;
const baseUrl = suppliedBaseUrl || "http://127.0.0.1:4173";
const port = Number(process.env.SAFEDRIVE_CDP_PORT || 9333);
const candidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const browserPath = process.env.SAFEDRIVE_BROWSER_PATH || candidates.find(fs.existsSync);
if (!browserPath) throw new Error("Chrome or Edge was not found; set SAFEDRIVE_BROWSER_PATH");

let appServer;
if (!suppliedBaseUrl) {
  const viteCli = path.join(repositoryRoot, "node_modules", "vite", "bin", "vite.js");
  appServer = spawn(process.execPath, [viteCli, "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
    cwd: repositoryRoot,
    stdio: "ignore",
    windowsHide: true,
  });

  const serverDeadline = Date.now() + 20_000;
  let serverReady = false;
  while (Date.now() < serverDeadline && !serverReady) {
    if (appServer.exitCode !== null) {
      throw new Error(`Vite preview exited before browser checks (code ${appServer.exitCode})`);
    }
    try {
      const response = await fetch(baseUrl);
      serverReady = response.ok;
    } catch {
      // Preview startup is still in progress.
    }
    if (!serverReady) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!serverReady) {
    appServer.kill();
    throw new Error(`Vite preview did not become ready at ${baseUrl}`);
  }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "safedrive-browser-smoke-"));
const browser = spawn(browserPath, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--no-first-run",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const stopChild = async (child) => {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    wait(2_000),
  ]);
};
const deadline = Date.now() + 15_000;
let target;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    target = targets.find((item) => item.type === "page");
    if (target?.webSocketDebuggerUrl) break;
  } catch {
    // Browser startup is still in progress.
  }
  await wait(150);
}
if (!target?.webSocketDebuggerUrl) {
  await stopChild(browser);
  await stopChild(appServer);
  throw new Error("The browser debugging endpoint did not start");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let commandId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++commandId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

const routes = [
  { path: "/", expectedPath: "/", text: "Rent real cars" },
  { path: "/contact", expectedPath: "/contact", text: "Ask SafeDrive a question" },
  { path: "/admin/login", expectedPath: "/admin/login", text: "Admin Authentication" },
  { path: "/Safedriveadminlogin", expectedPath: "/admin/login", text: "Admin Authentication" },
  { path: "/privacy-policy", expectedPath: "/privacy-policy", text: "Privacy Policy" },
  { path: "/terms", expectedPath: "/terms", text: "Terms" },
  { path: "/admin/guest-inquiries", expectedPath: "/admin/login", text: "Admin Authentication" },
  { path: "/admin/financial-reviews", expectedPath: "/admin/login", text: "Admin Authentication" },
];
const viewports = [
  { width: 375, height: 812, mobile: true, label: "mobile" },
  { width: 1366, height: 768, mobile: false, label: "desktop" },
];

try {
  await send("Page.enable");
  await send("Runtime.enable");
  for (const viewport of viewports) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });

    for (const route of routes) {
      await send("Page.navigate", { url: `${baseUrl}${route.path}` });
      await wait(2_000);
      const evaluated = await send("Runtime.evaluate", {
        expression: `(() => {
          const visible = (element) => element.getClientRects().length > 0;
          const nameOf = (element) => (element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || '').trim();
          return {
            path: location.pathname,
            innerWidth: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            bodyText: document.body.innerText,
            crashed: document.body.innerText.includes('React App Crashed'),
            unnamedControls: [...document.querySelectorAll('button, a[href]')].filter((element) => visible(element) && !nameOf(element) && !element.querySelector('img[alt]:not([alt=""])')).length,
            unlabeledInputs: [...document.querySelectorAll('input, select, textarea')].filter((element) => visible(element) && !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.getAttribute('title')).length,
            missingImageAlt: [...document.querySelectorAll('img')].filter((element) => visible(element) && !element.hasAttribute('alt')).length,
            h1Count: document.querySelectorAll('h1').length
          };
        })()`,
        returnByValue: true,
      });
      const result = evaluated.result.value;
      assert.equal(result.crashed, false, `${route.path} rendered the React crash boundary`);
      assert.equal(result.path, route.expectedPath, `${route.path} routed to ${result.path}`);
      assert.ok(result.bodyText.includes(route.text), `${route.path} did not render ${route.text}`);
      assert.ok(result.scrollWidth <= result.innerWidth + 1, `${route.path} overflows horizontally (${result.scrollWidth}px > ${result.innerWidth}px)`);
      assert.equal(result.unnamedControls, 0, `${route.path} has controls without accessible names`);
      assert.equal(result.unlabeledInputs, 0, `${route.path} has visible form fields without labels`);
      assert.equal(result.missingImageAlt, 0, `${route.path} has visible images without alt attributes`);
      assert.equal(result.h1Count, 1, `${route.path} should render exactly one primary heading`);
      console.log(`[OK] ${route.path} -> ${result.path} at ${result.innerWidth}px (${viewport.label})`);
    }
  }
} finally {
  socket.close();
  await stopChild(browser);
  await stopChild(appServer);
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`Browser checks passed, but temporary profile cleanup was deferred: ${error.message}`);
  }
}
