const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "a",
]);

// Wider than chat's ALLOWED_TAGS - legal documents (Terms, Privacy Policy,
// Platform Agreement) are long and structured, so headings are allowed here.
// Kept as a separate set rather than widening ALLOWED_TAGS so chat-message
// rendering behavior is untouched.
const LEGAL_DOCUMENT_ALLOWED_TAGS = new Set([
  "p",
  "br",
  "h2",
  "h3",
  "h4",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
]);

// Removed outright, subtree and all - never unwrapped. Unwrapping promotes
// an element's children into the parent, which is right for a harmless
// wrapper like <div> but wrong for these: their content is script, style,
// or foreign-namespace markup that has no business becoming page content.
const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "svg",
  "math",
  "template",
  "noscript",
  "noembed",
  "noframes",
  "xmp",
  "plaintext",
  "frame",
  "frameset",
  "applet",
  "audio",
  "video",
  "source",
  "track",
  "img",
]);

const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const sanitizeNode = (node: Node, allowedTags: Set<string>) => {
  if (node.nodeType === Node.TEXT_NODE) return;
  if (node.nodeType !== Node.ELEMENT_NODE) {
    node.parentNode?.removeChild(node);
    return;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();

  if (DANGEROUS_TAGS.has(tagName)) {
    element.remove();
    return;
  }

  if (!allowedTags.has(tagName)) {
    // Children are sanitized BEFORE they are promoted. Doing it after the
    // unwrap never worked: inserting a DocumentFragment empties it, so the
    // recursion that used to run here iterated an empty list and every
    // promoted child survived untouched. That let
    // `<div><img src=x onerror=...></div>` through the sanitizer intact -
    // the wrapper was stripped, the payload was not, and it reached
    // dangerouslySetInnerHTML in the reader's (including an admin's)
    // browser. Depth-first means anything promoted here is already clean.
    Array.from(element.childNodes).forEach((child) => sanitizeNode(child, allowedTags));

    const fragment = document.createDocumentFragment();
    while (element.firstChild) {
      fragment.appendChild(element.firstChild);
    }
    element.replaceWith(fragment);
    return;
  }

  Array.from(element.attributes).forEach((attribute) => {
    const name = attribute.name.toLowerCase();
    if (tagName === "a" && ["href", "target", "rel"].includes(name)) return;
    element.removeAttribute(attribute.name);
  });

  if (tagName === "a") {
    const href = element.getAttribute("href") ?? "";
    if (!href.startsWith("http://") && !href.startsWith("https://")) {
      element.removeAttribute("href");
    } else {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  }

  Array.from(element.childNodes).forEach((child) => sanitizeNode(child, allowedTags));
};

const sanitizeWithAllowlist = (value: string, allowedTags: Set<string>) => {
  if (!value.trim()) return "";
  if (typeof window === "undefined") return value.trim();

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(value, "text/html");
  Array.from(documentNode.body.childNodes).forEach((child) => sanitizeNode(child, allowedTags));
  return documentNode.body.innerHTML.trim();
};

export const sanitizeRichText = (value: string) => sanitizeWithAllowlist(value, ALLOWED_TAGS);

// For admin-authored legal documents (Terms, Privacy Policy, Platform
// Agreement) - wider allowlist than chat, sanitized on both save (the admin
// editor) and render (the public pages) as defense in depth.
export const sanitizeLegalDocumentHtml = (value: string) =>
  sanitizeWithAllowlist(value, LEGAL_DOCUMENT_ALLOWED_TAGS);

export const normalizeRichTextInput = (value: string) => {
  const sanitized = sanitizeRichText(value);
  return sanitized.replace(/<p><br><\/p>/g, "").trim();
};

export const richTextHasVisibleContent = (value: string) => {
  const normalized = normalizeRichTextInput(value);
  if (!normalized) return false;
  const plainText = normalized
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  return plainText.length > 0;
};

export const formatRichTextForDisplay = (value: string) => {
  if (!value.trim()) return "";
  if (HTML_TAG_PATTERN.test(value)) {
    return sanitizeRichText(value);
  }

  return escapeHtml(value).replace(/\n/g, "<br />");
};
