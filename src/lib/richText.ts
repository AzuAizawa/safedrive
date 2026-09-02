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

const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const sanitizeNode = (node: Node) => {
  if (node.nodeType === Node.TEXT_NODE) return;
  if (node.nodeType !== Node.ELEMENT_NODE) {
    node.parentNode?.removeChild(node);
    return;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tagName)) {
    const fragment = document.createDocumentFragment();
    while (element.firstChild) {
      fragment.appendChild(element.firstChild);
    }
    element.replaceWith(fragment);
    Array.from(fragment.childNodes).forEach(sanitizeNode);
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

  Array.from(element.childNodes).forEach(sanitizeNode);
};

export const sanitizeRichText = (value: string) => {
  if (!value.trim()) return "";
  if (typeof window === "undefined") return value.trim();

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(value, "text/html");
  Array.from(documentNode.body.childNodes).forEach(sanitizeNode);
  return documentNode.body.innerHTML.trim();
};

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
