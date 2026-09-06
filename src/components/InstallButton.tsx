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
// Reported bug: the button disappeared after repeated page refreshes.
// Root cause - `beforeinstallprompt` is a one-shot-ish browser event;
// Chrome throttles/suppresses re-firing it on repeated loads within one
// session once it's fired and gone unused, so `canInstall` can legitimately
// be false on any given page load even on an installable browser. An
// earlier fix stopped hiding it for that reason, but still hid it whenever
// `isStandalone` (already installed) was true - reported as still wrong:
// if a user later uninstalls the app and needs to reinstall, they'd have no
// way back to an install control (isStandalone is a live, per-view check of
// the CURRENT tab, not a permanent "ever installed" flag, so it would
// actually already un-hide itself once they're back in a normal browser
// tab post-uninstall - but relying on that distinction being obvious, or on
// the browser API being consistent at all, is exactly the kind of fragility
// that caused the original bug). Simplest and most robust: never hide the
// button for any reason. It always renders, on every page, always in the
// same place - matching how an install control behaves on other sites.
export default function InstallButton({ className }: { className?: string }) {
  const { canInstall, showIosHint, isStandalone, promptInstall } = usePwaInstall();

  const handleClick = () => {
    if (canInstall) {
      void promptInstall();
      return;
    }
    if (isStandalone) {
      toast.info("SafeDrive is already installed on this device.");
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
