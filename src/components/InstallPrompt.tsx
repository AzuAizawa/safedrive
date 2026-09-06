import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Renter/lister-facing "install SafeDrive" nudge. Mounted once at the App
// root (so it also reaches the public landing/login/signup pages, not just
// the logged-in DashboardLayout shell - a first-time mobile visitor should
// be able to install before ever creating an account) and hides itself on
// /admin/* via the pathname check below, since that surface stays desktop-
// oriented.
//
// Android/Chrome exposes `beforeinstallprompt`, which we capture and defer so
// we can trigger it from our own button instead of the browser's default
// mini-infobar. iOS Safari has no such API at all - there is no way to
// programmatically trigger "Add to Home Screen," so iOS gets an instructional
// variant instead of a button that would do nothing.

const DISMISS_KEY = "safedrive:install-prompt-dismissed-at";
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    nav.standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafariEngine = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  return isIos && isSafariEngine;
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Private mode - nothing persisted, prompt may reappear next visit. Fine.
  }
}

export default function InstallPrompt() {
  const location = useLocation();
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplay() || wasRecentlyDismissed()) return;

    if (isIosSafari()) {
      setShowIosHint(true);
      return;
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleDismiss = () => {
    dismiss();
    setDismissed(true);
  };

  const handleInstall = async () => {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    await deferredEvent.userChoice;
    setDeferredEvent(null);
  };

  if (location.pathname.startsWith("/admin")) return null;
  if (dismissed || (!deferredEvent && !showIosHint)) return null;

  return (
    <div className="fixed bottom-[calc(5rem_+_var(--safe-bottom))] left-4 right-4 z-[80] mx-auto max-w-sm rounded-xl border border-border/70 bg-card p-3 shadow-2xl animate-fade-in sm:left-auto sm:right-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {showIosHint ? <Share className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-foreground">Install SafeDrive</p>
          {showIosHint ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tap the Share icon, then &quot;Add to Home Screen&quot; for quick access.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Add it to your home screen for faster, app-like access.
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 -mr-1 -mt-1"
          aria-label="Dismiss install prompt"
          onClick={handleDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {!showIosHint && (
        <Button
          type="button"
          size="sm"
          className="mt-3 w-full gap-1.5"
          onClick={() => void handleInstall()}
        >
          <Download className="h-3.5 w-3.5" />
          Install
        </Button>
      )}
    </div>
  );
}
