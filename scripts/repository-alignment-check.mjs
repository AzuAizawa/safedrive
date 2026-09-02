import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const excludedDirectories = new Set([".git", "node_modules", "dist", "logs_and_outputs", "ETC ETC DO NOT UPLOAD TO GITHUB"]);
const textExtensions = new Set([".css", ".example", ".gs", ".html", ".js", ".json", ".md", ".mermaid", ".mjs", ".sql", ".ts", ".tsx"]);
const textNames = new Set([".gitignore", ".kilocodemodes"]);
const failures = [];
const scanned = [];

const relative = (file) => path.relative(root, file).replaceAll("\\", "/");

function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const isDirectory = entry.isDirectory() || (!entry.isFile() && fs.statSync(absolute).isDirectory());
    if (isDirectory && excludedDirectories.has(entry.name)) continue;
    if (isDirectory) output.push(...walk(absolute));
    else output.push(absolute);
  }
  return output;
}

function isReviewedText(file) {
  const name = path.basename(file);
  if (name === ".env") return false;
  return textNames.has(name) || textExtensions.has(path.extname(name).toLowerCase());
}

const fail = (message) => failures.push(message);
const allFiles = walk(root);
const textFiles = allFiles.filter(isReviewedText).sort();
const contentByFile = new Map();
let lineCount = 0;

for (const file of textFiles) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content === "" ? [] : content.split(/\r?\n/);
  const rel = relative(file);
  contentByFile.set(rel, content);
  scanned.push({ file: rel, lines: lines.length });
  lineCount += lines.length;

  lines.forEach((line, index) => {
    if (/^(<{7}|={7}|>{7})(?:\s|$)/.test(line)) fail(`${rel}:${index + 1} contains a merge-conflict marker`);
    if (line.includes("\u0000")) fail(`${rel}:${index + 1} contains a NUL byte`);
    if (line.includes("\uFFFD")) fail(`${rel}:${index + 1} contains a Unicode replacement character`);
    if (/â(?:€|†|€™|€œ|€|€“|€”)/.test(line)) fail(`${rel}:${index + 1} appears to contain mojibake`);
  });

  if (path.extname(file).toLowerCase() === ".json" && !path.basename(file).startsWith("tsconfig")) {
    try {
      JSON.parse(content);
    } catch (error) {
      fail(`${rel} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const app = contentByFile.get("src/App.tsx") ?? "";
const master = contentByFile.get("project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.md") ?? "";
const sql = contentByFile.get("database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql") ?? "";
const envExample = contentByFile.get(".env.example") ?? "";

const routes = new Set([...app.matchAll(/\bpath=["']([^"']+)["']/g)].map((match) => match[1]));
for (const route of routes) {
  if (!master.includes(`\`${route}\``) && !master.includes(`| ${route} |`)) fail(`App route is missing from the master documentation: ${route}`);
}

const apiFiles = allFiles
  .filter((file) => relative(file).startsWith("api/") && path.extname(file) === ".ts" && !relative(file).startsWith("api/lib/"))
  .map(relative)
  .sort();
for (const file of apiFiles) {
  if (!master.includes(`\`${file}\``)) fail(`API handler is missing from the master documentation: ${file}`);
}

const apiReferences = new Set();
for (const [file, content] of contentByFile) {
  if (!file.startsWith("src/")) continue;
  for (const match of content.matchAll(/["'`]\/api\/([a-z0-9-]+)/gi)) apiReferences.add(match[1]);
}
const apiBasenames = new Set(apiFiles.map((file) => path.basename(file, ".ts")));
for (const endpoint of apiReferences) {
  if (!apiBasenames.has(endpoint)) fail(`Frontend endpoint has no matching api/*.ts handler: /api/${endpoint}`);
}

const supabaseRelations = new Set();
for (const [file, content] of contentByFile) {
  if (!file.startsWith("src/") && !file.startsWith("api/")) continue;
  for (const match of content.matchAll(/\.from\(["']([a-z0-9_-]+)["']\)/gi)) supabaseRelations.add(match[1]);
}
for (const relation of supabaseRelations) {
  if (!sql.includes(relation)) fail(`Supabase relation or bucket is absent from the database master: ${relation}`);
}

const envNames = new Set();
for (const [file, content] of contentByFile) {
  if (!file.startsWith("src/") && !file.startsWith("api/") && !["vite.config.ts", "vercel.json"].includes(file)) continue;
  for (const match of content.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]+)/g)) envNames.add(match[1]);
}
const documentedEnv = new Set([...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]));
// Runtime-provided names that are never set in .env: Node's NODE_ENV and Vite's
// built-in import.meta.env flags (PROD/DEV/MODE/SSR/BASE_URL).
const runtimeProvidedEnv = new Set(["NODE_ENV", "PROD", "DEV", "MODE", "SSR", "BASE_URL"]);
for (const name of envNames) {
  if (!runtimeProvidedEnv.has(name) && !documentedEnv.has(name)) fail(`Environment variable is used but absent from .env.example: ${name}`);
}
for (const [file, content] of contentByFile) {
  if (!file.startsWith("src/")) continue;
  if (/VITE_(?:PAYMONGO_SECRET|SUPABASE_SERVICE|CRON_SECRET|GUEST_INQUIRY_HASH_SALT|GMAIL_WEBHOOK_SHARED_SECRET)/.test(content)) fail(`${file} references a secret-looking VITE_ variable`);
}

const sqlFiles = allFiles.filter((file) => relative(file).startsWith("database_scripts/") && path.extname(file).toLowerCase() === ".sql");
if (sqlFiles.length !== 1 || relative(sqlFiles[0]) !== "database_scripts/SAFE_DRIVE_DATABASE_MASTER.sql") fail(`Expected one canonical database SQL file; found ${sqlFiles.map(relative).join(", ") || "none"}`);
const docxFiles = allFiles.filter((file) => path.extname(file).toLowerCase() === ".docx");
const expectedDocxFiles = [
  "project_docs/SAFE_DRIVE_MASTER_DOCUMENTATION.docx",
  "project_docs/SAFEDRIVE_ACTION_AND_LAUNCH_CHECKLIST.docx",
];
const actualDocxFiles = docxFiles.map(relative).sort();
if (
  actualDocxFiles.length !== expectedDocxFiles.length
  || actualDocxFiles.some((file, index) => file !== [...expectedDocxFiles].sort()[index])
) fail(`Expected the canonical project paper and action checklist; found ${actualDocxFiles.join(", ") || "none"}`);

for (const required of ["Appendix G", "Appendix H", "Appendix I", "SAFE_DRIVE_DATABASE_MASTER.sql", "npm run check:all"]) {
  if (!master.includes(required)) fail(`Master documentation is missing required marker: ${required}`);
}

const activePolicyFiles = ["src/pages/PrivacyPolicyPage.tsx", "src/pages/TermsPage.tsx", "src/pages/PlatformAgreementPage.tsx", "src/pages/SignUpPage.tsx", "docs/system-process.md", "plans/implementation-plan.md"];
const staleClaims = [/maximum\s+(?:rental\s+)?duration.{0,20}10 days/i, /automatic.{0,25}20% cancellation/i, /completely deleted.{0,30}after 30 days/i, /absolute accordance/i];
for (const file of activePolicyFiles) {
  const content = contentByFile.get(file) ?? "";
  for (const pattern of staleClaims) if (pattern.test(content)) fail(`${file} contains a stale claim matching ${pattern}`);
}

if (failures.length) {
  console.error(`Repository alignment FAILED: ${failures.length} issue(s)`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Repository alignment PASS: ${scanned.length} reviewed text files, ${lineCount.toLocaleString()} lines`);
  console.log(`Coverage: ${routes.size} application routes, ${apiFiles.length} API handlers, ${apiReferences.size} frontend API references, ${supabaseRelations.size} Supabase relations/buckets, ${envNames.size} environment names`);
}
