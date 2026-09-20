import { useCallback, useEffect, useState } from "react";
import { Loader2, Megaphone, Send, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ConfirmDialog from "@/components/ConfirmDialog";
import { supabase } from "@/lib/supabase";

type Audience = "all" | "listers" | "renters";

type SentAnnouncement = {
  id: string;
  title: string;
  message: string;
  audience: Audience;
  recipient_count: number;
  created_at: string;
  emailed_at: string | null;
  email_sent_count: number | null;
};

const TITLE_MAX = 120;
const MESSAGE_MAX = 2000;

// Deliberately plain wording - an admin picking an audience should not have to
// work out what the label means. "Listers" is defined by owning a car, not by
// the is_lister session flag, so the description says so.
const AUDIENCES: Array<{ value: Audience; label: string; hint: string }> = [
  { value: "all", label: "Everyone", hint: "Every account on SafeDrive." },
  {
    value: "listers",
    label: "Listers only",
    hint: "Accounts that have listed at least one car.",
  },
  {
    value: "renters",
    label: "Renters only",
    hint: "Accounts that have not listed a car.",
  },
];

const formatStamp = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

const audienceLabel = (value: string) =>
  AUDIENCES.find((option) => option.value === value)?.label ?? value;

export default function AdminAnnouncementsPage() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  // Off unless the super admin asks for it. Most announcements do not belong
  // in anyone's inbox, and an email cannot be taken back the way a bell
  // notification can be deleted.
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [history, setHistory] = useState<SentAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("platform_announcements")
      .select("id, title, message, audience, recipient_count, created_at, emailed_at, email_sent_count")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      toast.error("Could not load past announcements.");
    }
    setHistory((data as SentAnnouncement[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cleanTitle = title.trim();
  const cleanMessage = message.trim();
  const canSend =
    cleanTitle.length > 0 &&
    cleanTitle.length <= TITLE_MAX &&
    cleanMessage.length > 0 &&
    cleanMessage.length <= MESSAGE_MAX;

  const handleSend = async () => {
    setConfirmOpen(false);
    setSending(true);
    try {
      const { data, error } = await supabase.rpc("send_platform_announcement", {
        p_title: cleanTitle,
        p_message: cleanMessage,
        p_audience: audience,
      });
      if (error) throw error;
      // CHAPTER 101 returns the new announcement's id with the count. The id
      // is what asks for the emails - re-reading the newest row instead would
      // email the wrong text if two super admins posted in the same moment.
      const result = (data ?? {}) as { id?: string; recipients?: number };
      const count = Number(result.recipients ?? 0);
      toast.success(
        count === 1
          ? "Sent to 1 account."
          : `Sent to ${count.toLocaleString()} accounts.`,
      );

      // The bell notifications are already delivered at this point. Email is
      // reported separately and on purpose: a mail provider that is down or
      // unconfigured must not look like a failed announcement.
      if (alsoEmail && result.id) {
        const { data: { session } } = await supabase.auth.getSession();
        try {
          const response = await fetch("/api/send-announcement-emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token ?? ""}`,
            },
            body: JSON.stringify({ announcementId: result.id }),
          });
          const body = (await response.json().catch(() => ({}))) as {
            deliveryState?: string;
            sent?: number;
            recipients?: number;
          };
          if (body.deliveryState === "sent") {
            toast.success(`Emailed ${Number(body.sent ?? 0).toLocaleString()} of them too.`);
          } else if (body.deliveryState === "not_configured") {
            toast.warning("Announcement sent, but email is not configured yet.");
          } else if (body.deliveryState === "partial") {
            toast.warning(
              `Announcement sent. Only ${Number(body.sent ?? 0).toLocaleString()} of ${Number(body.recipients ?? 0).toLocaleString()} emails went out.`,
            );
          } else {
            toast.warning("Announcement sent, but the emails were not delivered.");
          }
        } catch (emailError) {
          console.warn("Announcement email request failed", emailError);
          toast.warning("Announcement sent, but the emails could not be sent.");
        }
      }

      setTitle("");
      setMessage("");
      setAlsoEmail(false);
      await load();
    } catch (err) {
      toast.error("Could not send the announcement", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Announcements</h1>
        <p className="mt-1 text-muted-foreground">
          Send a message to the notification bell of the accounts you choose. Use
          it when something changes that people would otherwise only discover by
          bumping into it - updated Terms, planned downtime, or a policy taking
          effect on a date. It goes to the bell only; SafeDrive does not email
          announcements.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-5 w-5" />
            Write an announcement
          </CardTitle>
          <CardDescription>
            Everyone you pick sees it the moment you send - the bell updates
            without them refreshing. It cannot be recalled, so read it once more
            before sending.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX}
              placeholder="Updated Terms and Conditions"
            />
            <p className="text-xs text-muted-foreground">
              {cleanTitle.length}/{TITLE_MAX}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Message</Label>
            <textarea
              className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MESSAGE_MAX}
              placeholder="Starting March 1, the wait before a no-show can be reported becomes 1 hour."
            />
            <p className="text-xs text-muted-foreground">
              {cleanMessage.length}/{MESSAGE_MAX}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Who receives it</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {AUDIENCES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAudience(option.value)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    audience === option.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Users className="h-4 w-4 opacity-70" />
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Also send by email</Label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50">
              <input
                type="checkbox"
                checked={alsoEmail}
                onChange={(e) => setAlsoEmail(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="text-xs text-muted-foreground">
                <span className="block text-sm font-medium text-foreground">
                  Email everyone who receives this
                </span>
                Leave this off for routine notices - the bell is enough. Turn it
                on for something people must not miss, such as updated Terms,
                where it matters that SafeDrive reached them and can show it.
                An email cannot be recalled.
              </span>
            </label>
          </div>

          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!canSend || sending}
            className="gap-2"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send announcement
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Already sent</CardTitle>
          <CardDescription>
            The last 20, newest first, with how many accounts each one reached.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-3 py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading...
            </div>
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing sent yet.
            </p>
          ) : (
            <div className="space-y-3">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-border/60 p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatStamp(item.created_at)}
                    </p>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {item.message}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {audienceLabel(item.audience)} ·{" "}
                    {item.recipient_count.toLocaleString()}{" "}
                    {item.recipient_count === 1 ? "account" : "accounts"}
                    {item.emailed_at
                      ? ` · emailed ${Number(item.email_sent_count ?? 0).toLocaleString()}`
                      : " · bell only"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Send this announcement?"
        description={`"${cleanTitle}" goes to ${audienceLabel(audience).toLowerCase()} right now. It appears in their notification bell immediately and cannot be recalled.${
          alsoEmail ? " It is also emailed to every one of them." : ""
        }`}
        confirmText="Send it"
        isLoading={sending}
        onConfirm={() => void handleSend()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
