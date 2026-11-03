'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { requestExamFullscreen } from "@/lib/exam-fullscreen";
import tcfLogo from "@/imgs/Tcf-CMJN.png";

type Screen = "identity" | "instructions" | "transition" | "section" | "results";
type SectionKey = "CO" | "SL" | "CE";
type MultipleChoiceSection = SectionKey;
type ExamQuestion = {
  id: string;
  section: SectionKey;
  prompt: string;
  passage?: string | null;
  options: string[];
  points: number;
  durationSeconds: number | null;
  hasAudio: boolean;
  hasImage: boolean;
};
type SignedQuestionMedia = { audioUrl: string | null; imageUrl: string | null };
type ExamResult = {
  sectionScores: Record<SectionKey, number>;
  sectionLevels: Record<SectionKey, string | null>;
  globalScore: number;
};

const scoredSections: MultipleChoiceSection[] = ["CO", "SL", "CE"];
const sectionCounts: Record<SectionKey, number> = { CO: 34, SL: 23, CE: 34 };
const sectionOrder: SectionKey[] = ["CO", "SL", "CE"];
const sectionTitles: Record<SectionKey, string> = {
  CO: "Compréhension orale",
  SL: "Maîtrise des structures de la langue",
  CE: "Compréhension écrite",
};
function groupQuestions(questions: ExamQuestion[]) {
  return questions.reduce<Record<MultipleChoiceSection, ExamQuestion[]>>(
    (groups, question) => {
      groups[question.section].push(question);
      return groups;
    },
    { CO: [], SL: [], CE: [] },
  );
}

function getQuestion(
  section: SectionKey,
  index: number,
  questionsBySection: Record<MultipleChoiceSection, ExamQuestion[]>,
): ExamQuestion | undefined {
  return questionsBySection[section][index];
}

async function submitAttempt(examId: string, attemptId: string): Promise<ExamResult> {
  const response = await fetch(`/api/exams/${encodeURIComponent(examId)}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId }),
  });
  const data = await response.json() as ExamResult & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Le calcul des résultats a échoué.");
  return data;
}

function CandidateSidebar({
  candidateName,
  time,
}: {
  candidateName: string;
  time: string;
}) {
  return (
    <aside className="exam-sidebar exam-sidebar-right">
      <svg className="exam-photo" viewBox="0 0 100 100" role="img" aria-label="Photo anonyme">
        <circle cx="50" cy="34" r="18" />
        <path d="M15 95c2-23 15-36 35-36s33 13 35 36z" />
      </svg>
      <p>{candidateName}</p>
      <p className="exam-timer" aria-live="polite">{time}</p>
    </aside>
  );
}

function ExamHeader() {
  return (
    <header className="exam-header">
      <div className="exam-band exam-band-dark">
        <span className="exam-title">Test de connaissance du français</span>
        <Image
          className="exam-logo"
          src={tcfLogo}
          alt="Logo TCF"
          width={36}
          height={36}
        />
      </div>
      <div className="exam-band exam-band-mid" />
      <div className="exam-band exam-band-light" />
    </header>
  );
}

function NativeExamActions({
  onNext,
  onQuitTest,
  onQuitSection,
  nextLabel = "Suivant",
  showNext = true,
}: {
  onNext: () => void;
  onQuitTest: () => void;
  onQuitSection: () => void;
  nextLabel?: string;
  showNext?: boolean;
}) {
  return (
    <div className="exam-actions">
      {showNext && (
        <div className="exam-next-row">
          <button type="button" onClick={onNext}>{nextLabel}</button>
        </div>
      )}
      <div className="exam-quit-row">
        <button type="button" onClick={onQuitTest}>Quitter le test</button>
        <button type="button" onClick={onQuitSection}>Quitter l’épreuve</button>
      </div>
    </div>
  );
}

export function ExamDemo({
  autoStart = false,
  examId,
  attemptId: initialAttemptId,
  fullscreenUnavailable = false,
}: {
  autoStart?: boolean;
  examId: string;
  attemptId?: string;
  fullscreenUnavailable?: boolean;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("identity");
  const [attemptId, setAttemptId] = useState(initialAttemptId ?? "");
  const [section, setSection] = useState<SectionKey>("CO");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState(45);
  const [globalSecondsLeft, setGlobalSecondsLeft] = useState(0);
  const [endsAt, setEndsAt] = useState("");
  const [fullscreenPrompt, setFullscreenPrompt] = useState(false);
  const [fullscreenExits, setFullscreenExits] = useState(0);
  const [fullscreenError, setFullscreenError] = useState(
    fullscreenUnavailable ? "Le mode plein écran n’a pas pu être activé dans ce navigateur." : "",
  );
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [questionMedia, setQuestionMedia] = useState<Record<string, SignedQuestionMedia>>({});
  const [examResult, setExamResult] = useState<ExamResult | null>(null);
  const [examError, setExamError] = useState("");
  const [attemptLoaded, setAttemptLoaded] = useState(false);
  const answerRef = useRef<number | null>(null);
  const answersRef = useRef<Record<string, number>>({});
  const advanceRef = useRef<() => void>(() => {});
  const finishRef = useRef<() => void>(() => {});
  const hasSubmittedRef = useRef(false);
  const confirmedThisMountRef = useRef(false);
  const answerSaveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const audioRef = useRef<HTMLAudioElement>(null);
  const playedAudioQuestionsRef = useRef(new Set<string>());

  const questionsBySection = useMemo(() => groupQuestions(questions), [questions]);
  const currentQuestion = useMemo(
    () => getQuestion(section, questionIndex, questionsBySection),
    [section, questionIndex, questionsBySection],
  );
  const selectedAnswer = currentQuestion ? answers[currentQuestion.id] ?? null : null;
  const currentMedia = currentQuestion ? questionMedia[currentQuestion.id] : undefined;
  const loadingQuestions = Boolean(attemptId) && !attemptLoaded && !examError;
  const displayQuestionNumber = questionIndex + 1;
  const candidateName = "Candidat";

  useEffect(() => {
    if (!autoStart || !attemptId) return;

    let active = true;
    fetch(`/api/exams/${encodeURIComponent(examId)}/questions?attempt=${encodeURIComponent(attemptId)}`)
      .then(async (response) => {
        const data = await response.json() as {
          status: "in_progress" | "submitted";
          endsAt: string;
          questions: ExamQuestion[];
          answers: Record<string, string | null>;
        };
        if (!response.ok) throw new Error("error" in data ? String(data.error) : "Les questions n’ont pas pu être chargées.");
        if (!active) return;

        const answerIndices = Object.fromEntries(
          Object.entries(data.answers).flatMap(([questionId, option]) => {
            const index = typeof option === "string" ? option.charCodeAt(0) - 65 : -1;
            return index >= 0 && index < 4 ? [[questionId, index]] : [];
          }),
        );
        setQuestions(data.questions);
        setAnswers(answerIndices);
        answersRef.current = answerIndices;
        setEndsAt(data.endsAt);
        setGlobalSecondsLeft(Math.max(0, Math.ceil((new Date(data.endsAt).getTime() - Date.now()) / 1000)));

        if (data.status === "submitted") {
          const result = await submitAttempt(examId, attemptId);
          if (active) {
            setExamResult(result);
            setScreen("results");
            hasSubmittedRef.current = true;
          }
          return;
        }

        const resumeKey = `tcf-attempt-confirmed:${attemptId}`;
        if (!confirmedThisMountRef.current && window.sessionStorage.getItem(resumeKey) === "1") {
          const loadedBySection = groupQuestions(data.questions);
          const firstUnanswered = sectionOrder.flatMap((questionSection) =>
            loadedBySection[questionSection].map((question, index) => ({ questionSection, index, question })),
          ).find(({ question }) => answerIndices[question.id] === undefined);

          if (firstUnanswered) {
            setSection(firstUnanswered.questionSection);
            setQuestionIndex(firstUnanswered.index);
            setSecondsLeft(firstUnanswered.question.durationSeconds ?? 45);
            setScreen("section");
          } else {
            const result = await submitAttempt(examId, attemptId);
            if (active) {
              setExamResult(result);
              setScreen("results");
              hasSubmittedRef.current = true;
            }
          }
        }
      })
      .catch((loadError: unknown) => {
        if (active) setExamError(loadError instanceof Error ? loadError.message : "Le chargement des questions a échoué.");
      })
      .finally(() => {
        if (active) setAttemptLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [attemptId, autoStart, examId]);

  useEffect(() => {
    if (
      screen !== "section"
      || !attemptId
      || !currentQuestion
      || (!currentQuestion.hasAudio && !currentQuestion.hasImage)
    ) return;

    const controller = new AbortController();
    fetch(
      `/api/exams/${encodeURIComponent(examId)}/questions?attempt=${encodeURIComponent(attemptId)}&questionId=${encodeURIComponent(currentQuestion.id)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const data = await response.json() as SignedQuestionMedia & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Les médias de la question n’ont pas pu être chargés.");
        setQuestionMedia((current) => ({ ...current, [currentQuestion.id]: data }));
      })
      .catch((mediaError: unknown) => {
        if (!controller.signal.aborted) {
          setExamError(mediaError instanceof Error ? mediaError.message : "Les médias de la question n’ont pas pu être chargés.");
        }
      });

    return () => controller.abort();
  }, [attemptId, currentQuestion, examId, screen]);

  useEffect(() => {
    if (
      screen !== "section"
      || section !== "CO"
      || !currentQuestion?.hasAudio
      || !currentMedia?.audioUrl
      || playedAudioQuestionsRef.current.has(currentQuestion.id)
    ) return;

    playedAudioQuestionsRef.current.add(currentQuestion.id);
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().catch((playError: unknown) => {
      setExamError(playError instanceof Error
        ? `La lecture audio automatique a échoué : ${playError.message}`
        : "La lecture audio automatique a échoué.");
    });
  }, [currentMedia?.audioUrl, currentQuestion, screen, section]);

  useEffect(() => {
    answerRef.current = selectedAnswer;
  }, [selectedAnswer]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    if (screen !== "section") return;

    const interval = window.setInterval(() => {
      const remainingUntilDeadline = endsAt
        ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000))
        : 0;
      setGlobalSecondsLeft(remainingUntilDeadline);
      if (remainingUntilDeadline <= 0) {
        window.setTimeout(() => finishRef.current(), 0);
        return;
      }

      if (section === "CO") {
        setSecondsLeft((remaining) => {
          if (remaining <= 1) {
            window.setTimeout(() => advanceRef.current(), 0);
            return 0;
          }
          return remaining - 1;
        });
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [endsAt, screen, section]);

  useEffect(() => {
    if (screen !== "section") return;

    const recordExit = () => {
      if (!document.fullscreenElement) {
        setFullscreenExits((count) => count + 1);
        setFullscreenPrompt(true);
      } else {
        setFullscreenPrompt(false);
      }
    };

    document.addEventListener("fullscreenchange", recordExit);
    return () => document.removeEventListener("fullscreenchange", recordExit);
  }, [screen]);

  async function answerIdentity(confirmed: boolean) {
    if (!confirmed) {
      if (document.fullscreenElement) void document.exitFullscreen();
      router.push("/examen");
      return;
    }

    setExamError("");
    try {
      let activeAttemptId = attemptId;
      if (!activeAttemptId) {
        const response = await fetch(`/api/exams/${encodeURIComponent(examId)}/start`, { method: "POST" });
        const data = await response.json() as { attemptId?: string; error?: string };
        if (!response.ok || !data.attemptId) {
          throw new Error(data.error ?? "Impossible de démarrer cet examen.");
        }
        activeAttemptId = data.attemptId;
        setAttemptId(activeAttemptId);
        router.replace(`/exam?start=1&exam=${encodeURIComponent(examId)}&attempt=${encodeURIComponent(activeAttemptId)}`);
      }

      window.sessionStorage.setItem(`tcf-attempt-confirmed:${activeAttemptId}`, "1");
      confirmedThisMountRef.current = true;
      setScreen("instructions");
    } catch (startError) {
      setExamError(startError instanceof Error ? startError.message : "Impossible de démarrer cet examen.");
    }
  }

  async function saveCurrentAnswer(): Promise<boolean> {
    const answer = answerRef.current;
    if (answer === null || !currentQuestion) return true;
    if (!attemptId) return false;

    const questionId = currentQuestion.id;
    answersRef.current = { ...answersRef.current, [questionId]: answer };
    setAnswers((previous) => ({ ...previous, [questionId]: answer }));

    const pendingSave = answerSaveQueueRef.current.then(async () => {
      try {
        const response = await fetch(`/api/exams/${encodeURIComponent(examId)}/answers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attemptId,
            questionId,
            selectedOption: String.fromCharCode(65 + answer),
          }),
        });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error ?? "La réponse n’a pas pu être enregistrée.");
        setExamError("");
        return true;
      } catch (saveError) {
        setExamError(saveError instanceof Error ? saveError.message : "La réponse n’a pas pu être enregistrée.");
        return false;
      }
    });
    answerSaveQueueRef.current = pendingSave;
    return pendingSave;
  }

  async function advanceQuestion() {
    if (!(await saveCurrentAnswer())) return;
    const lastQuestion = questionIndex === sectionCounts[section] - 1;

    if (!lastQuestion) {
      setQuestionIndex((index) => index + 1);
      answerRef.current = null;
      const nextQuestion = getQuestion(section, questionIndex + 1, questionsBySection);
      setSecondsLeft(nextQuestion?.durationSeconds ?? 45);
      return;
    }

    if (section === "CO") {
      setSection("SL");
      setQuestionIndex(0);
      setScreen("transition");
      return;
    }
    if (section === "SL") {
      setSection("CE");
      setQuestionIndex(0);
      setScreen("transition");
      return;
    }
    finishRef.current();
  }

  async function finishExam() {
    if (hasSubmittedRef.current) return;
    if (!(await saveCurrentAnswer())) return;
    hasSubmittedRef.current = true;
    try {
      const result = await submitAttempt(examId, attemptId);
      setExamResult(result);
      setScreen("results");
    } catch (submissionError) {
      hasSubmittedRef.current = false;
      setExamError(submissionError instanceof Error ? submissionError.message : "Le calcul des résultats a échoué.");
    }
  }

  async function navigateToQuestion(targetSection: SectionKey, targetIndex: number) {
    if (!(await saveCurrentAnswer())) return;
    setSection(targetSection);
    setQuestionIndex(targetIndex);
    const targetQuestion = getQuestion(targetSection, targetIndex, questionsBySection);
    if (!targetQuestion) return;
    const targetAnswer = answersRef.current[targetQuestion.id] ?? null;
    answerRef.current = targetAnswer;
    setSecondsLeft(targetQuestion.durationSeconds ?? 45);
  }

  function quitTest() {
    if (!window.confirm("Voulez-vous vraiment quitter le test ?")) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    router.push("/dashboard");
  }

  function quitSection() {
    if (!window.confirm("Voulez-vous vraiment quitter cette épreuve ? Vous ne pourrez pas y revenir.")) return;
    if (section === "CO") {
      setSection("SL");
      setQuestionIndex(0);
      setScreen("transition");
    } else if (section === "SL") {
      setSection("CE");
      setQuestionIndex(0);
      setScreen("transition");
    } else {
      finishRef.current();
    }
  }

  function returnToDashboard() {
    if (document.fullscreenElement) void document.exitFullscreen();
    router.push("/dashboard");
  }

  function formatTime(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function chooseAnswer(index: number) {
    if (!currentQuestion) return;
    answerRef.current = index;
    answersRef.current = { ...answersRef.current, [currentQuestion.id]: index };
    setAnswers((previous) => ({ ...previous, [currentQuestion.id]: index }));
    void saveCurrentAnswer();
  }

  useEffect(() => {
    advanceRef.current = () => advanceQuestion();
  });
  useEffect(() => {
    finishRef.current = () => void finishExam();
  });

  return (
    <div id="exam-root">
      {screen === "identity" && (
        <div className="exam-identity">
          <section className="exam-modal" aria-labelledby="identity-title">
            <p id="identity-title">Si vous êtes <strong>{candidateName}</strong>, cliquez sur <strong>Oui</strong>.</p>
            <p>Si vous n’êtes pas cette personne, cela peut vous exposer à des poursuites judiciaires.</p>
            <p dir="rtl" lang="ar">إذا لم تكن أنت هذا الشخص، فقد يعرّضك ذلك لإجراءات قانونية ضدك.</p>
            {fullscreenError && <p role="alert">{fullscreenError}</p>}
            {examError && <p role="alert">{examError}</p>}
            <div className="exam-native-controls">
              <button type="button" disabled={loadingQuestions} onClick={() => void answerIdentity(true)}>Oui</button>
              <button type="button" disabled={loadingQuestions} onClick={() => void answerIdentity(false)}>Non</button>
            </div>
          </section>
        </div>
      )}

      {screen === "instructions" && (
        <>
          <ExamHeader />
          <main className="exam-instructions">
            <h1>Consignes</h1>
            <p>Le test contient trois épreuves :</p>
            <ul>
              <li>Compréhension orale : 34 questions (25 min)</li>
              <li>Maîtrise des structures de la langue : 23 questions (25 min)</li>
              <li>Compréhension écrite : 34 questions (50 min)</li>
            </ul>
            <p>Pour chaque question, il y a 4 choix (A, B, C, D). Vous choisissez la bonne réponse (une seule).</p>
            <p>Si vous voulez continuer, cliquez sur <strong>Suivant</strong>.</p>
            <NativeExamActions
              onNext={() => {
                setSection("CO");
                setQuestionIndex(0);
                setSecondsLeft(questionsBySection.CO[0]?.durationSeconds ?? 45);
                setScreen("transition");
              }}
              onQuitTest={quitTest}
              onQuitSection={quitSection}
            />
          </main>
        </>
      )}

      {screen === "transition" && (
        <>
          <ExamHeader />
          <main className="exam-transition">
            <p>La partie <strong>{sectionTitles[section]}</strong> commence.</p>
            <p>Cliquez sur <strong>Suivant</strong> pour continuer.</p>
            <NativeExamActions
              onNext={() => setScreen("section")}
              onQuitTest={quitTest}
              onQuitSection={quitSection}
            />
          </main>
        </>
      )}

      {screen === "section" && (
        <>
          <ExamHeader />
          {loadingQuestions || !currentQuestion ? (
            <main className="exam-main">
              <p role={examError ? "alert" : "status"}>{examError || "Chargement des questions…"}</p>
            </main>
          ) : section === "CO" ? (
            <div className="exam-layout exam-layout-co">
              <main className="exam-main">
                <h1>Question {displayQuestionNumber}</h1>
                {currentQuestion.passage?.trim() ? (
                  <div className="exam-passage">{currentQuestion.passage}</div>
                ) : null}
                <p>{currentQuestion.prompt}</p>
                {currentQuestion.hasAudio && currentMedia?.audioUrl && (
                  <audio
                    ref={audioRef}
                    key={currentQuestion.id}
                    preload="auto"
                    src={currentMedia.audioUrl}
                  >
                    Votre navigateur ne prend pas en charge la lecture audio.
                  </audio>
                )}
                {currentQuestion.hasImage && currentMedia?.imageUrl && (
                  <img
                    alt={`Illustration de la question ${displayQuestionNumber}`}
                    src={currentMedia.imageUrl}
                    style={{ display: "block", maxWidth: "100%", height: "auto", border: 0, boxShadow: "none" }}
                  />
                )}
                {examError && <p role="alert">{examError}</p>}
                <fieldset className="exam-options">
                  <legend>Choisissez une réponse :</legend>
                  {currentQuestion.options.map((option, index) => (
                    <label key={option}>
                      <input
                        type="radio"
                        name={currentQuestion.id}
                        checked={selectedAnswer === index}
                        onChange={() => chooseAnswer(index)}
                      />
                      <span>{String.fromCharCode(65 + index)}. {option}</span>
                    </label>
                  ))}
                </fieldset>
                <NativeExamActions
                  onNext={() => {}}
                  onQuitTest={quitTest}
                  onQuitSection={quitSection}
                  showNext={false}
                />
              </main>
              <CandidateSidebar candidateName={candidateName} time={formatTime(secondsLeft)} />
            </div>
          ) : (
            <div className="exam-layout exam-layout-navigation">
              <nav className="exam-question-nav" aria-label="Navigation des questions">
                <p>Questions</p>
                <div className="exam-question-list">
                  {sectionOrder.slice(1).flatMap((targetSection) =>
                    questionsBySection[targetSection].map((question, targetIndex) => {
                      const isCurrent = section === targetSection && questionIndex === targetIndex;
                      const isAnswered = answers[question.id] !== undefined;
                      const stateClass = isCurrent ? "exam-question-current" : isAnswered ? "exam-question-answered" : "exam-question-unanswered";
                      return (
                        <a
                          key={question.id}
                          href={`#question-${question.id}`}
                          className={`exam-question-number ${stateClass}`}
                          aria-current={isCurrent ? "step" : undefined}
                          onClick={(event) => {
                            event.preventDefault();
                            void navigateToQuestion(targetSection, targetIndex);
                          }}
                        >
                          {targetIndex + 1}
                        </a>
                      );
                    }),
                  )}
                </div>
              </nav>
              <main className="exam-main" id={`question-${currentQuestion.id}`}>
                <h1>Question {displayQuestionNumber}</h1>
                {currentQuestion.passage?.trim() ? (
                  <div className="exam-passage">{currentQuestion.passage}</div>
                ) : null}
                <p>{currentQuestion.prompt}</p>
                {currentQuestion.hasImage && currentMedia?.imageUrl && (
                  <img
                    alt={`Illustration de la question ${displayQuestionNumber}`}
                    src={currentMedia.imageUrl}
                    style={{ display: "block", maxWidth: "100%", height: "auto", border: 0, boxShadow: "none" }}
                  />
                )}
                {examError && <p role="alert">{examError}</p>}
                <fieldset className="exam-options">
                  <legend>Choisissez une réponse :</legend>
                  {currentQuestion.options.map((option, index) => (
                    <label key={option}>
                      <input
                        type="radio"
                        name={currentQuestion.id}
                        checked={selectedAnswer === index}
                        onChange={() => chooseAnswer(index)}
                      />
                      <span>{String.fromCharCode(65 + index)}. {option}</span>
                    </label>
                  ))}
                </fieldset>
                {fullscreenPrompt && (
                  <p role="alert" className="exam-fullscreen-message">
                    Veuillez revenir en plein écran. Sorties du plein écran : {fullscreenExits}.
                    {" "}<button
                      type="button"
                      onClick={() => {
                        void requestExamFullscreen().then((enteredFullscreen) => {
                          if (enteredFullscreen) return;
                          setFullscreenError("Le mode plein écran n’a pas pu être réactivé.");
                        });
                      }}
                    >Revenir en plein écran</button>
                    {fullscreenError && <> {fullscreenError}</>}
                  </p>
                )}
                <NativeExamActions
                  onNext={advanceQuestion}
                  onQuitTest={quitTest}
                  onQuitSection={quitSection}
                />
              </main>
              <CandidateSidebar
                candidateName={candidateName}
                time={formatTime(globalSecondsLeft)}
              />
            </div>
          )}
        </>
      )}

      {screen === "results" && (
        <>
          <ExamHeader />
          <main className="exam-results">
            <h1>Résultats</h1>
            {examError ? (
              <p role="alert">{examError}</p>
            ) : examResult ? (
              <>
                <p>Score moyen : {examResult.globalScore}</p>
                <table>
                  <thead>
                    <tr><th>Épreuves obligatoires</th><th>Score</th><th>Niveau CECRL</th></tr>
                  </thead>
                  <tbody>
                    {scoredSections.map((resultSection) => (
                      <tr key={resultSection}>
                        <td>{sectionTitles[resultSection]}</td>
                        <td>{examResult.sectionScores[resultSection]}</td>
                        <td>{examResult.sectionLevels[resultSection] ?? "Non évalué"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>Merci de votre participation. Veuillez attendre à votre place.</p>
              </>
            ) : (
              <p role="status">Calcul des résultats…</p>
            )}
            <button type="button" onClick={returnToDashboard}>Retour à mon espace</button>
          </main>
        </>
      )}
    </div>
  );
}
