import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router";
import { FileWarning, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";

type DeletionStatus = {
  graceDays: number;
  scheduledFor: string | null;
  blockers: string[];
  suspended: boolean;
  canSelfDelete: boolean;
};

const CONFIRM_WORD = "DELETE";

const manilaDateTime = (value: Date | string) =>
  new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "long",
    timeStyle: "short",
  });

// Self-service account deletion (CHAPTER 96). The server re-checks everything
// shown here; this only explains it first, so no one confirms a deletion that
// will be refused, and no one is surprised by what it does. Mounted only while
// open, so every opening starts from a fresh check.
export default function AccountDeletionDialog({ onClose }: { onClose: () => void }) {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const accessToken = session?.access_token;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!accessToken) throw new Error("Your session expired. Sign in again.");
        const response = await fetch("/api/account-deletion", {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as Partial<DeletionStatus> & {
          error?: string;
        };
        if (!response.ok) throw new Error(body.error || "Your account could not be checked.");
        if (!cancelled) {
          setStatus({
            graceDays: Number(body.graceDays ?? 30),
            scheduledFor: body.scheduledFor ?? null,
            blockers: Array.isArray(body.blockers) ? body.blockers : [],
            suspended: Boolean(body.suspended),
            canSelfDelete: Boolean(body.canSelfDelete),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Your account could not be checked.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const eligible =
    Boolean(status) &&
    status!.canSelfDelete &&
    !status!.scheduledFor &&
    !status!.suspended &&
    status!.blockers.length === 0;
  const deletionDate = status
    ? manilaDateTime(new Date(Date.now() + status.graceDays * 86_400_000))
    : "";

  const submit = async () => {
    if (!eligible || confirmText.trim() !== CONFIRM_WORD || submitting || !accessToken) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/account-deletion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: "schedule", reason: reason.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        scheduledFor?: string;
      };
      if (!response.ok || !body.scheduledFor) {
        throw new Error(body.error || "Your account could not be scheduled for deletion.");
      }
      toast.success("Your account is scheduled for deletion", {
        description: `It will be deleted on ${manilaDateTime(body.scheduledFor)}. Sign in before then and choose "Keep my account" if you change your mind. We also emailed you.`,
        duration: 12_000,
      });
      // The server has already ended every session; this clears this device.
      await signOut();
      navigate("/login", { replace: true });
    } catch (error) {
      toast.error("Account not deleted", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/80 p-4 py-6 backdrop-blur-sm animate-fade-in sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-deletion-title"
        className="w-full max-w-md overflow-hidden rounded-lg border border-red-500/20 bg-background shadow-2xl animate-scale-in"
      >
        <div className="space-y-3 p-6">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10">
            <FileWarning className="h-7 w-7 text-red-500" />
          </div>
          <h3 id="account-deletion-title" className="text-center text-xl font-bold tracking-tight">
            Delete your account?
          </h3>

          {!status && !loadError && (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your account...
            </p>
          )}

          {loadError && <p className="text-sm text-red-500">{loadError}</p>}

          {status && !status.canSelfDelete && (
            <p className="text-sm text-muted-foreground">
              Staff accounts are closed through admin management, not from here.
            </p>
          )}

          {status && status.canSelfDelete && status.scheduledFor && (
            <p className="text-sm text-muted-foreground">
              Your account is already scheduled for deletion on {manilaDateTime(status.scheduledFor)}.
            </p>
          )}

          {status && status.canSelfDelete && !status.scheduledFor && status.suspended && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                A suspended account cannot be deleted from here. Send a privacy request and
                SafeDrive will review it.
              </p>
              <Link
                to="/privacy-request?type=deletion"
                className="font-medium text-primary underline underline-offset-2"
                onClick={onClose}
              >
                Send a privacy request
              </Link>
            </div>
          )}

          {status && status.canSelfDelete && !status.scheduledFor && !status.suspended && status.blockers.length > 0 && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">Settle these first, then try again:</p>
              <ul className="list-disc space-y-1 pl-5 text-foreground">
                {status.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
              {/* A refund, a payout and a support case are finished by SafeDrive
                  support, not by the member - so say where to follow up. */}
              <p className="text-xs text-muted-foreground">
                Refunds, payouts and support cases are settled by SafeDrive support.{" "}
                <Link
                  to="/support"
                  className="font-medium text-primary underline underline-offset-2"
                  onClick={onClose}
                >
                  Open Support
                </Link>{" "}
                to follow up on them.
              </p>
            </div>
          )}

          {eligible && (
            <>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                <li>
                  Your account will be deleted on{" "}
                  <span className="font-medium text-foreground">{deletionDate}</span>, {status!.graceDays}{" "}
                  days from now.
                </li>
                <li>
                  Until then it is hidden: your listings are off SafeDrive and you cannot book or be
                  booked. You will be signed out now.
                </li>
                <li>
                  Changed your mind? Sign in before that date and choose "Keep my account".
                </li>
                <li>
                  After that date your personal details, ID photos and payout details are erased and
                  your login is closed. Bookings and payments you took part in are kept without your
                  name, as the Privacy Policy explains.
                </li>
              </ul>
              <div className="space-y-1.5">
                <Label htmlFor="account-deletion-reason">Why are you leaving? (optional)</Label>
                <textarea
                  id="account-deletion-reason"
                  rows={2}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="account-deletion-confirm">
                  Type {CONFIRM_WORD} to confirm
                </Label>
                <Input
                  id="account-deletion-confirm"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  autoComplete="off"
                  placeholder={CONFIRM_WORD}
                />
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3 border-t border-border bg-muted/30 p-4">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
            {eligible ? "Keep my account" : "Close"}
          </Button>
          {eligible && (
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => void submit()}
              disabled={submitting || confirmText.trim() !== CONFIRM_WORD}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete my account
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
