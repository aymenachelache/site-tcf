'use client';

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/client";

export function PasswordUpdateForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!isSupabaseConfigured()) {
      setError("Supabase n’est pas configuré : le mot de passe ne peut pas être modifié.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    if (password !== formData.get("confirmPassword")) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) throw updateError;
      setNotice("Votre mot de passe a été modifié.");
      window.setTimeout(() => {
        router.replace("/dashboard");
        router.refresh();
      }, 1000);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "La mise à jour du mot de passe a échoué.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="auth-field">
        <span>Nouveau mot de passe</span>
        <input autoComplete="new-password" minLength={8} name="password" required type="password" />
      </label>
      <label className="auth-field">
        <span>Confirmer le mot de passe</span>
        <input autoComplete="new-password" minLength={8} name="confirmPassword" required type="password" />
      </label>
      {error && <p className="auth-message auth-error" role="alert">{error}</p>}
      {notice && <p className="auth-message auth-notice" role="status">{notice}</p>}
      <button className="auth-submit" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Veuillez patienter…" : "Enregistrer le nouveau mot de passe"}
      </button>
    </form>
  );
}
