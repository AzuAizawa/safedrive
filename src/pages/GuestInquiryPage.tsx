import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, CheckCircle2, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GUEST_INQUIRY_TOPICS } from "@/lib/guestInquiryTopics";
import { useAuth } from "@/contexts/AuthContext";

const initialForm = {
  name: "",
  email: "",
  phone: "",
  topics: [] as string[],
  message: "",
  company: "",
};

export default function GuestInquiryPage() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => ({
    ...initialForm,
    name: (user && (user.user_metadata?.full_name as string)) || "",
    email: user?.email || "",
  }));
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const setField = (field: Exclude<keyof typeof form, "topics">, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const toggleTopic = (topic: string) => {
    setForm((current) => ({
      ...current,
      topics: current.topics.includes(topic)
        ? current.topics.filter((item) => item !== topic)
        : [...current.topics, topic],
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/create-guest-inquiry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify(form),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        linked?: boolean;
      };
      if (!response.ok) throw new Error(payload.error || "Unable to submit inquiry");

      if (payload.linked) {
        toast.success("Inquiry sent - continue the conversation from the Inquiry button");
        navigate("/");
        return;
      }
      setSubmitted(true);
      setForm(initialForm);
    } catch (error) {
      toast.error("Inquiry was not submitted", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground sm:py-14">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to SafeDrive
        </Link>

        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-xl sm:p-8">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-blue-500/10 p-3 text-blue-500">
              <MessageSquare className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Ask SafeDrive a question</h1>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {user
                  ? "You're signed in - SafeDrive replies in My Inquiries so you can read it in your account and follow up."
                  : "You do not need an account to ask about SafeDrive; the reply comes to your email."}{" "}
                Do not include passwords, one-time codes, government ID numbers, or payment credentials.
              </p>
            </div>
          </div>

          {submitted ? (
            <div className="mt-8 rounded-xl border border-green-500/30 bg-green-500/10 p-6 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
              <h2 className="mt-3 text-lg font-semibold">Your inquiry was received</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                SafeDrive support will review it and respond using the email address you supplied.
              </p>
              <Button className="mt-5" variant="outline" onClick={() => setSubmitted(false)}>
                Ask another question
              </Button>
            </div>
          ) : (
            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="space-y-2">
                  <Label htmlFor="guest-name">Name</Label>
                  <Input id="guest-name" value={form.name} onChange={(event) => setField("name", event.target.value)} maxLength={120} required />
                </label>
                <label className="space-y-2">
                  <Label htmlFor="guest-email">Email</Label>
                  <Input id="guest-email" type="email" value={form.email} onChange={(event) => setField("email", event.target.value)} maxLength={320} required />
                </label>
              </div>

              <label className="space-y-2">
                <Label htmlFor="guest-phone">Phone (optional)</Label>
                <Input id="guest-phone" inputMode="tel" value={form.phone} onChange={(event) => setField("phone", event.target.value)} maxLength={40} />
              </label>

              <label className="hidden" aria-hidden="true">
                Company
                <input tabIndex={-1} autoComplete="off" value={form.company} onChange={(event) => setField("company", event.target.value)} />
              </label>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">
                  What would you like to ask about? <span className="text-destructive">*</span>
                </legend>
                <p className="text-xs text-muted-foreground">Select as many topics as you need.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {GUEST_INQUIRY_TOPICS.map((topic) => {
                    const checked = form.topics.includes(topic);
                    return (
                      <label
                        key={topic}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${
                          checked ? "border-blue-500/50 bg-blue-500/10" : "border-border hover:bg-muted/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-input"
                          checked={checked}
                          onChange={() => toggleTopic(topic)}
                        />
                        <span>{topic}</span>
                      </label>
                    );
                  })}
                </div>
                {form.topics.length === 0 && (
                  <p className="text-xs text-muted-foreground">Choose at least one topic before submitting.</p>
                )}
              </fieldset>

              <label className="space-y-2">
                <Label htmlFor="guest-message">Question</Label>
                <textarea
                  id="guest-message"
                  value={form.message}
                  onChange={(event) => setField("message", event.target.value)}
                  minLength={10}
                  maxLength={3000}
                  rows={7}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Tell us what you would like to know."
                  required
                />
                <p className="text-right text-xs text-muted-foreground">{form.message.length}/3000</p>
              </label>

              <Button type="submit" className="w-full gap-2" disabled={submitting || form.topics.length === 0}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                Submit inquiry
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
