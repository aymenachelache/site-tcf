'use client';

import { useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function subscribeToTheme(onChange: () => void) {
  window.addEventListener("site-theme-change", onChange);
  return () => window.removeEventListener("site-theme-change", onChange);
}

function getThemeSnapshot(): Theme | null {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : null;
}

function getServerThemeSnapshot(): null {
  return null;
}

export function ThemeToggle({ className }: { className: string }) {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("site-theme");
    const initialTheme: Theme =
      savedTheme === "light" || savedTheme === "dark"
        ? savedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    document.documentElement.dataset.theme = initialTheme;
    window.dispatchEvent(new Event("site-theme-change"));
  }, []);

  function toggleTheme() {
    const currentTheme = theme ?? (
      window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    );
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("site-theme", nextTheme);
    window.dispatchEvent(new Event("site-theme-change"));
  }

  return (
    <button
      type="button"
      className={className}
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Activer le thème clair" : "Activer le thème sombre"}
      title={theme === "dark" ? "Mode clair" : "Mode sombre"}
    >
      {theme === "dark" ? (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M20.3 15.3A8.5 8.5 0 0 1 8.7 3.7 8.5 8.5 0 1 0 20.3 15.3Z" />
        </svg>
      )}
    </button>
  );
}
