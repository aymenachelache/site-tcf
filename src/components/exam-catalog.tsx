"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { requestExamFullscreen } from "@/lib/exam-fullscreen";
import { sortSectionsByKind, type SectionKind } from "@/lib/exam-sections";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/client";

type ExamType = "TCF Tout Public" | "Canada" | "IRN" | "Québec";
type CatalogExam = {
  id: string;
  title: string;
  exam_type: ExamType;
  is_free: boolean;
  sort_order: number;
};
type CatalogSection = {
  id: string;
  exam_id: string;
  kind: SectionKind;
  position: number;
  duration_seconds: number;
  question_count: number | null;
};
type PublicQuestionSection = { section_id: string };
type Entitlement = {
  credits_remaining: number | null;
  starts_at: string;
  expires_at: string | null;
  revoked: boolean;
};
type Attempt = { id: string; exam_id: string };
type Result = {
  attempt_id: string;
  score: number;
  cefr_level: string | null;
};
type BestResult = { score: number; level: string | null };
type StatusFilter = "all" | "free" | "premium" | "unlocked" | "locked";

const examTypes: ExamType[] = ["TCF Tout Public", "Canada", "IRN", "Québec"];
const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
const sectionNames: Record<SectionKind, string> = {
  CO: "CO",
  SL: "SL",
  CE: "CE",
  EE: "EE",
  EO: "EO",
};

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min`;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(date));
}

function formatExamType(type: ExamType): string {
  return type === "TCF Tout Public" ? "TCF TP" : type;
}

function highestLevel(results: Result[]): string | null {
  return results.reduce<string | null>((best, result) => {
    if (!result.cefr_level || !levels.includes(result.cefr_level)) return best;
    if (!best || levels.indexOf(result.cefr_level) > levels.indexOf(best)) return result.cefr_level;
    return best;
  }, null);
}

function createBestResults(attempts: Attempt[], results: Result[]): Map<string, BestResult> {
  const rowsByAttempt = new Map<string, Result[]>();

  for (const result of results) {
    const rows = rowsByAttempt.get(result.attempt_id) ?? [];
    rows.push(result);
    rowsByAttempt.set(result.attempt_id, rows);
  }

  const bestByExam = new Map<string, BestResult>();
  for (const attempt of attempts) {
    const rows = rowsByAttempt.get(attempt.id) ?? [];
    if (!rows.length) continue;

    const candidate = {
      score: rows.reduce((total, result) => total + Number(result.score), 0),
      level: highestLevel(rows),
    };
    const current = bestByExam.get(attempt.exam_id);
    if (!current || candidate.score > current.score) bestByExam.set(attempt.exam_id, candidate);
  }
  return bestByExam;
}

export function ExamCatalog() {
  const router = useRouter();
  const [exams, setExams] = useState<CatalogExam[]>([]);
  const [sections, setSections] = useState<CatalogSection[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [bestResults, setBestResults] = useState<Map<string, BestResult>>(() => new Map());
  const [userSignedIn, setUserSignedIn] = useState(false);
  const [typeFilter, setTypeFilter] = useState<ExamType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [startingExam, setStartingExam] = useState(false);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState("");
  const [catalogCountsUnavailable, setCatalogCountsUnavailable] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (!isSupabaseConfigured()) {
        throw new Error("La connexion à Supabase n’est pas configurée.");
      }

      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError && authError.name !== "AuthSessionMissingError") {
        throw new Error(`Session utilisateur : ${authError.message}`);
      }
      const now = new Date().toISOString();
      setCurrentTime(now);

      const [examResponse, sectionResponse] = await Promise.all([
        supabase
          .from("exams")
          .select("id, title, exam_type, is_free, sort_order")
          .eq("status", "published")
          .order("sort_order"),
        supabase
          .from("exam_sections")
          .select("id, exam_id, kind, position, duration_seconds")
          .order("position"),
      ]);
      if (examResponse.error) throw new Error(`Examens : ${examResponse.error.message}`);
      if (sectionResponse.error) throw new Error(`Épreuves : ${sectionResponse.error.message}`);

      const loadedExams = (examResponse.data ?? []) as CatalogExam[];
      const sectionMetadata = sectionResponse.data ?? [];
      const { data: catalogCountData, error: catalogCountError } = await supabase
        .from("exam_catalog_sections")
        .select("exam_id, kind, duration_seconds, question_count");
      const isCatalogViewMissing = catalogCountError?.code === "PGRST205";
      if (catalogCountError && !isCatalogViewMissing) {
        throw new Error(`Comptage des questions : ${catalogCountError.message}`);
      }
      setCatalogCountsUnavailable(isCatalogViewMissing);

      const loadedSections: CatalogSection[] = sectionMetadata.map((section) => {
        const count = catalogCountData?.find(
          (row) => row.exam_id === section.exam_id
            && row.kind === section.kind
            && row.duration_seconds === section.duration_seconds,
        );
        return {
          ...section,
          question_count: count?.question_count ?? null,
        } as CatalogSection;
      });
      setExams(loadedExams);
      setSections(loadedSections);

      const user = authData.user;
      setUserSignedIn(Boolean(user));
      let activeEntitlements: Entitlement[] = [];
      let attempts: Attempt[] = [];
      if (user) {
        const [{ data: entitlementData, error: entitlementError }, { data: attemptData, error: attemptError }] =
          await Promise.all([
          supabase
            .from("entitlements")
            .select("credits_remaining, starts_at, expires_at, revoked")
            .eq("user_id", user.id)
            .eq("revoked", false)
            .lte("starts_at", now),
          supabase.from("attempts").select("id, exam_id").eq("status", "submitted"),
        ]);
        if (entitlementError) throw new Error(`Accès utilisateur : ${entitlementError.message}`);
        if (attemptError) throw new Error(`Examens déjà passés : ${attemptError.message}`);

        activeEntitlements = ((entitlementData ?? []) as Entitlement[]).filter(
          (entitlement) =>
            (!entitlement.expires_at || entitlement.expires_at > now)
            && (entitlement.credits_remaining ?? 0) > 0,
        );
        attempts = (attemptData ?? []) as Attempt[];
      }
      setEntitlements(activeEntitlements);

      if (isCatalogViewMissing) {
        const accessibleExamIds = new Set(loadedExams
          .filter((exam) => (
            exam.is_free || activeEntitlements.some((entitlement) => (
              (!entitlement.expires_at || entitlement.expires_at > now)
              && (entitlement.credits_remaining ?? 0) > 0
            ))
          ))
          .map((exam) => exam.id));
        const accessibleSectionIds = loadedSections
          .filter((section) => accessibleExamIds.has(section.exam_id))
          .map((section) => section.id);
        const countsBySection = new Map<string, number>();

        if (accessibleSectionIds.length) {
          const { data: questionSections, error: questionSectionsError } = await supabase
            .from("questions_public")
            .select("section_id")
            .in("section_id", accessibleSectionIds);
          if (questionSectionsError) {
            throw new Error(`Comptage des questions accessibles : ${questionSectionsError.message}`);
          }
          for (const question of (questionSections ?? []) as PublicQuestionSection[]) {
            countsBySection.set(question.section_id, (countsBySection.get(question.section_id) ?? 0) + 1);
          }
        }

        setSections(loadedSections.map((section) => (
          accessibleExamIds.has(section.exam_id)
            ? { ...section, question_count: countsBySection.get(section.id) ?? 0 }
            : section
        )));
      }

      if (!attempts.length) {
        setBestResults(new Map());
        return;
      }
      const { data: resultData, error: resultError } = await supabase
        .from("results")
        .select("attempt_id, score, cefr_level")
        .in("attempt_id", attempts.map((attempt) => attempt.id));
      if (resultError) throw new Error(`Résultats : ${resultError.message}`);
      setBestResults(createBestResults(attempts, (resultData ?? []) as Result[]));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Erreur inconnue.";
      setError(`Le catalogue n’a pas pu être chargé. ${message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(), 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalog]);

  const accessibleExams = useMemo(() => {
    return exams.filter((exam) => (
      exam.is_free || entitlements.some((entitlement) => (
        currentTime !== ""
        && entitlement.starts_at <= currentTime
        && (!entitlement.expires_at || entitlement.expires_at > currentTime)
        && !entitlement.revoked
        && (entitlement.credits_remaining ?? 0) > 0
      ))
    ));
  }, [currentTime, entitlements, exams]);

  const unlockedIds = useMemo(
    () => new Set(accessibleExams.map((exam) => exam.id)),
    [accessibleExams],
  );
  const filteredExams = useMemo(
    () => exams.filter((exam) => {
      if (typeFilter !== "all" && exam.exam_type !== typeFilter) return false;
      const unlocked = unlockedIds.has(exam.id);
      if (statusFilter === "free") return exam.is_free;
      if (statusFilter === "premium") return !exam.is_free;
      if (statusFilter === "unlocked") return unlocked;
      if (statusFilter === "locked") return !unlocked;
      return true;
    }),
    [exams, statusFilter, typeFilter, unlockedIds],
  );

  const accessExpiresAt = useMemo(() => {
    if (entitlements.some((entitlement) => !entitlement.expires_at)) return null;
    const expirations = entitlements
      .map((entitlement) => entitlement.expires_at)
      .filter((expiration): expiration is string => Boolean(expiration))
      .sort();
    return expirations[0] ?? "";
  }, [entitlements]);

  async function startExam(examId: string) {
    setError("");
    setStartingExam(true);
    try {
      const fullscreenFailed = document.fullscreenElement
        ? false
        : !(await requestExamFullscreen());
      const params = new URLSearchParams({ start: "1", exam: examId });
      if (fullscreenFailed) params.set("fullscreen", "error");
      router.push(`/exam?${params.toString()}`);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Impossible de démarrer cet examen.");
      setStartingExam(false);
    }
  }

  const firstExpiration = accessExpiresAt
    ? formatDate(accessExpiresAt)
    : entitlements.length
      ? "Sans expiration"
      : "Aucun accès Premium";

  return (
    <section className="catalog-page">
      <header className="catalog-heading">
        <div>
          <p className="catalog-eyebrow">Votre entraînement TCF</p>
          <h1>Examens blancs</h1>
          <p className="catalog-intro">
            Choisissez une épreuve et entraînez-vous dans les conditions d’un examen, avec un suivi de vos résultats.
          </p>
        </div>
        <aside className="catalog-access" aria-label="Résumé de votre accès">
          <div>
            <span className="catalog-access-label">Examens débloqués</span>
            <strong>{loading ? "…" : `${accessibleExams.length} / ${exams.length}`}</strong>
          </div>
          <div>
            <span className="catalog-access-label">Expiration de l’accès</span>
            <strong>{loading ? "…" : firstExpiration}</strong>
          </div>
        </aside>
      </header>

      <div className="catalog-filters" aria-label="Filtres des examens">
        <label className="catalog-filter">
          Type d’examen
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as ExamType | "all")}
          >
            <option value="all">Tous les types</option>
            {examTypes.map((type) => <option key={type} value={type}>{formatExamType(type)}</option>)}
          </select>
        </label>
        <label className="catalog-filter">
          Statut
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="all">Tous les examens</option>
            <option value="free">Gratuits</option>
            <option value="premium">Premium</option>
            <option value="unlocked">Débloqués</option>
            <option value="locked">Verrouillés</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="catalog-alert" role="alert">{error}</p>
      ) : loading ? (
        <div className="catalog-grid" aria-label="Chargement des examens" aria-busy="true">
          {[0, 1, 2].map((item) => <div className="catalog-skeleton" key={item} />)}
        </div>
      ) : exams.length === 0 ? (
        <div className="catalog-empty">
          <span className="catalog-empty-icon" aria-hidden="true">✦</span>
          <h2>Aucun examen disponible pour le moment</h2>
          <p>Les examens blancs apparaîtront ici dès qu’ils seront publiés. Revenez bientôt pour découvrir les nouvelles épreuves.</p>
        </div>
      ) : filteredExams.length === 0 ? (
        <div className="catalog-empty">
          <h2>Aucun examen ne correspond à ces filtres</h2>
          <p>Essayez un autre type ou statut pour afficher les examens disponibles.</p>
        </div>
      ) : (
        <>
          {catalogCountsUnavailable && (
            <p className="catalog-info" role="status">
              Les nombres de questions des examens Premium verrouillés seront disponibles après l’application de la migration 004 dans Supabase.
            </p>
          )}
          <p className="catalog-count">{filteredExams.length} examen(s) disponible(s)</p>
          <div className="catalog-grid">
            {filteredExams.map((exam) => {
              const examSections = sortSectionsByKind(sections.filter((section) => section.exam_id === exam.id));
              const result = bestResults.get(exam.id);
              const unlocked = unlockedIds.has(exam.id);
              return (
                <article className="catalog-card" key={exam.id}>
                  <div className="catalog-card-top">
                    <div>
                      <p className="catalog-type">{formatExamType(exam.exam_type)}</p>
                      <h2>{exam.title}</h2>
                    </div>
                    <span className={`catalog-badge${exam.is_free ? "" : " catalog-badge-premium"}`}>
                      {exam.is_free ? "Gratuit" : "Premium"}
                    </span>
                  </div>

                  <div className="catalog-sections" aria-label="Épreuves incluses">
                    {examSections.length ? examSections.map((section) => (
                      <span className="catalog-section-chip" key={`${section.exam_id}-${section.kind}`}>
                        {sectionNames[section.kind]} {section.question_count === null ? "—" : section.question_count} q · {formatDuration(section.duration_seconds)}
                      </span>
                    )) : <span className="catalog-section-chip">Épreuves en préparation</span>}
                  </div>

                  <p className="catalog-best">
                    {result ? (
                      <>Meilleur score : <strong>{new Intl.NumberFormat("fr-FR").format(result.score)}</strong>
                        {result.level && <> · Niveau <strong>{result.level}</strong></>}
                      </>
                    ) : "Pas encore de résultat"}
                  </p>

                  {unlocked ? (
                    <button className="catalog-start" disabled={startingExam} type="button" onClick={() => void startExam(exam.id)}>
                      {startingExam ? "Démarrage…" : "Commencer"} <span aria-hidden="true">→</span>
                    </button>
                  ) : (
                    <Link className="catalog-unlock" href="/tarifs">
                      <span aria-hidden="true">🔒</span> Débloquer
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      {!userSignedIn && !loading && !error && exams.length > 0 && (
        <p className="catalog-count" role="status">
          Connectez-vous pour afficher vos accès et vos meilleurs résultats.
        </p>
      )}
    </section>
  );
}
