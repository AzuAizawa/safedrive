import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageCircleQuestion, Send, X } from "lucide-react";
import { useLocation } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { GUEST_INQUIRY_TOPICS } from "@/lib/guestInquiryTopics";

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  topic: "",
  message: "",
  company: "",
};

export default function InquiryWidget() {
  const { pathname } = useLocation();
  const { user, profile } = useAuth();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const hidden = pathname.startsWith("/admin") || pathname === "/contact";

  useEffect(() => {
    if (!open) return;
    setForm((current) => ({
      ...current,
      name: current.name || profile?.full_name || "",
      email: current.email || profile?.email || user?.email || "",
      phone: current.phone || profile?.phone || "",
    }));
  }, [open, profile?.email, profile?.full_name, profile?.phone, user?.email]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (hidden) return null;

  const update = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const close = () => {
    setOpen(false);
    setSubmitted(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/create-guest-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          topics: [form.topic],
          message: form.message,
          company: form.company,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to submit inquiry");
      setSubmitted(true);
      setForm((current) => ({ ...emptyForm, name: current.name, email: current.email, phone: current.phone }));
      toast.success("Inquiry submitted", {
        description: "SafeDrive received your inquiry and will reply through email.",
      });
    } catch (error) {
      toast.error("Inquiry was not submitted", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[80] bg-black/45 sm:bg-transparent" onMouseDown={close}>
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="absolute inset-x-3 bottom-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl outline-none sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[390px]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id={titleId} className="text-lg font-bold">Send an inquiry</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  This goes to the admin inquiry queue. It is separate from booking support tickets.
                </p>
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label="Close inquiry form" onClick={close}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {submitted ? (
              <div className="py-8 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <p className="mt-3 font-semibold">Inquiry received</p>
                <p className="mt-1 text-sm text-muted-foreground">We will reply through the email you provided.</p>
                <Button type="button" variant="outline" className="mt-5" onClick={() => setSubmitted(false)}>
                  Send another inquiry
                </Button>
              </div>
            ) : (
              <form className="mt-5 space-y-4" onSubmit={submit}>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5">
                    <Label htmlFor="inquiry-name">Name</Label>
                    <Input id="inquiry-name" maxLength={120} required value={form.name} onChange={(event) => update("name", event.target.value)} />
                  </label>
                  <label className="space-y-1.5">
                    <Label htmlFor="inquiry-phone">Phone <span className="text-muted-foreground">(optional)</span></Label>
                    <Input id="inquiry-phone" inputMode="tel" maxLength={40} value={form.phone} onChange={(event) => update("phone", event.target.value)} />
                  </label>
                </div>
                <label className="block space-y-1.5">
                  <Label htmlFor="inquiry-email">Email</Label>
                  <Input id="inquiry-email" type="email" maxLength={320} required value={form.email} onChange={(event) => update("email", event.target.value)} />
                </label>
                <label className="block space-y-1.5">
                  <Label htmlFor="inquiry-topic">Inquiry topic</Label>
                  <select
                    id="inquiry-topic"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    required
                    value={form.topic}
                    onChange={(event) => update("topic", event.target.value)}
                  >
                    <option value="">Choose a topic</option>
                    {GUEST_INQUIRY_TOPICS.map((topic) => <option key={topic} value={topic}>{topic}</option>)}
                  </select>
                </label>
                <label className="hidden" aria-hidden="true">
                  Company
                  <input tabIndex={-1} autoComplete="off" value={form.company} onChange={(event) => update("company", event.target.value)} />
                </label>
                <label className="block space-y-1.5">
                  <Label htmlFor="inquiry-message">Question or concern</Label>
                  <textarea
                    id="inquiry-message"
                    className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    minLength={10}
                    maxLength={3000}
                    required
                    value={form.message}
                    onChange={(event) => update("message", event.target.value)}
                    placeholder="How can SafeDrive help?"
                  />
                </label>
                <Button type="submit" className="w-full gap-2" disabled={submitting || !form.topic || form.message.trim().length < 10}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Submit inquiry
                </Button>
              </form>
            )}
          </div>
        </div>
      )}

      <Button
        type="button"
        className="fixed bottom-5 right-5 z-[81] h-12 gap-2 rounded-full px-4 shadow-xl sm:bottom-6 sm:right-6"
        aria-label={open ? "Close inquiry form" : "Open inquiry form"}
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else {
            setSubmitted(false);
            setOpen(true);
          }
        }}
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircleQuestion className="h-5 w-5" />}
        <span>Inquiry</span>
      </Button>
    </>
  );
}
