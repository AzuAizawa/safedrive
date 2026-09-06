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
export default function InstallButton({ className }: { className?: string }) {
  const { canInstall, showIosHint, isStandalone, promptInstall } = usePwaInstall();

  if (isStandalone || (!canInstall && !showIosHint)) return null;

  const handleClick = () => {
    if (canInstall) {
      void promptInstall();
      return;
    }
    if (showIosHint) {
      toast.info("Install SafeDrive", {
        description: 'Tap the Share icon in Safari, then "Add to Home Screen".',
      });
    }
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
