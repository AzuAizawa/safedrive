import { useEffect, useRef } from "react";
import { Outlet } from "react-router";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { setPortalMode, type PortalMode } from "@/lib/listerMode";

/**
 * Backstop for direct URL / bookmarked / email-link entry into a space that
 * belongs to the other portal mode. Renders its children immediately (never
 * blocks) and, if the account is in the wrong mode, flips it in the background
 * and refreshes so the surrounding nav matches the page.
 *
 * The notification click handler already switches mode before navigating, so
 * this only fires for entries that skip it.
 */
export default function ModeRoute({ mode }: { mode: PortalMode }) {
  const { profile, user, refreshProfile } = useAuth();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || !profile) return;
    const current: PortalMode = profile.is_lister ? "lister" : "renter";
    if (current === mode) return;
    if (mode === "lister" && profile.verified_status !== "verified") return;

    handled.current = true;
    void (async () => {
      const changed = await setPortalMode(user?.id, mode);
      if (changed) {
        await refreshProfile();
        toast.info(
          mode === "lister" ? "Switched to Lister mode" : "Switched to Renter mode",
          { description: "So this screen matches your navigation." },
        );
      }
    })();
  }, [profile, user, mode, refreshProfile]);

  return <Outlet />;
}
