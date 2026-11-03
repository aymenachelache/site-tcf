"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type SectionKind = "CO" | "SL" | "CE" | "EE" | "EO";
type Exam = { id: string; title: string; exam_type: string; is_free: boolean };
type ExamSection = {
  exam_id: string;
  kind: SectionKind;
  duration_seconds: number;
  question_count: number | null;
};
type Attempt = { id: string; exam_id: string; submitted_at: string };
type SectionResult = {
  attempt_id: string;
  section_kind: "CO" | "SL" | "CE";
  score: number;
  cefr_level: string | null;
};
type Entitlement = {
  id: string;
  plan_name: string;
  exam_ids: string[];
  credits_remaining: number | null;
  total_credits: number | null;
  starts_at: string;
  expires_at: string | null;
  revoked: boolean;
};
type Payment = {
  id: string;
  plan_name: string;
  amount_dzd: number;
  reference: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  admin_note: string | null;
  created_at: string;
};

type DashboardTab = "exams" | "results" | "access";
type Props = {
  name: string;
  exams: Exam[];
  examSections: ExamSection[];
  attempts: Attempt[];
  attemptCount: number;
  results: SectionResult[];
  entitlements: Entitlement[];
  payments: Payment[];
  dataError?: string;
};

const sectionOrder: SectionResult["section_kind"][] = ["CO", "SL", "CE"];

function formatDate(value: string | null, includeTime = false) {
  return value
    ? new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      ...(includeTime ? { timeStyle: "short" as const } : {}),
    }).format(new Date(value))
    : "Sans expiration";
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min`;
}

function statusLabel(status: Payment["status"]) {
  return {
    pending: "En attente",
    approved: "Activé",
    rejected: "Refusé",
    cancelled: "Annulé",
  }[status];
}

function LevelBadge({ level }: { level: string | null }) {
  if (!level) return <span className="candidate-level candidate-level-none">—</span>;
  const group = level.startsWith("A") ? "a" : level.startsWith("B") ? "b" : "c";
  return <span className={`candidate-level candidate-level-${group}`}>{level}</span>;
}

function StatusBadge({ status }: { status: Payment["status"] }) {
  return <span className={`candidate-status candidate-status-${status}`}>{statusLabel(status)}</span>;
}

function SummaryIcon({ kind }: { kind: "credits" | "expiry" | "score" | "attempts" }) {
  const paths = {
    credits: <><path d="M12 3v18" /><path d="M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
    expiry: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    score: <><path d="m3 17 6-6 4 4 8-9" /><path d="M15 6h6v6" /></>,
    attempts: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
  };
  return (
    <span className="candidate-summary-icon" aria-hidden="true">
      <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
        {paths[kind]}
      </svg>
    </span>
  );
}

type ProgressPoint = {
  date: string;
  globalScore: number | null;
  sectionScores: Partial<Record<SectionResult["section_kind"], number>>;
};

function ProgressChart({ points }: { points: ProgressPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="candidate-empty candidate-chart-empty">
        <span className="candidate-empty-icon" aria-hidden="true">↗</span>
        <p>Aucune simulation passée pour le moment.</p>
        <span>Votre évolution apparaîtra après votre première tentative soumise.</span>
      </div>
    );
  }

  const width = 760;
  const height = 260;
  const left = 44;
  const right = 18;
  const top = 18;
  const bottom = 40;
  const colors = {
    globalScore: "#1d4ed8",
    CO: "#0891b2",
    SL: "#d97706",
    CE: "#15803d",
  };
  const series: {
    key: "globalScore" | SectionResult["section_kind"];
    label: string;
    value: (point: ProgressPoint) => number | null;
  }[] = [
    { key: "globalScore", label: "Global", value: (point) => point.globalScore },
    { key: "CO", label: "CO", value: (point) => point.sectionScores.CO ?? null },
    { key: "SL", label: "SL", value: (point) => point.sectionScores.SL ?? null },
    { key: "CE", label: "CE", value: (point) => point.sectionScores.CE ?? null },
  ];

  return (
    <div className="candidate-chart">
      <div className="candidate-chart-scroll">
        <svg
          aria-label="Évolution des scores globaux et par épreuve, sur 699"
          className="candidate-chart-svg"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          {[0, 0.5, 1].map((fraction) => {
            const y = top + (height - top - bottom) * fraction;
            return (
              <g key={fraction}>
                <line x1={left} x2={width - right} y1={y} y2={y} className="candidate-chart-grid" />
                <text x={left - 10} y={y + 4} textAnchor="end" className="candidate-chart-axis">
                  {Math.round(699 * (1 - fraction))}
                </text>
              </g>
            );
          })}
          {points.map((point, index) => {
            const x = points.length === 1
              ? (left + width - right) / 2
              : left + index * (width - left - right) / (points.length - 1);
            return (
              <text className="candidate-chart-axis" key={point.date} textAnchor="middle" x={x} y={height - 10}>
                {new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" }).format(new Date(point.date))}
              </text>
            );
          })}
          {series.map((item) => {
            const coordinates = points.flatMap((point, index) => {
              const score = item.value(point);
              if (score === null) return [];
              return [{
                date: point.date,
                score,
                x: points.length === 1
                  ? (left + width - right) / 2
                  : left + index * (width - left - right) / (points.length - 1),
                y: height - bottom - score * (height - top - bottom) / 699,
              }];
            });
            const path = coordinates
              .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
              .join(" ");
            return (
              <g key={item.key}>
                {coordinates.length > 1 && (
                  <path d={path} fill="none" stroke={colors[item.key]} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
                )}
                {coordinates.map((point) => (
                  <circle key={`${item.key}-${point.date}`} cx={point.x} cy={point.y} r="4.5" fill={colors[item.key]}>
                    <title>
                      {item.label} · {formatDate(point.date)} : {Math.round(point.score)}/699
                    </title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="candidate-chart-legend">
        {series.map((item) => (
          <li key={item.key}>
            <span aria-hidden="true" style={{ backgroundColor: colors[item.key] }} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UserDashboard({
  name,
  exams,
  examSections,
  attempts,
  attemptCount,
  results,
  entitlements,
  payments,
  dataError,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<DashboardTab>("exams");
  const [now] = useState(() => Date.now());
  const activeAccess = entitlements.filter((access) =>
    !access.revoked
    && new Date(access.starts_at).getTime() <= now
    && (access.expires_at === null || new Date(access.expires_at).getTime() > now),
  );
  const remainingCredits = activeAccess.reduce((total, access) => total + (access.credits_remaining ?? 0), 0);
  const includedExamIds = new Set(activeAccess.flatMap((access) => access.exam_ids));
  const expiry = activeAccess.some((access) => access.expires_at === null)
    ? null
    : activeAccess.map((access) => access.expires_at).filter((value): value is string => value !== null)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  const expiresSoon = expiry !== null
    && new Date(expiry).getTime() > now
    && new Date(expiry).getTime() - now < 3 * 24 * 60 * 60 * 1000;

  const resultsByAttempt = new Map<string, SectionResult[]>();
  for (const result of results) {
    const sectionResults = resultsByAttempt.get(result.attempt_id) ?? [];
    sectionResults.push(result);
    resultsByAttempt.set(result.attempt_id, sectionResults);
  }
  const sectionsByExam = new Map<string, ExamSection[]>();
  for (const section of examSections) {
    const sections = sectionsByExam.get(section.exam_id) ?? [];
    sections.push(section);
    sectionsByExam.set(section.exam_id, sections);
  }

  const progressPoints = attempts
    .map((attempt): ProgressPoint => {
      const sectionResults = resultsByAttempt.get(attempt.id) ?? [];
      const sectionScores = Object.fromEntries(
        sectionResults.map((result) => [result.section_kind, result.score]),
      ) as Partial<Record<SectionResult["section_kind"], number>>;
      return {
        date: attempt.submitted_at,
        globalScore: sectionOrder.every((section) => sectionScores[section] !== undefined)
          ? sectionOrder.reduce((total, section) => total + (sectionScores[section] ?? 0), 0) / sectionOrder.length
          : null,
        sectionScores,
      };
    })
    .filter((point) => point.globalScore !== null || Object.keys(point.sectionScores).length > 0)
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
  const bestResult = results.reduce<SectionResult | null>(
    (best, result) => !best || result.score > best.score ? result : best,
    null,
  );
  const featuredAccess = activeAccess[0] ?? null;
  const accessCreditPercent = featuredAccess?.total_credits && featuredAccess.total_credits > 0
    ? Math.max(0, Math.min(100, (100 * (featuredAccess.credits_remaining ?? 0)) / featuredAccess.total_credits))
    : null;

  const tabs: { id: DashboardTab; label: string }[] = [
    { id: "exams", label: "Mes examens" },
    { id: "results", label: "Mes résultats" },
    { id: "access", label: "Mes accès et paiements" },
  ];

  return (
    <section className="candidate-dashboard">
      <div className="candidate-dashboard-inner">
        <header className="candidate-dashboard-header">
          <div className="candidate-dashboard-heading">
            <p className="candidate-eyebrow">Votre espace candidat</p>
            <h1>Bonjour{name ? `, ${name}` : ""}</h1>
            <p>Un pas après l’autre : retrouvez vos examens, vos résultats et votre progression.</p>
          </div>
          <Link className="primary-btn candidate-dashboard-cta" href="/examen">
            Commencer un examen <span aria-hidden="true">→</span>
          </Link>
        </header>

        {dataError && (
          <div className="candidate-alert" role="alert">
            <p>{dataError}</p>
            <button className="candidate-button candidate-button-secondary" onClick={() => router.refresh()} type="button">
              Réessayer
            </button>
          </div>
        )}

        <section aria-label="Résumé de votre compte" className="candidate-summary-grid">
          <article className="candidate-summary-card">
            <SummaryIcon kind="credits" />
            <p className="candidate-summary-label">Simulations restantes</p>
            <p className="candidate-summary-value">{remainingCredits}</p>
            {includedExamIds.size > 0 && <p className="candidate-summary-note">{includedExamIds.size} examen(s) inclus</p>}
          </article>
          <article className={`candidate-summary-card${expiresSoon ? " candidate-summary-warning" : ""}`}>
            <SummaryIcon kind="expiry" />
            <p className="candidate-summary-label">Accès valable jusqu’au</p>
            <p className="candidate-summary-value candidate-summary-date">
              {activeAccess.length === 0 ? "Aucun accès" : expiry ? formatDate(expiry) : "Sans limite"}
            </p>
            {expiresSoon && <p className="candidate-summary-note">Expire dans moins de 3 jours</p>}
          </article>
          <article className="candidate-summary-card">
            <SummaryIcon kind="score" />
            <p className="candidate-summary-label">Meilleur score</p>
            <p className="candidate-summary-value">{bestResult ? `${bestResult.score}` : "—"}</p>
            <p className="candidate-summary-note">
              {bestResult ? <><LevelBadge level={bestResult.cefr_level} /> <span>{bestResult.section_kind} · /699</span></> : "Aucun résultat"}
            </p>
          </article>
          <article className="candidate-summary-card">
            <SummaryIcon kind="attempts" />
            <p className="candidate-summary-label">Nombre de tentatives</p>
            <p className="candidate-summary-value">{attemptCount}</p>
          </article>
        </section>

        <section aria-labelledby="candidate-access-title" className="candidate-access-card">
          {featuredAccess ? (
            <>
              <div className="candidate-access-main">
                <div>
                  <p className="candidate-eyebrow">Votre formule</p>
                  <h2 id="candidate-access-title">{featuredAccess.plan_name}</h2>
                  <p className="candidate-access-expiry">
                    {featuredAccess.expires_at ? `Valable jusqu’au ${formatDate(featuredAccess.expires_at)}` : "Accès sans date d’expiration"}
                  </p>
                </div>
                <Link className="candidate-button candidate-button-secondary" href="/tarifs">Renouveler</Link>
              </div>
              <div className="candidate-credit-block">
                <div className="candidate-credit-labels">
                  <span>Crédits restants</span>
                  <strong>{featuredAccess.credits_remaining ?? 0}{featuredAccess.total_credits ? ` / ${featuredAccess.total_credits}` : ""}</strong>
                </div>
                <div
                  aria-label={accessCreditPercent === null
                    ? `${featuredAccess.credits_remaining ?? 0} crédit(s) restant(s)`
                    : `${Math.round(accessCreditPercent)} % des crédits restants`}
                  className="candidate-progress-track"
                  role="img"
                >
                  {accessCreditPercent !== null && (
                    <span className="candidate-progress-value" style={{ width: `${accessCreditPercent}%` }} />
                  )}
                </div>
                {includedExamIds.size > 0 && (
                  <p className="candidate-credit-hint">Accès direct à {includedExamIds.size} examen(s) inclus dans votre offre.</p>
                )}
              </div>
            </>
          ) : (
            <div className="candidate-access-empty">
              <div>
                <p className="candidate-eyebrow">Votre formule</p>
                <h2 id="candidate-access-title">Aucun accès actif pour le moment</h2>
                <p>Choisissez une offre pour débloquer vos simulations premium.</p>
              </div>
              <Link className="candidate-button candidate-button-secondary" href="/tarifs">Voir les offres</Link>
            </div>
          )}
        </section>

        <section aria-label="Votre espace de travail" className="candidate-workspace">
          <div className="candidate-tabs-scroll">
            <nav aria-label="Sections du tableau de bord" className="candidate-tabs" role="tablist">
              {tabs.map((item) => (
                <button
                  aria-controls={`dashboard-panel-${item.id}`}
                  aria-selected={tab === item.id}
                  className={`candidate-tab${tab === item.id ? " candidate-tab-active" : ""}`}
                  id={`dashboard-tab-${item.id}`}
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  role="tab"
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          <div
            aria-labelledby={`dashboard-tab-${tab}`}
            className="candidate-tab-panel"
            id={`dashboard-panel-${tab}`}
            role="tabpanel"
            tabIndex={0}
          >
            {tab === "exams" && (
              <section aria-labelledby="available-exams-title">
                <div className="candidate-section-heading">
                  <div>
                    <p className="candidate-eyebrow">À vous de jouer</p>
                    <h2 id="available-exams-title">Examens disponibles</h2>
                  </div>
                  <span className="candidate-section-count">{exams.length} examen(s)</span>
                </div>
                {exams.length === 0 ? (
                  <div className="candidate-empty">
                    <span className="candidate-empty-icon" aria-hidden="true">▤</span>
                    <h3>Aucun examen publié</h3>
                    <p>Les examens disponibles apparaîtront ici.</p>
                  </div>
                ) : (
                  <div className="candidate-exam-grid">
                    {exams.map((exam) => {
                      const accessToExam = includedExamIds.has(exam.id);
                      const canStart = exam.is_free || accessToExam || remainingCredits > 0;
                      const sections = (sectionsByExam.get(exam.id) ?? [])
                        .filter((section) => sectionOrder.includes(section.kind as SectionResult["section_kind"]))
                        .sort((left, right) => sectionOrder.indexOf(left.kind as SectionResult["section_kind"]) - sectionOrder.indexOf(right.kind as SectionResult["section_kind"]));
                      return (
                        <article className="candidate-exam-card" key={exam.id}>
                          <div className="candidate-exam-card-top">
                            <span className={`candidate-exam-badge${exam.is_free ? " candidate-exam-badge-free" : " candidate-exam-badge-premium"}`}>
                              {exam.is_free ? "Gratuit" : "Premium"}
                            </span>
                            <span className="candidate-exam-type">{exam.exam_type}</span>
                          </div>
                          <h3>{exam.title}</h3>
                          {sections.length > 0 ? (
                            <ul aria-label="Épreuves de l’examen" className="candidate-section-list">
                              {sections.map((section) => (
                                <li key={`${section.exam_id}-${section.kind}`}>
                                  <span>{section.kind}</span>
                                  <span>{section.question_count ?? "—"} questions</span>
                                  <span>{formatDuration(section.duration_seconds)}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="candidate-exam-metadata">Détails des épreuves indisponibles.</p>
                          )}
                          {canStart ? (
                            <Link className="candidate-button candidate-button-secondary candidate-exam-action" href="/examen">
                              Commencer <span aria-hidden="true">→</span>
                            </Link>
                          ) : (
                            <Link className="candidate-button candidate-button-locked candidate-exam-action" href="/tarifs">
                              <span aria-hidden="true">⌑</span> Débloquer
                            </Link>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {tab === "results" && (
              <section aria-labelledby="results-title">
                <div className="candidate-section-heading">
                  <div>
                    <p className="candidate-eyebrow">Votre historique</p>
                    <h2 id="results-title">Mes résultats</h2>
                  </div>
                </div>
                {attempts.length === 0 ? (
                  <div className="candidate-empty">
                    <span className="candidate-empty-icon" aria-hidden="true">✓</span>
                    <h3>Aucune simulation passée pour le moment</h3>
                    <p>Après un examen soumis, vos scores et votre correction seront disponibles ici.</p>
                    <Link className="candidate-button candidate-button-secondary" href="/examen">Commencer un examen</Link>
                  </div>
                ) : (
                  <div className="candidate-results-table-wrap">
                    <table className="candidate-results-table">
                      <thead>
                        <tr>
                          <th scope="col">Date</th>
                          <th scope="col">Score global</th>
                          <th scope="col">Niveau CECRL</th>
                          {sectionOrder.map((section) => <th key={section} scope="col">{section}</th>)}
                          <th scope="col"><span className="candidate-sr-only">Correction</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {attempts.map((attempt) => {
                          const attemptResults = resultsByAttempt.get(attempt.id) ?? [];
                          const bySection = new Map(attemptResults.map((result) => [result.section_kind, result]));
                          const hasAllSections = sectionOrder.every((section) => bySection.has(section));
                          const globalScore = hasAllSections
                            ? Math.round(sectionOrder.reduce((total, section) => total + (bySection.get(section)?.score ?? 0), 0) / sectionOrder.length)
                            : null;
                          return (
                            <tr key={attempt.id}>
                              <td data-label="Date">{formatDate(attempt.submitted_at, true)}</td>
                              <td data-label="Score global" className="candidate-global-score">
                                {globalScore === null ? "—" : `${globalScore}/699`}
                              </td>
                              <td data-label="Niveau CECRL">
                                <div className="candidate-level-list">
                                  {sectionOrder.map((section) => {
                                    const result = bySection.get(section);
                                    return result?.cefr_level
                                      ? <span key={section} aria-label={`${section} ${result.cefr_level}`}><small>{section}</small><LevelBadge level={result.cefr_level} /></span>
                                      : null;
                                  })}
                                  {!attemptResults.some((result) => result.cefr_level) && <span>—</span>}
                                </div>
                              </td>
                              {sectionOrder.map((section) => {
                                const result = bySection.get(section);
                                return (
                                  <td data-label={section} key={section}>
                                    {result ? (
                                      <span className="candidate-section-score">
                                        {result.score}<small>/699</small>
                                      </span>
                                    ) : "—"}
                                  </td>
                                );
                              })}
                              <td data-label="Correction">
                                <Link className="candidate-table-link" href={`/dashboard/resultats/${attempt.id}`}>
                                  Voir la correction <span aria-hidden="true">→</span>
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {tab === "access" && (
              <div className="candidate-access-history">
                <section aria-labelledby="my-access-title">
                  <div className="candidate-section-heading">
                    <div>
                      <p className="candidate-eyebrow">Vos forfaits</p>
                      <h2 id="my-access-title">Mes accès</h2>
                    </div>
                    <Link className="candidate-inline-link" href="/mes-acces">Gérer mes accès →</Link>
                  </div>
                  {entitlements.length === 0 ? (
                    <div className="candidate-empty candidate-empty-compact">
                      <h3>Aucun accès enregistré</h3>
                      <p>Vos forfaits activés apparaîtront ici.</p>
                    </div>
                  ) : (
                    <div className="candidate-record-list">
                      {entitlements.map((access) => (
                        <article className="candidate-record-card" key={access.id}>
                          <div>
                            <h3>{access.plan_name}</h3>
                            <p>{access.revoked ? "Accès révoqué" : `Valable jusqu’au ${formatDate(access.expires_at)}`}</p>
                          </div>
                          <span className="candidate-record-meta">
                            {access.credits_remaining ?? 0} crédit(s) · {access.exam_ids.length} examen(s) inclus
                          </span>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <section aria-labelledby="my-payments-title">
                  <div className="candidate-section-heading">
                    <div>
                      <p className="candidate-eyebrow">Suivi des demandes</p>
                      <h2 id="my-payments-title">Mes paiements</h2>
                    </div>
                  </div>
                  {payments.length === 0 ? (
                    <div className="candidate-empty candidate-empty-compact">
                      <h3>Aucune demande de paiement</h3>
                      <p>Vos demandes et leur statut seront visibles ici.</p>
                      <Link className="candidate-button candidate-button-secondary" href="/tarifs">Voir les offres</Link>
                    </div>
                  ) : (
                    <div className="candidate-record-list">
                      {payments.map((payment) => (
                        <article className="candidate-record-card" key={payment.id}>
                          <div className="candidate-payment-copy">
                            <div className="candidate-payment-title">
                              <h3>{payment.plan_name}</h3>
                              <StatusBadge status={payment.status} />
                            </div>
                            <p>{new Intl.NumberFormat("fr-DZ").format(payment.amount_dzd)} DA · Réf. {payment.reference}</p>
                            <p>Demandé le {formatDate(payment.created_at)}{payment.admin_note ? ` · ${payment.admin_note}` : ""}</p>
                          </div>
                          {payment.status === "pending" && (
                            <Link className="candidate-button candidate-button-secondary" href={`/paiement/${payment.id}`}>
                              Voir comment payer
                            </Link>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="progress-title" className="candidate-chart-card">
          <div className="candidate-section-heading">
            <div>
              <p className="candidate-eyebrow">Votre évolution</p>
              <h2 id="progress-title">Progression des scores</h2>
              <p className="candidate-section-description">Score global : moyenne des trois épreuves lorsque CO, SL et CE sont toutes disponibles.</p>
            </div>
          </div>
          <ProgressChart points={progressPoints} />
        </section>
      </div>
    </section>
  );
}
