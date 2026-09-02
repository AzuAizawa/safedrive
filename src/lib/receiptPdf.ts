// Shared, branded A4 receipt/acknowledgment PDF used by renter payment,
// renter refund, and lister payout downloads. One code path so the layout and
// the (occasionally fussy) save step are fixed in one place.

type JsPdfCtor = typeof import("jspdf").jsPDF;

/**
 * jsPDF's ESM build has shifted its export shape between bundler setups. Resolve
 * the constructor defensively so `import("jspdf")` cannot silently yield
 * `undefined` and turn into a "download does nothing" click.
 */
export async function loadJsPDF(): Promise<JsPdfCtor> {
  const mod = (await import("jspdf")) as unknown as {
    jsPDF?: JsPdfCtor;
    default?: JsPdfCtor | { jsPDF?: JsPdfCtor };
  };
  const candidate =
    mod.jsPDF ??
    (typeof mod.default === "function" ? mod.default : undefined) ??
    (mod.default && typeof mod.default === "object" ? mod.default.jsPDF : undefined);
  if (typeof candidate !== "function") {
    throw new Error("The PDF library did not load. Refresh the page and try again.");
  }
  return candidate;
}

type SaveablePdf = {
  save: (filename: string) => void;
  output: (type: "blob") => Blob;
};

/**
 * `pdf.save()` relies on an anchor-click that a strict CSP, an embedded webview,
 * or a browser that needs the anchor in the DOM can quietly drop. Try it, then
 * fall back to an explicit object-URL download.
 */
export function savePdf(pdf: SaveablePdf, filename: string): void {
  try {
    pdf.save(filename);
    return;
  } catch {
    /* fall through to the manual path */
  }
  const blob = pdf.output("blob");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export type ReceiptDocument = {
  /** "Payment Acknowledgment" | "Refund Receipt" | "Payout Receipt" */
  title: string;
  subtitle: string;
  documentNo: string;
  statusLabel: string;
  recordedAt: string;
  /** Always pass a positive amount; refunds/payouts should be Math.abs(...). */
  amount: number;
  amountLabel: string;
  rows: Array<[string, string]>;
  notice: string;
  recordId: string;
  filename: string;
};

const peso = (amount: number) =>
  `PHP ${Number(amount || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Builds and downloads the receipt. Throws on failure so callers can toast. */
export async function downloadReceiptPdf(doc: ReceiptDocument): Promise<void> {
  const JsPDF = await loadJsPDF();
  const pdf = new JsPDF({ unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;

  // Header band
  pdf.setFillColor(8, 15, 28);
  pdf.rect(0, 0, pageWidth, 40, "F");
  pdf.setFillColor(37, 99, 235);
  pdf.roundedRect(margin, 11, 17, 17, 3, 3, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("SD", margin + 4.1, 22);
  pdf.setFontSize(22);
  pdf.text("SafeDrive", margin + 23, 21);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(191, 219, 254);
  pdf.text("Peer-to-peer vehicle rental platform", margin + 23, 27);

  // Title
  pdf.setTextColor(15, 23, 42);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.text(doc.title, margin, 56);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(71, 85, 105);
  pdf.text(doc.subtitle, margin, 63);

  // Summary strip
  const drawLabelValue = (label: string, value: string, x: number, y: number, width: number) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(label.toUpperCase(), x, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(15, 23, 42);
    pdf.text(pdf.splitTextToSize(value, width), x, y + 5);
  };
  pdf.setDrawColor(203, 213, 225);
  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(margin, 71, contentWidth, 28, 3, 3, "FD");
  drawLabelValue("Document no.", doc.documentNo, margin + 6, 79, 51);
  drawLabelValue("Status", doc.statusLabel.toUpperCase(), margin + 64, 79, 42);
  drawLabelValue("Recorded at", doc.recordedAt, margin + 113, 79, 52);

  // Detail rows
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Transaction details", margin, 113);
  pdf.setDrawColor(226, 232, 240);
  pdf.line(margin, 117, pageWidth - margin, 117);

  let y = 127;
  doc.rows.forEach(([label, value]) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(71, 85, 105);
    pdf.text(label, margin, y);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(15, 23, 42);
    const valueLines = pdf.splitTextToSize(value || "Not recorded", contentWidth - 47);
    pdf.text(valueLines, margin + 47, y);
    y += Math.max(8, valueLines.length * 5);
  });

  // Amount callout
  pdf.setFillColor(239, 246, 255);
  pdf.setDrawColor(147, 197, 253);
  pdf.roundedRect(margin, y + 2, contentWidth, 24, 3, 3, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(30, 64, 175);
  pdf.setFontSize(9);
  pdf.text(doc.amountLabel.toUpperCase(), margin + 7, y + 11);
  pdf.setFontSize(18);
  pdf.text(peso(doc.amount), pageWidth - margin - 7, y + 17, { align: "right" });

  // Notice
  y += 40;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Important document notice", margin, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text(pdf.splitTextToSize(doc.notice, contentWidth), margin, y + 7);

  // Footer
  pdf.setDrawColor(226, 232, 240);
  pdf.line(margin, 276, pageWidth - margin, 276);
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text(
    `Generated by SafeDrive on ${new Date().toLocaleString("en-PH")}`,
    margin,
    282,
  );
  pdf.text(`Record ID: ${doc.recordId}`, pageWidth - margin, 282, { align: "right" });

  savePdf(pdf as unknown as SaveablePdf, doc.filename);
}

const NOT_A_TAX_DOC =
  "This is a SafeDrive record for transaction traceability. It is not a BIR tax invoice, official receipt, proof of BIR accreditation, or a document valid for claiming input VAT. PayMongo confirmation supports verification but does not replace any invoice required by law.";

export const RECEIPT_NOTICES = {
  payment: NOT_A_TAX_DOC,
  refund:
    "This confirms a refund that SafeDrive recorded and requested from PayMongo. " +
    "Posting to the payer's account depends on the provider and card issuer and can take several business days. " +
    NOT_A_TAX_DOC,
  payout:
    "This is a SafeDrive lister-payout record for transaction traceability. " +
    NOT_A_TAX_DOC,
} as const;
