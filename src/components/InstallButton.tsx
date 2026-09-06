import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePwaInstall } from "@/lib/pwaInstall";

// The only install entry point (a separate dismissible banner was tried and
// removed - a single permanent control was judged clearer than two competing
// surfaces). Mounted in the landing page header and DashboardLayout's
// header, so it's reachable from both a first-time visitor's very first
// screen and every logged-in page afterward, always in the same place.
//
// Reported bug (round 1): the button disappeared after repeated page
// refreshes. Root cause - `beforeinstallprompt` is a one-shot-ish browser
// event; Chrome throttles/suppresses re-firing it on repeated loads within
// one session once it's fired and gone unused, so `canInstall` can
// legitimately be false on any given page load even on an installable
// browser. Fixed by never gating visibility on `canInstall`/`showIosHint`.
//
// Reported bug (round 2, over-correction): a fix at that point also
// stopped hiding the button when `isStandalone` (already installed) was
// true, worried that an uninstalled user would have no way back to an
// install control - but that then showed the button even while browsing
// FROM WITHIN the already-installed, running app, which is genuinely
// redundant (there's nothing left to install). `isStandalone` is a live,
// per-view check of the CURRENT tab/window, not a persistent "ever
// installed" flag - it already reads `false` again the moment the same
// site is opened in a normal browser tab (e.g. after the app was later
// uninstalled), so hiding on it does not strand anyone; it only hides the
// button in the one context where showing it would be confusing.
export default function InstallButton({ className }: { className?: string }) {
  const { canInstall, showIosHint, isStandalone, promptInstall } = usePwaInstall();

  if (isStandalone) return null;

  const handleClick = () => {
    if (canInstall) {
      void promptInstall();
      return;
    }
    if (showIosHint) {
      toast.info("Install SafeDrive", {
        description: 'Tap the Share icon in Safari, then "Add to Home Screen".',
      });
      return;
    }
    toast.info("Install SafeDrive", {
      description:
        "Look for the install icon in your browser's address bar, or open the browser menu and choose \"Install app\" / \"Add to Home Screen\".",
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-1.5", className)}
      onClick={handleClick}
    >
      <Download className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Install</span>
    </Button>
  );
}
