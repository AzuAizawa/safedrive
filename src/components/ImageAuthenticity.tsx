import { useCallback, useEffect, useId, useRef, useState } from "react";
import { format } from "date-fns";
import { CircleSlash, Loader2, RefreshCw, ScanSearch, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  describeCheck,
  fetchImageChecks,
  indexChecks,
  type AuthenticityCheck,
  type AuthenticitySubject,
  type AuthenticityTone,
} from "@/lib/imageAuthenticity";
import { cn } from "@/lib/utils";

// While files are still waiting on the detector's per-minute limit, ask again
// this often - and stop after a while so an open tab does not poll forever.
const POLL_MS = 15_000;
const MAX_POLLS = 12;

export type ImageAuthenticityState = {
  checks: Record<string, AuthenticityCheck>;
  loading: boolean;
  error: string | null;
  remaining: number;
  stopReason: string | null;
  /** Run the check on files that have none yet (the reviewer's button). */
  run: () => Promise<void>;
  /** Also retry files the detector could not do - expired trial, no credits. */
  recheck: () => Promise<void>;
  running: boolean;
};

/**
 * Every AI-image check for one user's identity photos or one vehicle's photos
 * and documents (CHAPTER 108). Opening a review only reads what is stored -
 * credits are spent when the reviewer presses the button. Nothing here ever
 * blocks the review itself.
 */
export function useImageAuthenticity(subject: AuthenticitySubject | null): ImageAuthenticityState {
  const key = subject ? (subject.scope === "car" ? `car:${subject.carId}` : `user:${subject.userId ?? "me"}`) : null;
  const [checks, setChecks] = useState<Record<string, AuthenticityCheck>>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  // Set once the reviewer presses the button: only then does the screen keep
  // asking while files wait on the detector's per-minute limit.
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const polls = useRef(0);

  const request = useCallback(async (mode: "run" | "force" | "peek") => {
    const current = subjectRef.current;
    if (!current) return;
    try {
      const result = await fetchImageChecks(current, mode);
      setChecks(indexChecks(result.checks));
      setRemaining(result.remaining);
      setStopReason(result.stopReason);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Image check is unavailable.");
    }
  }, []);

  useEffect(() => {
    setChecks({});
    setRemaining(0);
    setStopReason(null);
    setError(null);
    setActive(false);
    polls.current = 0;
    if (!key) return;
    setLoading(true);
    void request("peek").finally(() => setLoading(false));
  }, [key, request]);

  // Keep going while files wait on the rate limit, not when the detector is
  // unusable (expired, out of credits) - that needs a person.
  useEffect(() => {
    const waiting = remaining > 0 && (stopReason === null || stopReason === "rate_limited" || stopReason === "busy");
    if (!key || !active || loading || running || !waiting || polls.current >= MAX_POLLS) return;
    const timer = window.setTimeout(() => {
      polls.current += 1;
      void request("run");
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [key, active, loading, running, remaining, stopReason, checks, request]);

  const start = useCallback(
    async (mode: "run" | "force") => {
      polls.current = 0;
      setActive(true);
      setRunning(true);
      await request(mode);
      setRunning(false);
    },
    [request],
  );
  const run = useCallback(() => start("run"), [start]);
  const recheck = useCallback(() => start("force"), [start]);

  return { checks, loading, error, remaining, stopReason, run, recheck, running };
}

const TONE_CLASSES: Record<AuthenticityTone, string> = {
  ok: "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300",
  danger: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  neutral: "border-border bg-muted text-muted-foreground",
  busy: "border-border bg-muted text-muted-foreground",
};

const ToneIcon = ({ tone, className }: { tone: AuthenticityTone; className?: string }) => {
  if (tone === "ok") return <ShieldCheck className={className} aria-hidden="true" />;
  if (tone === "danger") return <ShieldAlert className={className} aria-hidden="true" />;
  if (tone === "warning") return <TriangleAlert className={className} aria-hidden="true" />;
  if (tone === "busy") return <Loader2 className={cn(className, "animate-spin")} aria-hidden="true" />;
  return <CircleSlash className={className} aria-hidden="true" />;
};

const Bar = ({ label, value, tone }: { label: string; value: number | null; tone: string }) => {
  const percent = value == null ? null : Math.round(value * 100);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between gap-2 text-[11px]">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{percent == null ? "-" : `${percent}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${percent ?? 0}%` }} />
      </div>
    </div>
  );
};

/**
 * One file's verdict, under its preview. Pressing it opens the three
 * probabilities and what the verdict does and does not mean.
 */
export function ImageAuthenticityBadge({
  state,
  path,
  className,
}: {
  state: ImageAuthenticityState;
  path: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const check = state.checks[path];
  const described =
    state.error && !check
      ? { label: "Not checked", tone: "neutral" as const, detail: state.error }
      : describeCheck(check);

  return (
    <div className={cn("max-w-full", className)}>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-controls={detailsId}
        title="AI image check - press for details"
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold",
          TONE_CLASSES[described.tone],
        )}
      >
        <ToneIcon tone={described.tone} className="h-3 w-3 shrink-0" />
        <span className="truncate">{described.label}</span>
      </button>
      {open && (
        <div
          id={detailsId}
          className="mt-1 w-56 max-w-full space-y-2 rounded-md border bg-card p-2.5 text-left text-card-foreground shadow-sm"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-[11px] leading-snug">{described.detail}</p>
          {check?.status === "checked" && (
            <div className="space-y-1.5">
              <Bar label="Real photo" value={check.prob_real} tone="bg-green-500" />
              <Bar label="AI-generated" value={check.prob_fake} tone="bg-red-500" />
              <Bar label="AI-edited" value={check.prob_inpainting} tone="bg-amber-500" />
            </div>
          )}
          <p className="border-t pt-1.5 text-[10px] leading-snug text-muted-foreground">
            A guide from the Walter Writes image detector, not a decision. It can miss a fake and can flag a
            real photo - you approve or reject.
            {check?.checked_at ? ` Checked ${format(new Date(check.checked_at), "MMM d, h:mm a")}.` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

/** The headline for a review: how many files were checked, flagged or skipped, and Check again. */
export function ImageAuthenticitySummary({
  state,
  paths,
  className,
}: {
  state: ImageAuthenticityState;
  /** The files this review shows, so the counts match what is on screen. */
  paths: string[];
  className?: string;
}) {
  const unique = [...new Set(paths)];
  const described = unique.map((path) => describeCheck(state.checks[path]));
  const count = (tone: AuthenticityTone) => described.filter((item) => item.tone === tone).length;
  const flagged = count("danger") + count("warning");
  const clear = count("ok");
  const unchecked = unique.filter((path) => !state.checks[path]).length;
  const waiting = count("busy");
  const skipped = count("neutral") - unchecked;
  // Files the detector could not do (expired trial, no credits, detector down)
  // are retried only on purpose.
  const retryable = unique.filter((path) => state.checks[path]?.status === "unavailable").length;
  const blocked = state.stopReason && !["rate_limited", "busy"].includes(state.stopReason)
    ? describeCheck({ status: "unavailable", reason: state.stopReason } as AuthenticityCheck)
    : null;

  if (unique.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        flagged > 0 ? "border-red-500/30 bg-red-500/5" : "border-border bg-muted/20",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">
            <ScanSearch className="h-4 w-4 text-primary" aria-hidden="true" /> AI image check
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Walter Writes image detector · a guide for you, not a decision
          </p>
        </div>
        {unchecked + waiting > 0 ? (
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={state.loading || state.running}
            onClick={() => void state.run()}
          >
            {state.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
            Run AI check ({unchecked + waiting})
          </Button>
        ) : retryable > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={state.loading || state.running}
            onClick={() => void state.recheck()}
          >
            {state.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Check again ({retryable})
          </Button>
        ) : null}
      </div>

      {state.loading ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading results…
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-medium">
          {flagged > 0 && (
            <span className={cn("rounded-full border px-2 py-0.5", TONE_CLASSES.danger)}>
              {flagged} flagged for a closer look
            </span>
          )}
          {clear > 0 && <span className={cn("rounded-full border px-2 py-0.5", TONE_CLASSES.ok)}>{clear} no AI detected</span>}
          {waiting > 0 && (
            <span className={cn("rounded-full border px-2 py-0.5", TONE_CLASSES.busy)}>{waiting} waiting</span>
          )}
          {unchecked > 0 && (
            <span className={cn("rounded-full border px-2 py-0.5", TONE_CLASSES.neutral)}>
              {unchecked} not run yet
            </span>
          )}
          {skipped > 0 && (
            <span className={cn("rounded-full border px-2 py-0.5", TONE_CLASSES.neutral)}>{skipped} not checked</span>
          )}
        </div>
      )}

      {(blocked || state.error) && (
        <p className="mt-2 text-xs text-amber-800 dark:text-amber-300" role="status">
          {blocked ? `${blocked.label}. ${blocked.detail}` : state.error} The review works as usual without it.
        </p>
      )}
    </div>
  );
}
