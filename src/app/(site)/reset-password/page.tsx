import Link from "next/link";
import { PasswordUpdateForm } from "@/components/password-update-form";
import "@/app/auth.css";

export default function ResetPasswordPage() {
  return (
    <div id="auth-page">
      <header className="auth-header">
        <Link className="auth-brand" href="/" aria-label="TCF Simulation, accueil">
          <span className="auth-brand-mark" aria-hidden="true">TCF</span>
          <span>Simulation</span>
        </Link>
        <Link className="auth-back-link" href="/login">Retour à la connexion</Link>
      </header>
      <main className="auth-main">
        <section className="auth-card-column">
          <div className="auth-intro">
            <span className="auth-eyebrow">SÉCURITÉ DU COMPTE</span>
            <h1>Choisissez un nouveau mot de passe</h1>
            <p>Utilisez au moins 8 caractères.</p>
          </div>
          <div className="auth-card"><PasswordUpdateForm /></div>
        </section>
      </main>
    </div>
  );
}
