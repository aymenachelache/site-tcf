"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function subscribe(onChange: () => void) {
  window.addEventListener("site-theme-change", onChange);
  return () => window.removeEventListener("site-theme-change", onChange);
}

function getTheme(): Theme | null {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : null;
}

function getServerTheme(): null {
  return null;
}

export function CandidateDashboardShell({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  return (
    <div className="candidate-dashboard-shell" data-theme={theme ?? undefined}>
      {children}
    </div>
  );
}
