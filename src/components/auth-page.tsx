import Link from "next/link";
import { AuthPanel } from "@/components/auth-panel";
import { ThemeToggle } from "@/components/theme-toggle";

export function AuthPage({
  mode,
  initialError,
}: {
  mode: "signin" | "signup" | "reset";
  initialError?: string;
}) {
  const isSignup = mode === "signup";
  const isReset = mode === "reset";

  return (
    <div id="auth-page">
      <header className="auth-header">
        <Link className="auth-brand" href="/" aria-label="TCF Simulation, accueil">
          <span className="auth-brand-mark" aria-hidden="true">TCF</span>
          <span>Simulation</span>
        </Link>
        <div className="auth-header-actions">
          <ThemeToggle className="auth-theme-toggle" />
          <Link className="auth-back-link" href="/">Retour à l’accueil</Link>
        </div>
      </header>

      <main className="auth-main">
        <section className="auth-card-column">
          <div className="auth-intro">
            <span className="auth-eyebrow">VOTRE PRÉPARATION TCF</span>
            <h1>{isSignup ? "Créez votre espace candidat" : isReset ? "Réinitialisez votre mot de passe" : "Ravi de vous revoir"}</h1>
            <p>
              {isSignup
                ? "Un compte pour organiser vos examens blancs et suivre vos progrès."
                : isReset
                  ? "Nous vous enverrons un lien sécurisé pour choisir un nouveau mot de passe."
                  : "Connectez-vous pour retrouver vos examens et votre progression."}
            </p>
          </div>
          <AuthPanel initialMode={mode} initialError={initialError} />
          <p className="auth-independent-note">Site indépendant de préparation aux examens blancs TCF.</p>
        </section>

        <aside className="auth-aside">
          <div className="auth-aside-shape" aria-hidden="true" />
          <div className="auth-aside-content">
            <span className="auth-aside-label">PRÉPARATION EN CONDITIONS RÉELLES</span>
            <h2>Avancez avec confiance, une épreuve à la fois.</h2>
            <p>Un environnement de préparation simple pour vous entraîner, consulter vos résultats et savoir où concentrer vos efforts.</p>
            <div className="auth-benefits">
              <div><span aria-hidden="true">✓</span><span><strong>Examens chronométrés</strong><small>Un déroulé structuré pour pratiquer dans les temps.</small></span></div>
              <div><span aria-hidden="true">✓</span><span><strong>Suivi de progression</strong><small>Retrouvez vos scores et vos dernières tentatives.</small></span></div>
              <div><span aria-hidden="true">✓</span><span><strong>Tarifs transparents</strong><small>Les offres sont affichées en dinars algériens.</small></span></div>
            </div>
            <div className="auth-aside-foot">
              <span className="auth-aside-avatar" aria-hidden="true">A</span>
              <span><strong>Votre préparation, à votre rythme</strong><small>CO · Structures · CE</small></span>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
