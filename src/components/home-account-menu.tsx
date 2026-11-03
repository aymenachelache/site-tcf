'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/client";

type AccountRole = "admin" | "user";

function initialsForUser(user: User): string {
  const metadataName = user.user_metadata.full_name ?? user.user_metadata.name;
  if (typeof metadataName === "string") {
    const initials = metadataName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("");
    if (initials) return initials.toUpperCase();
  }
  return user.email?.trim().charAt(0).toUpperCase() || "U";
}

export function HomeAccountMenu() {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AccountRole | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured());
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const supabase = createClient();
    let active = true;

    async function loadUser() {
      const { data, error: userError } = await supabase.auth.getUser();
      if (!active) return;
      if (userError && userError.name !== "AuthSessionMissingError") {
        console.error("Unable to load homepage session:", userError.message);
        setError("La session n’a pas pu être vérifiée.");
      } else {
        setUser(data.user);
        setError("");
        if (data.user) {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("role")
            .eq("user_id", data.user.id)
            .maybeSingle();
          if (!active) return;
          if (profileError) {
            console.error("Unable to load homepage account role:", profileError.message);
            setError("Le rôle du compte n’a pas pu être vérifié.");
          } else {
            setRole(profile?.role === "admin" ? "admin" : "user");
          }
        } else {
          setRole(null);
        }
      }
      setAuthReady(true);
    }

    void loadUser();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setRole(null);
      setOpen(false);
      setError("");
      setAuthReady(true);
      if (session?.user) {
        window.setTimeout(async () => {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("role")
            .eq("user_id", session.user.id)
            .maybeSingle();
          if (!active) return;
          if (profileError) {
            console.error("Unable to load homepage account role:", profileError.message);
            setError("Le rôle du compte n’a pas pu être vérifié.");
          } else {
            setRole(profile?.role === "admin" ? "admin" : "user");
          }
        }, 0);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function signOut() {
    const { error: signOutError } = await createClient().auth.signOut();
    if (signOutError) {
      console.error("Supabase sign-out failed:", signOutError.message);
      setError("La déconnexion a échoué. Veuillez réessayer.");
      return;
    }
    setOpen(false);
    setUser(null);
    setRole(null);
    setError("");
    router.refresh();
  }

  if (!authReady) {
    return <span className="home-account-placeholder" aria-label="Vérification de la session" />;
  }

  if (!user) {
    return (
      <div className="home-account-actions">
        {error && <span className="home-account-error" role="alert">{error}</span>}
        <Link className="home-login" href="/login">Connexion</Link>
      </div>
    );
  }

  return (
    <div className="home-account-menu" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Ouvrir le menu du compte"
        className="home-account-trigger"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        type="button"
      >
        <span className="home-account-avatar" aria-hidden="true">{initialsForUser(user)}</span>
      </button>
      {open && (
        <div className="home-account-dropdown" role="menu">
          <div className="home-account-dropdown-header">
            <span className="home-account-avatar home-account-avatar-small" aria-hidden="true">{initialsForUser(user)}</span>
            <span className="home-account-user-label">
              <strong>Mon compte</strong>
              <small>{user.email}</small>
            </span>
          </div>
          <Link
            className="home-account-dropdown-item"
            href={role === "admin" ? "/admin" : "/dashboard"}
            onClick={() => setOpen(false)}
            role="menuitem"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <rect x="2.5" y="2.5" width="6" height="6" rx="1" />
              <rect x="11.5" y="2.5" width="6" height="6" rx="1" />
              <rect x="2.5" y="11.5" width="6" height="6" rx="1" />
              <rect x="11.5" y="11.5" width="6" height="6" rx="1" />
            </svg>
            {role === "admin" ? "Dashboard admin" : "Dashboard"}
          </Link>
          <Link
            className="home-account-dropdown-item"
            href="/mes-acces"
            onClick={() => setOpen(false)}
            role="menuitem"
          >
            Mes accès / paiements
          </Link>
          <button
            className="home-account-dropdown-item home-account-signout"
            onClick={() => void signOut()}
            role="menuitem"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="M8 3H4.5A1.5 1.5 0 0 0 3 4.5v11A1.5 1.5 0 0 0 4.5 17H8" />
              <path d="M11 6l4 4-4 4m4-4H7" />
            </svg>
            Déconnexion
          </button>
          {error && <p className="home-account-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
