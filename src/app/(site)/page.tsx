import Link from "next/link";
import { ArrowRight, ArrowUpRight, BadgeCheck, Check, ChevronDown, CreditCard, Info, Play, Zap } from "lucide-react";
import "@/app/home.css";
import { HomeAccountMenu } from "@/components/home-account-menu";
import { HomeMotion } from "@/components/home-motion";
import { ThemeToggle } from "@/components/theme-toggle";
import { getPlans } from "@/lib/plans";

export const instant = false;

const examSections = [
  {
    number: "01",
    code: "CO",
    title: "Compréhension orale",
    description: "Entraînez-vous à comprendre des conversations et des messages dans un temps limité.",
  },
  {
    number: "02",
    code: "SL",
    title: "Structures de la langue",
    description: "Testez votre maîtrise de la grammaire, du vocabulaire et des usages du français.",
  },
  {
    number: "03",
    code: "CE",
    title: "Compréhension écrite",
    description: "Lisez différents documents et répondez à des questions de compréhension.",
  },
  {
    number: "04",
    code: "TCF",
    title: "Un parcours chronométré",
    description: "Passez les épreuves dans un format structuré, puis consultez votre estimation de niveau.",
  },
];

const steps = [
  {
    number: "1",
    title: "Créez votre compte",
    description: "Inscrivez-vous avec votre adresse e-mail pour accéder à votre espace candidat.",
  },
  {
    number: "2",
    title: "Choisissez une offre",
    description: "Sélectionnez un pack selon votre rythme de préparation et consultez le tarif en dinars.",
  },
  {
    number: "3",
    title: "Payez par BaridiMob",
    description: "Effectuez le virement, puis envoyez votre reçu avec votre référence sur WhatsApp.",
  },
  {
    number: "4",
    title: "Préparez-vous à votre rythme",
    description: "Après vérification manuelle du paiement, votre accès est activé et vous pouvez commencer.",
  },
];

const faqs = [
  {
    question: "Cette plateforme est-elle officielle ?",
    answer: "Non. C’est un site indépendant de préparation aux examens blancs, sans affiliation à France Éducation international.",
  },
  {
    question: "Comment l’accès payant est-il activé ?",
    answer: "Le paiement se fait manuellement par BaridiMob. Envoyez votre reçu et votre référence sur WhatsApp ; l’équipe vérifie le paiement avant d’activer l’accès.",
  },
  {
    question: "Le niveau affiché est-il un résultat officiel ?",
    answer: "Non. Le niveau et les scores sont des estimations d’entraînement et ne remplacent pas le résultat d’un examen officiel.",
  },
  {
    question: "Quelles parties puis-je pratiquer ?",
    answer: "Les examens de démonstration disponibles couvrent la compréhension orale, les structures de la langue et la compréhension écrite.",
  },
];

function formatPrice(price: number): string {
  if (price === 0) return "Gratuit";
  return `${new Intl.NumberFormat("fr-DZ").format(price)} DA`;
}

export default async function HomePage() {
  const { plans, unavailable } = await getPlans();

  return (
    <div id="public-home">
      <header className="home-navbar">
        <div className="home-container home-navbar-inner">
          <Link className="home-brand" href="/" aria-label="TCF Simulation, accueil">
            <span className="home-brand-mark" aria-hidden="true">TCF</span>
            <span><strong>Simulation</strong></span>
          </Link>
          <nav className="home-anchor-nav" aria-label="Navigation de la page">
            <a href="#epreuves">Épreuves</a>
            <a href="#comment-ca-marche">Comment ça marche</a>
            <a href="#tarifs">Tarifs</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="home-navbar-actions">
            <ThemeToggle className="home-theme-toggle" />
            <HomeAccountMenu />
          </div>
        </div>
        <div className="home-scroll-progress" aria-hidden="true"><span /></div>
      </header>

      <div className="home-content">
        <section className="home-hero">
          <div className="home-container home-hero-grid">
            <div className="home-hero-copy">
              <span className="home-eyebrow" data-hero-item><span aria-hidden="true" /> Votre entraînement TCF, à votre rythme</span>
              <h1 data-hero-item>Le jour de l’examen, vous saurez à quoi vous attendre.</h1>
              <p className="home-hero-lead" data-hero-item>
                Entraînez-vous avec des examens blancs chronométrés, suivez vos résultats et avancez avec un plan de préparation clair.
              </p>
              <div className="home-hero-actions" data-hero-item>
                <Link className="home-button home-button-primary" href="/register">Essayer gratuitement <ArrowRight size={17} aria-hidden="true" /></Link>
                <Link className="home-button home-button-secondary" href="/tarifs">Voir les tarifs</Link>
              </div>
              <div className="home-trust-note" data-hero-item>
                <span><BadgeCheck size={16} aria-hidden="true" /> Premier examen gratuit</span>
                <span><CreditCard size={16} aria-hidden="true" /> Paiement BaridiMob</span>
                <span><Zap size={16} aria-hidden="true" /> Activation après vérification</span>
              </div>
            </div>

            <div className="home-preview-wrap" aria-label="Aperçu d’un examen blanc">
              <div className="home-preview-glow" />
              <div className="home-preview" data-hero-item>
                <div className="home-preview-bands" aria-hidden="true"><i /><i /><i /></div>
                <div className="home-preview-top">
                  <div className="home-preview-brand"><span className="home-preview-logo">T</span> TCF Simulation</div>
                  <span className="home-preview-live"><i /> Simulation</span>
                </div>
                <div className="home-preview-body">
                  <div className="home-preview-meta">
                    <span>COMPRÉHENSION ORALE</span>
                    <span>ÉPREUVE EN COURS</span>
                  </div>
                  <div className="home-preview-question">Question de compréhension</div>
                  <div className="home-preview-audio">
                    <span className="home-play-button" aria-hidden="true"><Play size={11} fill="currentColor" /></span>
                    <div className="home-audio-track"><span /></div>
                    <span className="home-audio-time">Audio</span>
                  </div>
                  <div className="home-preview-answers">
                    <div><span>A</span> Option de réponse</div>
                    <div className="home-answer-selected"><span>B</span> Option de réponse <Check size={14} aria-hidden="true" /></div>
                    <div><span>C</span> Option de réponse</div>
                  </div>
                  <div className="home-preview-footer">
                    <span>Répondez à chaque question à votre rythme</span>
                  </div>
                </div>
              </div>
              <div className="home-preview-score"><span><BadgeCheck size={18} aria-hidden="true" /></span><div><strong>Résultats détaillés</strong><small>Après chaque simulation</small></div></div>
            </div>
          </div>
          <div className="home-container home-hero-foot">
            <span>FAIT POUR UNE PRÉPARATION SÉRIEUSE</span>
            <div><b>CO</b> Compréhension orale</div>
            <div><b>SL</b> Structures de la langue</div>
            <div><b>CE</b> Compréhension écrite</div>
          </div>
        </section>

        <section className="home-section" id="epreuves">
          <div className="home-container">
            <div className="home-section-heading" data-reveal>
              <span className="home-section-kicker">VOTRE EXAMEN BLANC</span>
              <h2>Un examen blanc complet</h2>
              <p>Les compétences essentielles du TCF réunies dans un parcours conçu pour vous entraîner.</p>
            </div>
            <div className="home-exam-grid">
              {examSections.map((item) => (
                <article className="home-exam-card" data-reveal key={item.code}>
                  <div className="home-exam-card-top"><span>{item.number}</span><b>{item.code}</b></div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <span className="home-card-arrow" aria-hidden="true"><ArrowUpRight size={16} /></span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section home-how-section" id="comment-ca-marche">
          <div className="home-container">
            <div className="home-section-heading" data-reveal>
              <span className="home-section-kicker">SIMPLE ET TRANSPARENT</span>
              <h2>Comment ça marche</h2>
              <p>Du premier clic à l’activation de votre accès, chaque étape est claire.</p>
            </div>
            <div className="home-steps" data-reveal>
              {steps.map((step) => (
                <article className="home-step" data-reveal key={step.number}>
                  <span className="home-step-number">{step.number}</span>
                  <div><h3>{step.title}</h3><p>{step.description}</p></div>
                </article>
              ))}
            </div>
            <div className="home-payment-note" data-reveal>
              <span aria-hidden="true"><Info size={14} /></span>
              <p><strong>Paiement vérifié manuellement.</strong> L’activation se fait après vérification du reçu. Ne transmettez jamais vos identifiants bancaires.</p>
            </div>
          </div>
        </section>

        <section className="home-section" id="tarifs">
          <div className="home-container">
            <div className="home-section-heading" data-reveal>
              <span className="home-section-kicker">TARIFS EN DINARS</span>
              <h2>Choisissez votre rythme</h2>
              <p>Des offres simples, affichées en dinars algériens.</p>
            </div>
            {unavailable ? (
              <p className="home-plans-message" role="status">
                Les tarifs ne sont pas disponibles pour le moment. La connexion à la base de données ou à la table des offres doit être configurée.
              </p>
            ) : plans.length === 0 ? (
              <p className="home-plans-message" role="status">Aucune offre disponible pour le moment.</p>
            ) : (
              <div className="home-plans-grid">
                {plans.map((plan) => {
                  const featured = plan.highlighted;
                  return (
                    <article className={`home-plan-card${featured ? " home-plan-featured" : ""}`} data-reveal key={plan.id}>
                      {plan.badge && <span className="home-plan-badge">{plan.badge}</span>}
                      <h3>{plan.name}</h3>
                      {plan.objective && <p className="home-plan-objective">{plan.objective}</p>}
                      <p className="home-plan-exam-type">{plan.examType === "TCF Tout Public" ? "TCF TP" : plan.examType}</p>
                      <p className="home-plan-description">{plan.description || plan.duration}</p>
                      <p className="home-plan-price">{formatPrice(plan.price)}</p>
                      <p className="home-plan-duration">{plan.duration}</p>
                      {plan.features.length > 0 && (
                        <ul className="home-plan-features">
                          {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                        </ul>
                      )}
                      <Link className={`home-button ${featured ? "home-button-primary" : "home-button-secondary"}`} href="/tarifs">
                        Choisir cette offre
                      </Link>
                    </article>
                  );
                })}
              </div>
            )}
            <p className="home-plan-caption">Paiement par BaridiMob, validation manuelle après réception du justificatif.</p>
          </div>
        </section>

        <section className="home-section home-faq-section" id="faq">
          <div className="home-container home-faq-layout">
            <div className="home-section-heading" data-reveal>
              <span className="home-section-kicker">BESOIN D’INFORMATIONS ?</span>
              <h2>Questions fréquentes</h2>
              <p>Tout ce qu’il faut savoir avant de commencer votre préparation.</p>
            </div>
            <div className="home-faq-list">
              {faqs.map((faq) => (
                <details data-reveal key={faq.question}>
                  <summary>{faq.question}<span className="home-faq-chevron" aria-hidden="true"><ChevronDown size={18} /></span></summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="home-final-cta">
          <div className="home-container home-final-inner" data-reveal>
            <div>
              <span>PRÊT À VOUS LANCER ?</span>
              <h2>Votre prochaine étape commence ici.</h2>
              <p>Créez votre compte et préparez-vous avec méthode.</p>
            </div>
            <Link className="home-button home-button-white" href="/register">Commencer ma préparation <ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
        </section>
      </div>

      <footer className="home-footer">
        <div className="home-container home-footer-inner">
          <Link className="home-brand" href="/">
            <span className="home-brand-mark" aria-hidden="true">TCF</span>
            <span><strong>Simulation</strong></span>
          </Link>
          <p>Site indépendant, non affilié à France Éducation international</p>
          <div><Link href="/login">Connexion</Link><Link href="/tarifs">Tarifs</Link></div>
        </div>
      </footer>
      <HomeMotion />
    </div>
  );
}
