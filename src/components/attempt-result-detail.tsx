"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SectionResult = {
  section: "CO" | "SL" | "CE";
  score: number;
  level: string | null;
  details: { correct?: number; total?: number };
};

type QuestionCorrection = {
  id: string;
  section: "CO" | "SL" | "CE";
  prompt: string;
  options: string[];
  selectedOption: string | null;
  correctOption: string;
  explanation: string | null;
  points: number;
  isCorrect: boolean;
};

type ResultPayload = {
  attemptId: string;
  submittedAt: string;
  examTitle: string;
  results: SectionResult[];
  questions: QuestionCorrection[];
};

const sectionNames: Record<SectionResult["section"], string> = {
  CO: "Compréhension orale",
  SL: "Structures de la langue",
  CE: "Compréhension écrite",
};

function optionText(question: QuestionCorrection, key: string | null) {
  if (!key) return "Aucune réponse";
  const index = ["A", "B", "C", "D"].indexOf(key);
  const value = index >= 0 ? question.options[index] : undefined;
  return value ? `${key}. ${value}` : key;
}

export function AttemptResultDetail({ attemptId }: { attemptId: string }) {
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/attempts/${attemptId}/result`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as ResultPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Le résultat n’a pas pu être chargé.");
        if (active) setResult(payload);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Le résultat n’a pas pu être chargé.");
      });
    return () => { active = false; };
  }, [attemptId]);

  if (error) {
    return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">{error}</p>;
  }
  if (!result) {
    return <p className="text-slate-600" role="status">Chargement du résultat…</p>;
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="section-label">Correction après soumission</p>
        <h1 className="text-3xl font-black text-slate-950">{result.examTitle}</h1>
        <p className="mt-2 text-sm text-slate-600">
          Soumise le {new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(result.submittedAt))}
        </p>
      </header>

      <section aria-label="Résultats des épreuves" className="grid gap-4 sm:grid-cols-3">
        {result.results.map((section) => (
          <article className="stat-card" key={section.section}>
            <p className="stat-label">{sectionNames[section.section]}</p>
            <p className="stat-value">{section.score} / 699</p>
            <p className="mt-1 text-sm text-slate-600">
              {section.level ?? "Niveau non calculé"} · {section.details.correct ?? 0}/{section.details.total ?? 0} bonnes réponses
            </p>
          </article>
        ))}
      </section>

      {result.results.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-slate-600">Aucun résultat d’épreuve n’est disponible pour cette simulation.</p>
      ) : (
        <section aria-labelledby="correction-title" className="space-y-6">
          <h2 className="text-2xl font-bold text-slate-950" id="correction-title">Correction question par question</h2>
          {(["CO", "SL", "CE"] as const).map((section) => {
            const questions = result.questions.filter((question) => question.section === section);
            if (questions.length === 0) return null;
            return (
              <section aria-label={sectionNames[section]} className="space-y-3" key={section}>
                <h3 className="text-xl font-bold text-slate-900">{sectionNames[section]}</h3>
                {questions.map((question, index) => (
                  <article className="rounded-xl border border-slate-200 bg-white p-5" key={question.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h4 className="font-semibold text-slate-900">Question {index + 1} · {question.points} points</h4>
                      <span className={question.isCorrect ? "text-sm font-semibold text-emerald-700" : "text-sm font-semibold text-red-700"}>
                        {question.isCorrect ? "Correct" : "Incorrect"}
                      </span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-slate-800">{question.prompt}</p>
                    <p className="mt-3 text-sm text-slate-600">Votre réponse : {optionText(question, question.selectedOption)}</p>
                    <p className="mt-1 text-sm font-medium text-emerald-800">Bonne réponse : {optionText(question, question.correctOption)}</p>
                    {question.explanation && <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">{question.explanation}</p>}
                  </article>
                ))}
              </section>
            );
          })}
        </section>
      )}
      <Link className="secondary-btn inline-flex" href="/dashboard">Retour au tableau de bord</Link>
    </div>
  );
}
