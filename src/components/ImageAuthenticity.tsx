import { useCallback, useEffect, useId, useRef, useState } from "react";
import { format } from "date-fns";
import {
  ChevronDown,
  CircleSlash,
  Loader2,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import ConfirmDialog from "@/components/ConfirmDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  authenticitySubjectKey,
  DETECTOR_LABELS,
  describeCheck,
  detectorOf,
  fetchImageChecks,
  indexChecks,
  OVERALL_LABELS,
  OVERALL_REJECT_AVERAGE,
  OVERALL_REJECT_SINGLE,
  summarizeAuthenticity,
  type AuthenticityCheck,
  type AuthenticitySubject,
  type AuthenticityTone,
  type DetectorProvider,
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
  /** Check every file again with the chosen detector, replacing its current result. */
  recheckAll: () => Promise<void>;
  running: boolean;
  /** The detector the reviewer's buttons use: Walter Writes, or Sightengine as the backup. */
  provider: DetectorProvider;
  setProvider: (provider: DetectorProvider) => void;
  /** Which detectors have keys on the server. */
  providers: Record<DetectorProvider, boolean>;
};

/**
 * Every AI-image check for one user's identity photos or one vehicle's photos
 * and documents (CHAPTER 108). Opening a review only reads what is stored -
 * credits are spent when the reviewer presses the button. Nothing here ever
 * blocks the review itself.
 */
export function useImageAuthenticity(subject: AuthenticitySubject | null): ImageAuthenticityState {
  const key = subject ? authenticitySubjectKey(subject) : null;
  const [checks, setChecks] = useState<Record<string, AuthenticityCheck>>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  // Set once the reviewer presses the button: only then does the screen keep
  // asking while files wait on the detector's per-minute limit.
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [provider, setProvider] = useState<DetectorProvider>("walter");
  const [providers, setProviders] = useState<Record<DetectorProvider, boolean>>({ walter: true, sightengine: false });
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const checksRef = useRef(checks);
  checksRef.current = checks;
  // Set while "check all again" is under way: the newest server checked_at at
  // the moment it was pressed. Everything checked at or before it is redone.
  const sinceRef = useRef<string | null>(null);
  const polls = useRef(0);

  const request = useCallback(async (mode: "run" | "force" | "peek") => {
    const current = subjectRef.current;
    if (!current) return null;
    try {
      const result = await fetchImageChecks(current, mode, providerRef.current, sinceRef.current);
      setChecks(indexChecks(result.checks));
      setRemaining(result.remaining);
      setStopReason(result.stopReason);
      setProviders(result.providers);
      setError(null);
      // A wait on the per-minute limit keeps the cutoff, so the poll finishes the redo.
      const waitingOnLimit = result.stopReason === "rate_limited" || result.stopReason === "busy";
      if (result.remaining === 0 || (result.stopReason && !waitingOnLimit)) sinceRef.current = null;
      return result;
    } catch (reason) {
      sinceRef.current = null;
      setError(reason instanceof Error ? reason.message : "Image check is unavailable.");
      return null;
    }
  }, []);

  useEffect(() => {
    setChecks({});
    setRemaining(0);
    setStopReason(null);
    setError(null);
    setActive(false);
    polls.current = 0;
    sinceRef.current = null;
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
  const recheckAll = useCallback(async () => {
    const times = Object.values(checksRef.current).map((check) => new Date(check.checked_at).getTime());
    sinceRef.current = times.length ? new Date(Math.max(...times)).toISOString() : null;
    polls.current = 0;
    setActive(true);
    setRunning(true);
    // The server checks a few files per call; keep going until all are done
    // or the detector stops (a wait on its per-minute limit is polled after).
    for (let round = 0; round < 8; round += 1) {
      const result = await request("force");
      if (!result || result.remaining === 0 || result.stopReason) break;
    }
    setRunning(false);
  }, [request]);

  // A stop reason belongs to the detector that gave it.
  const chooseProvider = useCallback((next: DetectorProvider) => {
    setProvider(next);
    setStopReason(null);
  }, []);

  return {
    checks,
    loading,
    error,
    remaining,
    stopReason,
    run,
    recheck,
    recheckAll,
    running,
    provider,
    setProvider: chooseProvider,
    providers,
  };
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
              {/* Sightengine has no separate AI-edit score. */}
              {detectorOf(check) === "walter" && (
                <Bar label="AI-edited" value={check.prob_inpainting} tone="bg-amber-500" />
              )}
            </div>
          )}
          <p className="border-t pt-1.5 text-[10px] leading-snug text-muted-foreground">
            A guide from the {DETECTOR_LABELS[detectorOf(check)]} image detector, not a decision. It can miss a
            fake and can flag a real photo - you approve or reject.
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
  const [confirmAll, setConfirmAll] = useState(false);
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
  const overall = summarizeAuthenticity(unique.map((path) => state.checks[path]));
  const blocked = state.stopReason && !["rate_limited", "busy"].includes(state.stopReason)
    ? describeCheck({
        status: "unavailable",
        reason: state.stopReason,
        detector: state.provider === "sightengine" ? "sightengine-genai" : "walter-image-detector",
      } as AuthenticityCheck)
    : null;
  const usedBackup = unique.some(
    (path) => state.checks[path]?.status === "checked" && detectorOf(state.checks[path]) === "sightengine",
  );
  const providerLabel = DETECTOR_LABELS[state.provider];
  // The detector beside the reviewer's button: Walter Writes first, Sightengine
  // when Walter is down. An upload only ever uses Walter Writes.
  const providerMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1 px-2")}
        disabled={state.loading || state.running}
        aria-label={`Detector: ${providerLabel}. Change detector`}
      >
        {providerLabel}
        <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {/* A Base UI group label must sit inside a group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs">Detector for this check</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={state.provider}
          onValueChange={(value) => state.setProvider(value as DetectorProvider)}
        >
          <DropdownMenuRadioItem value="walter" className="flex-col items-start">
            <span>Walter Writes (primary)</span>
            <span className="text-[11px] text-muted-foreground">Real, AI-generated or AI-edited</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="sightengine"
            disabled={!state.providers.sightengine}
            className="flex-col items-start"
          >
            <span>Sightengine (backup)</span>
            <span className="text-[11px] text-muted-foreground">
              {state.providers.sightengine ? "Use when Walter Writes is down" : "No Sightengine key set on the server"}
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

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
            Walter Writes image detector{usedBackup ? " · some files by Sightengine (backup)" : ""} · a guide for
            you, not a decision
          </p>
        </div>
        {unchecked + waiting > 0 ? (
          <div className="flex items-center gap-1">
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
          {providerMenu}
          </div>
        ) : retryable > 0 ? (
          <div className="flex items-center gap-1">
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
          {providerMenu}
          </div>
        ) : (
          // Every file has an answer: the reviewer may still ask again, with
          // either detector - for a second opinion, or after Walter Writes was down.
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={state.loading || state.running}
              onClick={() => setConfirmAll(true)}
            >
              {state.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Check all again ({unique.length})
            </Button>
            {providerMenu}
          </div>
        )}
      </div>

      {!state.loading && overall.suggestion && overall.average != null && overall.highest != null && (
        <div
          className={cn(
            "mt-2 rounded-md border px-3 py-2",
            TONE_CLASSES[OVERALL_LABELS[overall.suggestion].tone],
          )}
        >
          <p className="text-sm font-semibold">
            Overall: {Math.round(overall.average * 100)}% likely AI-generated or edited ·{" "}
            {OVERALL_LABELS[overall.suggestion].label}
          </p>
          <p className="mt-0.5 text-xs opacity-90">
            Average of {overall.checked} of {overall.total} file{overall.total === 1 ? "" : "s"} checked
            {" · "}highest single file {Math.round(overall.highest * 100)}%.
            {overall.suggestion === "reject" && overall.average <= OVERALL_REJECT_AVERAGE
              ? ` One file alone is at or above ${Math.round(OVERALL_REJECT_SINGLE * 100)}%, which is enough to suggest rejecting.`
              : ""}
            {" "}A guide only - you decide.
          </p>
        </div>
      )}

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

      <ConfirmDialog
        open={confirmAll}
        title={`Check all ${unique.length} file${unique.length === 1 ? "" : "s"} again?`}
        description={`Every file is sent to ${providerLabel} again and its current result is replaced. This uses ${
          state.provider === "sightengine" ? "Sightengine operations (5 per image)" : "Walter Writes credits (1 per image)"
        }; PDFs are skipped and cost nothing.`}
        confirmText={`Check again with ${providerLabel}`}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => {
          setConfirmAll(false);
          void state.recheckAll();
        }}
      />
    </div>
  );
}
