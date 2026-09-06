// One-off local generator for PWA icon PNGs, run manually:
//   node scripts/generate-pwa-icons.mjs
//
// Source of truth is public/favicon.svg (the actual SafeDrive logo mark) -
// NOT public/icons.svg, which is an unrelated third-party social-icon sprite
// sheet and must never be treated as a logo source.
//
// Output is committed as static assets under public/ - this script is never
// wired into `npm run build`, so `sharp` (a native binary dependency) never
// needs to run on Vercel and the production build stays deterministic.
//
// Produces:
//   public/icons/icon-192.png            - direct scale, purpose "any"
//   public/icons/icon-512.png            - direct scale, purpose "any"
//   public/icons/icon-512-maskable.png   - logo composited at ~70% scale on a
//                                          full-bleed background so Android's
//                                          mask crop (circle/squircle/rounded
//                                          square) doesn't clip the glyph
//   public/apple-touch-icon.png          - 180x180, direct scale (iOS doesn't
//                                          mask this one the way Android does)

import { readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const publicDir = join(repoRoot, "public");
const iconsDir = join(publicDir, "icons");

const faviconSvgPath = join(publicDir, "favicon.svg");

async function renderDirectScale(svgBuffer, size, outPath) {
  await sharp(svgBuffer, { density: 384 })
    .resize(size, size, { fit: "contain" })
    .png()
    .toFile(outPath);
  console.log(`wrote ${outPath} (${size}x${size}, direct scale)`);
}

async function renderMaskable(originalSvgText, size, outPath) {
  // Original artwork is a 48x48 viewBox: a full-bleed rounded-rect background
  // (rx=11) plus a white car glyph. For a maskable icon we draw a full-bleed
  // 512x512 background (same gradient) behind a centered, scaled-down copy of
  // the *entire* original 48x48 artwork - the classic "safe-zone padding"
  // maskable-icon pattern. Scaling the drawn content to ~70% of the canvas
  // keeps it comfortably inside Android's ~80%-diameter safe circle.
  const innerFraction = 0.7;
  const innerSize = size * innerFraction;
  const offset = (size - innerSize) / 2;
  const scale = innerSize / 48;

  // Re-tag the gradient id so it doesn't collide if this SVG is ever inlined
  // alongside the original favicon.svg on the same page.
  const innerArtwork = originalSvgText
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replaceAll('id="bg"', 'id="bg-maskable"')
    .replaceAll('url(#bg)', "url(#bg-maskable)");

  const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg-full" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg-full)"/>
  <g transform="translate(${offset},${offset}) scale(${scale})">
    ${innerArtwork}
  </g>
</svg>`;

  await sharp(Buffer.from(maskableSvg), { density: 384 })
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`wrote ${outPath} (${size}x${size}, maskable, ${Math.round(innerFraction * 100)}% safe-zone scale)`);
}

async function main() {
  await mkdir(iconsDir, { recursive: true });

  const svgBuffer = await readFile(faviconSvgPath);
  const svgText = svgBuffer.toString("utf8");

  await renderDirectScale(svgBuffer, 192, join(iconsDir, "icon-192.png"));
  await renderDirectScale(svgBuffer, 512, join(iconsDir, "icon-512.png"));
  await renderDirectScale(svgBuffer, 180, join(publicDir, "apple-touch-icon.png"));
  await renderMaskable(svgText, 512, join(iconsDir, "icon-512-maskable.png"));

  console.log("\nDone. Visually verify the maskable icon before committing:");
  console.log("  https://maskable.app/editor  (upload public/icons/icon-512-maskable.png)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
