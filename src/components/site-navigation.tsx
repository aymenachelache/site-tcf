'use client';

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/client";

type NavigationUser = { id: string; role: string | null };

const navItems = [
  { href: "/dashboard", label: "Tableau de bord" },
  { href: "/tarifs", label: "Tarifs" },
  { href: "/examen", label: "Examens" },
  { href: "/mes-acces", label: "Mes accès / paiements" },
  { href: "/admin", label: "Admin" },
  { href: "/login", label: "Connexion" },
];

export function SiteNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<NavigationUser | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured());
  const [authError, setAuthError] = useState("");
  const [pendingPaymentCount, setPendingPaymentCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createClient();
    let active = true;

    async function loadUser() {
      const { data, error } = await supabase.auth.getUser();
      if (error && error.name !== "AuthSessionMissingError") {
        console.error("Unable to load navigation session:", error.message);
        if (active) setAuthError("La session n’a pas pu être vérifiée.");
      } else if (active && data.user) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (profileError) {
          console.error("Unable to load navigation profile:", profileError.message);
          if (active) setAuthError("Le profil n’a pas pu être chargé.");
        }
        const role = profile?.role ?? null;
        if (active) setUser({ id: data.user.id, role });
        if (role === "admin") {
          const { count, error: countError } = await supabase
            .from("payment_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending");
          if (countError) {
            console.error("Unable to load pending payment request count:", countError.message);
            if (active) setPendingPaymentCount(null);
          } else if (active) {
            setPendingPaymentCount(count ?? 0);
          }
        } else if (active) {
          setPendingPaymentCount(null);
        }
      } else if (active) {
        setUser(null);
        setPendingPaymentCount(null);
        setAuthError("");
      }
      if (active) setAuthReady(true);
    }

    void loadUser();
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => void loadUser(), 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    setAuthError("");
    const { error } = await createClient().auth.signOut();
    if (error) {
      console.error("Supabase sign-out failed:", error.message);
      setAuthError("La déconnexion a échoué. Veuillez réessayer.");
      return;
    }
    setUser(null);
    router.replace("/login");
    router.refresh();
  }

  if (
    pathname === "/" ||
    pathname === "/exam" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password"
  ) return null;

  return (
    <header className="topbar">
      <div className="container flex items-center justify-between gap-4 py-4">
        <Link href="/" className="font-bold tracking-tight text-slate-900">
          TCF Simulation
        </Link>
        <div className="flex items-center gap-4">
          <ThemeToggle className="catalog-theme-toggle" />
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            {navItems.filter((item) => item.href !== "/admin" || user?.role === "admin")
              .filter((item) => {
                if (!isSupabaseConfigured() || !authReady) return true;
                return user
                  ? item.href !== "/login"
                  : item.href !== "/dashboard" && item.href !== "/mes-acces";
              })
              .map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-slate-900">
                  {item.label}
                  {item.href === "/admin" && pendingPaymentCount !== null && pendingPaymentCount > 0 && (
                    <span
                      aria-label={`${pendingPaymentCount} demandes en attente`}
                      className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-bold leading-none text-white"
                    >
                      {pendingPaymentCount}
                    </span>
                  )}
                </Link>
              ))}
            {isSupabaseConfigured() && authReady && user && (
              <button type="button" className="hover:text-slate-900" onClick={signOut}>
                Déconnexion
              </button>
            )}
          </nav>
        </div>
      </div>
      {authError && <p className="container pb-3 text-sm text-red-700" role="alert">{authError}</p>}
    </header>
  );
}
