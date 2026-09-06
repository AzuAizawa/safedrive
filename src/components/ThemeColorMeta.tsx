import { useEffect } from "react";
import { useTheme } from "next-themes";

// index.html's static <meta name="theme-color"> is the correct default
// (matches the app's defaultTheme="dark" in App.tsx), but the app's own
// light/dark toggle (DashboardLayout.tsx) is independent of the OS
// prefers-color-scheme setting, so a `media` attribute on that meta tag
// would track the wrong thing. This keeps the OS chrome color (status bar /
// task-switcher card in an installed PWA) in sync with whichever theme is
// actually applied, not the device's setting.
const THEME_COLORS = {
  light: "#ffffff",
  dark: "#1a1a2e",
} as const;

export default function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta || !resolvedTheme) return;
    const color =
      THEME_COLORS[resolvedTheme as keyof typeof THEME_COLORS] ?? THEME_COLORS.dark;
    meta.setAttribute("content", color);
  }, [resolvedTheme]);

  return null;
}
