'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/client";

export function AdminSignOut() {
  const router = useRouter();
  const [error, setError] = useState("");

  if (!isSupabaseConfigured()) return null;

  async function signOut() {
    setError("");
    const { error: signOutError } = await createClient().auth.signOut();
    if (signOutError) {
      console.error("Supabase sign-out failed:", signOutError.message);
      setError("La déconnexion a échoué. Veuillez réessayer.");
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-red-700" role="alert">{error}</span>}
      <button
        className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        onClick={() => void signOut()}
        type="button"
      >
        Déconnexion
      </button>
    </div>
  );
}
