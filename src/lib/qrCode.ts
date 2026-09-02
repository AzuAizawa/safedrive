/**
 * Supabase returns an enrolled TOTP factor's QR code as a standalone SVG
 * document: an `<?xml ?>` prolog, an SVGo comment, then `<svg width="207"
 * height="207">` with one `<rect>` per dark module and no `viewBox` or
 * `shape-rendering` hint. Passed straight to `<img src>` and scaled down by CSS,
 * the module edges anti-alias into a soft grey fringe that phones struggle to
 * scan. This normalises whatever Supabase returns into a crisp `data:` URI.
 */
export const qrCodeSrc = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  let svg: string | null = null;

  if (trimmed.startsWith("data:image/svg+xml")) {
    const comma = trimmed.indexOf(",");
    if (comma === -1) return trimmed;
    const payload = trimmed.slice(comma + 1);
    try {
      svg = /;base64/i.test(trimmed.slice(0, comma))
        ? atob(payload)
        : decodeURIComponent(payload);
    } catch {
      return trimmed;
    }
  } else if (trimmed.startsWith("data:image/")) {
    // Raster (png/jpeg) - nothing useful to sharpen.
    return trimmed;
  } else if (trimmed.includes("<svg")) {
    svg = trimmed;
  }

  if (!svg) return trimmed;

  // Keep from the opening <svg tag; drop the XML prolog and comments.
  const svgStart = svg.indexOf("<svg");
  if (svgStart > 0) svg = svg.slice(svgStart);

  if (!/shape-rendering=/.test(svg)) {
    svg = svg.replace(/<svg\b/, '<svg shape-rendering="crispEdges"');
  }
  if (!/viewBox=/.test(svg)) {
    const width = svg.match(/\bwidth="(\d+(?:\.\d+)?)"/)?.[1];
    const height = svg.match(/\bheight="(\d+(?:\.\d+)?)"/)?.[1] ?? width;
    if (width) {
      svg = svg.replace(/<svg\b/, `<svg viewBox="0 0 ${width} ${height}"`);
    }
  }

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};
