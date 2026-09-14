// How a form shows what is missing: every problem at once, in red on the field
// itself, after the first submit - not the browser's one-bubble-per-click.

/**
 * Red outline for a control marked aria-invalid. Input and SelectTrigger carry
 * this already; a native <select> or <textarea> needs it added.
 */
export const INVALID_CONTROL_CLASSES =
  "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

/**
 * Brings a field into view and puts the cursor in it. `id` may be the control
 * itself or a wrapper around it (a file upload, a checkbox row, an error
 * summary with tabIndex -1).
 */
export const focusField = (id: string) => {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  const control = element.matches("input, select, textarea, button, [tabindex]")
    ? element
    : element.querySelector<HTMLElement>(
        "input:not([type='file']):not([type='hidden']), select, textarea, button",
      );
  control?.focus({ preventScroll: true });
};
