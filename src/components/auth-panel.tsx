'use client';

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { normalizeAlgerianPhone } from "@/lib/algerian-phone";
import { createClient } from "@/utils/supabase/client";

type AuthMode = "signin" | "signup" | "reset";

export function AuthPanel({
  initialMode = "signin",
  initialError = "",
}: {
  initialMode?: AuthMode;
  initialError?: string;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(initialError);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSignup = initialMode === "signup";
  const isReset = initialMode === "reset";

  useEffect(() => {
    const errorCode = new URLSearchParams(window.location.search).get("error");
    if (errorCode !== "verification" && errorCode !== "access" && errorCode !== "suspended") return;

    const timer = window.setTimeout(() => {
      setError(
        errorCode === "verification"
          ? "Le lien de vérification est invalide ou expiré. Demandez un nouvel e-mail d’inscription."
          : errorCode === "suspended"
            ? "Votre compte est désactivé. Contactez le support."
            : "Ce compte ne peut pas accéder à cet espace.",
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    const formData = new FormData(event.currentTarget);
    if (isSignup && formData.get("password") !== formData.get("confirmPassword")) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    const phone = isSignup ? normalizeAlgerianPhone(String(formData.get("phone") ?? "")) : null;
    if (isSignup && !phone) {
      setError("Saisissez un numéro algérien valide, par exemple 05XX XX XX XX ou +213...");
      return;
    }

    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    if (!isSupabaseConfigured()) {
      setNotice(
        isReset
          ? "Supabase n’est pas configuré : aucun e-mail de réinitialisation n’a été envoyé."
          : isSignup
            ? "Mode démonstration : aucun compte n’a été créé."
            : "Mode démonstration : aucun compte n’a été connecté.",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = createClient();

      if (isReset) {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        });
        if (resetError) throw resetError;
        setNotice("Si un compte correspond à cette adresse, un lien de réinitialisation va vous être envoyé.");
        return;
      }

      if (isSignup) {
        const { error: signupError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
            data: {
              first_name: String(formData.get("firstName") ?? "").trim(),
              last_name: String(formData.get("lastName") ?? "").trim(),
              phone,
            },
          },
        });
        if (signupError) throw signupError;
        setNotice("Inscription enregistrée. Consultez votre boîte e-mail pour vérifier votre adresse avant de vous connecter.");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        if (/banned|suspend/i.test(signInError.message)) {
          setError("Votre compte est désactivé. Contactez le support.");
          return;
        }
        throw signInError;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      router.replace(destination);
      router.refresh();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Une erreur d’authentification est survenue.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      {!isReset && <div className="auth-mode-tabs" aria-label="Choisir le type d’accès">
        <Link className={!isSignup ? "auth-mode-active" : ""} href="/login" aria-current={!isSignup ? "page" : undefined}>
          Connexion
        </Link>
        <Link className={isSignup ? "auth-mode-active" : ""} href="/register" aria-current={isSignup ? "page" : undefined}>
          Inscription
        </Link>
      </div>}

      <form className="auth-form" onSubmit={handleSubmit}>
        {isSignup && (
          <div className="auth-name-fields">
            <label className="auth-field">
              <span>Prénom</span>
              <input autoComplete="given-name" name="firstName" placeholder="Votre prénom" required />
            </label>
            <label className="auth-field">
              <span>Nom</span>
              <input autoComplete="family-name" name="lastName" placeholder="Votre nom" required />
            </label>
          </div>
        )}

        {isSignup && (
          <label className="auth-field">
            <span>Numéro de téléphone</span>
            <input
              autoComplete="tel"
              name="phone"
              placeholder="05XX XX XX XX ou +213..."
              required
              type="tel"
            />
          </label>
        )}

        <label className="auth-field">
          <span>Adresse e-mail</span>
          <input
            autoComplete="email"
            name="email"
            placeholder="vous@exemple.com"
            required
            type="email"
          />
        </label>

        {!isReset && (
          <label className="auth-field">
            <span>Mot de passe</span>
            <input
              autoComplete={isSignup ? "new-password" : "current-password"}
              minLength={8}
              name="password"
              placeholder="8 caractères minimum"
              required
              type="password"
            />
          </label>
        )}

        {isSignup && (
          <label className="auth-field">
            <span>Confirmer le mot de passe</span>
            <input
              autoComplete="new-password"
              minLength={8}
              name="confirmPassword"
              placeholder="Répétez votre mot de passe"
              required
              type="password"
            />
          </label>
        )}

        {error && <p className="auth-message auth-error" role="alert">{error}</p>}
        {notice && <p className="auth-message auth-notice" role="status">{notice}</p>}

        <button className="auth-submit" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Veuillez patienter…" : isReset ? "Envoyer le lien" : isSignup ? "Créer mon compte" : "Se connecter"}
          <span aria-hidden="true">→</span>
        </button>
      </form>

      {isReset ? (
        <p className="auth-switch-note"><Link href="/login">Retour à la connexion</Link></p>
      ) : isSignup ? (
        <p className="auth-legal">
          En créant un compte, vous acceptez que votre adresse e-mail soit utilisée pour gérer votre accès à la plateforme.
        </p>
      ) : (
        <>
          <p className="auth-switch-note"><Link href="/forgot-password">Mot de passe oublié ?</Link></p>
          <p className="auth-switch-note">
            Pas encore de compte ? <Link href="/register">Créer un compte</Link>
          </p>
        </>
      )}
    </div>
  );
}
