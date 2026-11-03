'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { z } from "zod";
import { sectionPositions, sectionKinds, sortSectionsByKind, type SectionKind } from "@/lib/exam-sections";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/client";

const examTypes = ["TCF Tout Public", "Canada", "IRN", "Québec"] as const;
const answerLetters = ["A", "B", "C", "D"] as const;
const audioBucket = "tcf-exam-audio";
const imageBucket = "tcf-exam-images";
const audioExtensions = ["mp3", "wav"] as const;
const imageExtensions = ["png", "jpg", "jpeg", "webp"] as const;

type ExamType = (typeof examTypes)[number];
type AnswerLetter = (typeof answerLetters)[number];
type ExamStatus = "draft" | "published" | "archived";

type ExamRow = {
  id: string;
  title: string;
  exam_type: ExamType;
  is_free: boolean;
  status: ExamStatus;
  sort_order: number;
};

type SectionRow = {
  id: string;
  exam_id: string;
  kind: SectionKind;
  position: number;
  duration_seconds: number;
  config: Record<string, unknown>;
};

type QuestionRow = {
  id: string;
  section_id: string;
  position: number;
  tier: number;
  passage: string | null;
  prompt: string;
  options: string[];
  correct_option: AnswerLetter | null;
  explanation: string | null;
  level: string | null;
  points: number;
  media_url: string | null;
  audio_path: string | null;
  image_path: string | null;
  duration_seconds: number | null;
};

type ProductionPromptRow = {
  id: string;
  section_id: string;
  task_number: number;
  instructions: string;
  min_words: number | null;
  max_words: number | null;
  prep_seconds: number | null;
  speak_seconds: number | null;
};

type SectionDrawRule = {
  section_id: string;
  tier: number;
  draw_count: number;
  points_per_question: number;
};

type TierRange = { start: number; end: number; tier: number };
type ImportMode = "upsert" | "passages";
type ImportPreview = {
  fileName: string;
  rows: ImportQuestion[];
  mode: ImportMode;
  missingFiles: string[];
  duplicateFiles: string[];
  questionsWithoutAudio: number[];
};
type StoredMediaFile = { name: string; path: string; kind: "audio" | "image" };

type ExamContent = ExamRow & { sections: SectionRow[] };
type ImportQuestion = {
  position: number;
  tier: number;
  passage: string | null;
  prompt: string;
  options: [string, string, string, string];
  correct_option: AnswerLetter;
  explanation: string | null;
  level: string | null;
  points: number;
  duration_seconds: number | null;
  audio_file: string | null;
  image_file: string | null;
  resolved_audio_path?: string | null;
  resolved_image_path?: string | null;
};

const importQuestionSchema = z.object({
  position: z.coerce.number().int().positive(),
  passage: z.string().trim().nullable().optional(),
  prompt: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).length(4),
  correct_option: z.enum(answerLetters),
  explanation: z.string().trim().nullable().optional(),
  level: z.string().trim().nullable().optional(),
  tier: z.coerce.number().int().min(1).max(6).default(1),
  points: z.coerce.number().finite().nonnegative().default(1),
  duration_seconds: z.coerce.number().int().positive().nullable().optional(),
});

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.trim().length === 0) {
      cell = "";
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("Le fichier CSV contient un guillemet non fermé.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("Le CSV doit contenir une ligne d’en-tête et au moins une question.");

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error("Le CSV contient des colonnes dupliquées.");

  return rows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(`La ligne ${rowIndex + 2} ne contient pas le même nombre de colonnes que l’en-tête.`);
    }
    return Object.fromEntries(headers.map((header, index) => [header, values[index].trim()]));
  });
}

function normalizeImportRow(row: Record<string, unknown>, index: number): ImportQuestion {
  // Accept options as array, as object {A,B,C,D} (JSON format), or as flat fields option_a/b/c/d (CSV format)
  const optionArray = Array.isArray(row.options)
    ? row.options
    : row.options !== null && typeof row.options === "object"
      ? (["A", "B", "C", "D"] as const).map((key) => (row.options as Record<string, unknown>)[key])
      : ["option_a", "option_b", "option_c", "option_d"].map((key) => row[key]);
  const rawPosition = row.position ?? index + 1;
  const rawPoints = row.points === "" || row.points == null ? 1 : row.points;
  const rawDuration = row.duration_seconds === "" || row.duration_seconds == null
    ? null
    : Math.ceil(Number(row.duration_seconds));
  const rawTier = row.tier === "" || row.tier == null ? 1 : row.tier;
  function readFileName(field: "audio_file" | "image_file"): string | null {
    const value = row[field];
    if (value == null || value === "") return null;
    if (typeof value !== "string" || value.includes("/") || value.includes("\\")) {
      throw new Error(`Question ${index + 1} : ${field} doit contenir uniquement un nom de fichier.`);
    }
    return value.trim() || null;
  }
  const audioFile = readFileName("audio_file");
  const imageFile = readFileName("image_file");

  const rawPassage = row.passage !== undefined && row.passage !== null && String(row.passage).trim() !== ""
    ? String(row.passage).trim()
    : null;

  const parsed = importQuestionSchema.safeParse({
    passage: rawPassage,
    position: rawPosition,
    prompt: row.prompt,
    options: optionArray,
    correct_option: String(row.correct_option ?? "").trim().toUpperCase(),
    explanation: row.explanation ? String(row.explanation) : null,
    level: row.level ? String(row.level) : null,
    tier: rawTier,
    points: rawPoints,
    duration_seconds: rawDuration,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Question ${index + 1} : ${issue.path.join(".") || "données"} — ${issue.message}`);
  }

  return {
    ...parsed.data,
    passage: parsed.data.passage ?? null,
    options: parsed.data.options as [string, string, string, string],
    explanation: parsed.data.explanation ?? null,
    level: parsed.data.level ?? null,
    duration_seconds: parsed.data.duration_seconds ?? null,
    audio_file: audioFile,
    image_file: imageFile,
  };
}

function normalizedFileName(name: string): string {
  return name.trim().replace(/^.*[\\/]/, "").toLocaleLowerCase();
}

function mediaExtension(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function validateMediaFile(file: File, kind: StoredMediaFile["kind"]): string | null {
  if (file.name.includes("/") || file.name.includes("\\") || !file.name.trim()) {
    return "Le nom du fichier ne doit pas contenir de chemin.";
  }
  const extension = mediaExtension(file);
  if (kind === "audio") {
    if (!audioExtensions.includes(extension as (typeof audioExtensions)[number])) {
      return "Choisissez un fichier audio au format MP3 ou WAV.";
    }
    if (file.size > 20 * 1024 * 1024) return "La taille maximale d’un fichier audio est de 20 Mo.";
    if (file.type && !["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"].includes(file.type)) {
      return "Le type du fichier n’est pas reconnu comme audio MP3 ou WAV.";
    }
    return null;
  }
  if (!imageExtensions.includes(extension as (typeof imageExtensions)[number])) {
    return "Choisissez une image PNG, JPG, JPEG ou WebP.";
  }
  if (file.size > 5 * 1024 * 1024) return "La taille maximale d’une image est de 5 Mo.";
  if (file.type && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return "Le type du fichier n’est pas reconnu comme image PNG, JPG ou WebP.";
  }
  return null;
}

async function listSectionMedia(
  supabase: ReturnType<typeof createClient>,
  examId: string,
  sectionId: string,
): Promise<StoredMediaFile[]> {
  const prefix = `${examId}/${sectionId}`;
  const [audioResult, imageResult] = await Promise.all([
    supabase.storage.from(audioBucket).list(prefix, { limit: 1000 }),
    supabase.storage.from(imageBucket).list(prefix, { limit: 1000 }),
  ]);
  if (audioResult.error) throw audioResult.error;
  if (imageResult.error) throw imageResult.error;
  return [
    ...(audioResult.data ?? []).map(({ name }) => ({ name, path: `${prefix}/${name}`, kind: "audio" as const })),
    ...(imageResult.data ?? []).map(({ name }) => ({ name, path: `${prefix}/${name}`, kind: "image" as const })),
  ];
}

function parseTierRanges(value: string): TierRange[] {
  const lines = value.split(/\r?\n/).filter((line) => line.trim());
  const ranges = lines.map((line, index) => {
    const match = /^\s*(\d+)\s*-\s*(\d+)\s*(?:->|→)\s*(\d+)\s*$/.exec(line);
    if (!match) throw new Error(`Ligne ${index + 1} : utilisez le format « début-fin → niveau ».`);
    const [, rawStart, rawEnd, rawTier] = match;
    const range = { start: Number(rawStart), end: Number(rawEnd), tier: Number(rawTier) };
    if (range.start < 1 || range.end < range.start || range.tier < 1 || range.tier > 6) {
      throw new Error(`Ligne ${index + 1} : positions ou niveau hors limites.`);
    }
    return range;
  });

  if (!ranges.length) throw new Error("Définissez au moins une plage de positions.");
  for (let index = 0; index < ranges.length; index += 1) {
    if (ranges.some((range, otherIndex) => (
      otherIndex > index && range.start <= ranges[index].end && ranges[index].start <= range.end
    ))) {
      throw new Error("Les plages de positions ne doivent pas se chevaucher.");
    }
  }
  return ranges;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes} min ${remainingSeconds} s` : `${minutes} min`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function createAdminClient() {
  if (!isSupabaseConfigured()) throw new Error("Supabase n’est pas configuré.");
  return createClient();
}

export function AdminPanel() {
  const [exams, setExams] = useState<ExamContent[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [drawRules, setDrawRules] = useState<SectionDrawRule[]>([]);
  const [prompts, setPrompts] = useState<ProductionPromptRow[]>([]);
  const [signedAudioUrls, setSignedAudioUrls] = useState<Record<string, string>>({});
  const [signedImageUrls, setSignedImageUrls] = useState<Record<string, string>>({});
  const [uploadedMedia, setUploadedMedia] = useState<StoredMediaFile[]>([]);
  const [uploadedMediaSection, setUploadedMediaSection] = useState("");
  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [examEditor, setExamEditor] = useState<ExamRow | null | false>(false);
  const [sectionEditor, setSectionEditor] = useState<SectionRow | null | false>(false);
  const [questionEditor, setQuestionEditor] = useState<QuestionRow | null | false>(false);
  const [promptEditor, setPromptEditor] = useState<ProductionPromptRow | null | false>(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [tierRangesOpen, setTierRangesOpen] = useState(false);
  const [tierRangesText, setTierRangesText] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioBatchInput = useRef<HTMLInputElement>(null);
  const imageBatchInput = useRef<HTMLInputElement>(null);
  const supabaseConfigured = isSupabaseConfigured();

  const selectedExam = exams.find((exam) => exam.id === selectedExamId) ?? null;
  const selectedSection = selectedExam?.sections.find((section) => section.id === selectedSectionId) ?? null;
  const sectionQuestions = useMemo(
    () => questions.filter((question) => question.section_id === selectedSectionId).sort((a, b) => a.position - b.position),
    [questions, selectedSectionId],
  );
  const sectionPrompts = useMemo(
    () => prompts.filter((prompt) => prompt.section_id === selectedSectionId).sort((a, b) => a.task_number - b.task_number),
    [prompts, selectedSectionId],
  );
  const sectionDrawRules = useMemo(
    () => drawRules.filter((rule) => rule.section_id === selectedSectionId).sort((a, b) => a.tier - b.tier),
    [drawRules, selectedSectionId],
  );
  const sectionRuleRows = useMemo(() => Array.from({ length: 6 }, (_, index) => {
    const tier = index + 1;
    return sectionDrawRules.find((rule) => rule.tier === tier) ?? {
      section_id: selectedSectionId,
      tier,
      draw_count: 0,
      points_per_question: 1,
    };
  }), [sectionDrawRules, selectedSectionId]);
  const availableByTier = useMemo(() => {
    const counts = Array.from({ length: 6 }, () => 0);
    for (const question of sectionQuestions) {
      if (question.correct_option) counts[question.tier - 1] += 1;
    }
    return counts;
  }, [sectionQuestions]);
  const configuredQuestionCount = sectionRuleRows.reduce((total, rule) => total + rule.draw_count, 0);
  const configuredMaximumScore = sectionRuleRows.reduce(
    (total, rule) => total + rule.draw_count * rule.points_per_question,
    0,
  );
  const expectedQuestionCount = selectedSection?.kind === "CO" || selectedSection?.kind === "CE" ? 34
    : selectedSection?.kind === "SL" ? 23
      : null;

  const loadContent = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const supabase = createAdminClient();
      const [
        { data: examData, error: examError },
        { data: sectionData, error: sectionError },
        { data: questionData, error: questionError },
        { data: promptData, error: promptError },
        { data: drawRuleData, error: drawRuleError },
      ] = await Promise.all([
        supabase.from("exams").select("id, title, exam_type, is_free, status, sort_order").order("sort_order"),
        supabase.from("exam_sections").select("id, exam_id, kind, position, duration_seconds, config").order("position"),
        supabase.from("questions").select("id, section_id, position, tier, passage, prompt, options, correct_option, explanation, level, points, media_url, audio_path, image_path, duration_seconds").order("position"),
        supabase.from("prompts_production").select("id, section_id, task_number, instructions, min_words, max_words, prep_seconds, speak_seconds").order("task_number"),
        supabase.from("section_draw_rules").select("section_id, tier, draw_count, points_per_question"),
      ]);

      const firstError = examError ?? sectionError ?? questionError ?? promptError ?? drawRuleError;
      if (firstError) throw new Error(firstError.message);

      const typedExams = (examData ?? []) as ExamRow[];
      const typedSections = (sectionData ?? []) as SectionRow[];
      const typedQuestions = (questionData ?? []) as QuestionRow[];
      const typedPrompts = (promptData ?? []) as ProductionPromptRow[];
      const typedDrawRules = (drawRuleData ?? []) as SectionDrawRule[];
      const mappedExams = typedExams.map((exam) => ({
        ...exam,
        sections: sortSectionsByKind(typedSections.filter((section) => section.exam_id === exam.id)),
      }));

      setExams(mappedExams);
      setQuestions(typedQuestions);
      setDrawRules(typedDrawRules);
      setPrompts(typedPrompts);
      setSelectedExamId((current) =>
        mappedExams.some((exam) => exam.id === current) ? current : mappedExams[0]?.id ?? "",
      );
      setSelectedSectionId((current) =>
        typedSections.some((section) => section.id === current) ? current : "",
      );

      const audioPaths = [...new Set(typedQuestions.map((question) => question.audio_path || question.media_url).filter((path): path is string => Boolean(path)))];
      const imagePaths = [...new Set(typedQuestions.map((question) => question.image_path).filter((path): path is string => Boolean(path)))];
      const [signedAudioEntries, signedImageEntries] = await Promise.all([
        Promise.all(audioPaths.map(async (path) => {
          const { data, error: signedUrlError } = await supabase.storage.from(audioBucket).createSignedUrl(path, 3600);
          if (signedUrlError) {
            console.error("Unable to create signed URL for exam audio:", signedUrlError.message);
            return [path, ""] as const;
          }
          return [path, data.signedUrl] as const;
        })),
        Promise.all(imagePaths.map(async (path) => {
          const { data, error: signedUrlError } = await supabase.storage.from(imageBucket).createSignedUrl(path, 3600);
          if (signedUrlError) {
            console.error("Unable to create signed URL for exam image:", signedUrlError.message);
            return [path, ""] as const;
          }
          return [path, data.signedUrl] as const;
        })),
      ]);
      setSignedAudioUrls(Object.fromEntries(signedAudioEntries));
      setSignedImageUrls(Object.fromEntries(signedImageEntries));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Le contenu n’a pas pu être chargé.";
      if ((message.includes("section_draw_rules") && (
        message.includes("does not exist")
        || message.includes("schema cache")
        || message.includes("permission denied")
      )) || (message.includes("questions.tier") && message.includes("does not exist"))) {
        setError("La base Supabase n’a pas encore les règles de tirage par niveau. Exécutez supabase/migrations/014_tiered_question_draws.sql dans le SQL Editor, puis rechargez le panneau admin.");
        return;
      }
      if (message.includes("questions.audio_path") || message.includes("questions.image_path")) {
        setError("La base Supabase n’a pas encore les colonnes de médias privées. Exécutez supabase/migrations/019_question_private_media.sql dans le SQL Editor Supabase, puis rechargez le panneau admin.");
        return;
      }
      if (message.includes("questions.passage") && message.includes("does not exist")) {
        setError("La base Supabase n'a pas encore la colonne passage. Exécutez supabase/migrations/017_question_passage.sql dans le SQL Editor Supabase, puis rechargez le panneau admin.");
        return;
      }
      if (message.includes("permission denied for table questions")) {
        setError("Supabase refuse la lecture des questions. Exécutez supabase/migrations/003_admin_content_read_permissions.sql dans le SQL Editor, puis rechargez le panneau admin.");
        return;
      }
      if (message.includes("exam_sections.position") && message.includes("does not exist")) {
        setError("La base Supabase n’a pas encore la colonne de position des épreuves. Exécutez le contenu de supabase/migrations/005_exam_section_order.sql dans le SQL Editor Supabase, puis rechargez cette page.");
        return;
      }
      setError(`Chargement Supabase : ${message}. Vérifiez que les migrations 001, 002, 003 et 005 ont été exécutées et que votre compte est connecté avec le rôle admin.`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadContent(), 0);
    return () => window.clearTimeout(timer);
  }, [loadContent]);

  useEffect(() => {
    if (!selectedExamId || !selectedSectionId) {
      return;
    }
    let active = true;
    Promise.resolve()
      .then(() => listSectionMedia(createAdminClient(), selectedExamId, selectedSectionId))
      .then((files) => {
        if (active) {
          setUploadedMedia(files);
          setUploadedMediaSection(`${selectedExamId}:${selectedSectionId}`);
        }
      })
      .catch((mediaError: unknown) => {
        if (active) {
          setUploadedMedia([]);
          setUploadedMediaSection(`${selectedExamId}:${selectedSectionId}`);
          setError(`Lecture des médias envoyés : ${mediaError instanceof Error ? mediaError.message : "erreur inconnue"}`);
        }
      });
    return () => {
      active = false;
    };
  }, [selectedExamId, selectedSectionId]);

  function clearMessages() {
    setError("");
    setNotice("");
  }

  async function handleExamSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const exam = {
      title: asString(form.get("title")).trim(),
      exam_type: asString(form.get("exam_type")) as ExamType,
      is_free: form.get("is_free") === "on",
      status: asString(form.get("status")) as ExamStatus,
      sort_order: Number(form.get("sort_order") || 0),
    };
    try {
      const supabase = createAdminClient();
      const query = examEditor
        ? supabase.from("exams").update(exam).eq("id", examEditor.id)
        : supabase.from("exams").insert(exam);
      const { error: saveError } = await query;
      if (saveError) throw saveError;
      setExamEditor(false);
      setNotice(examEditor ? "L’examen a été mis à jour." : "L’examen a été créé.");
      await loadContent();
    } catch (saveError) {
      setError(`Enregistrement de l’examen : ${saveError instanceof Error ? saveError.message : "erreur inconnue"}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteExam(exam: ExamRow) {
    if (!window.confirm(`Supprimer « ${exam.title} » et tout son contenu ? Cette action est irréversible.`)) return;
    clearMessages();
    setBusy(true);
    try {
      const supabase = createAdminClient();
      const { error: deleteError } = await supabase.from("exams").delete().eq("id", exam.id);
      if (deleteError) throw deleteError;
      setNotice(`L’examen « ${exam.title} » a été supprimé.`);
      if (selectedExamId === exam.id) {
        setSelectedExamId("");
        setSelectedSectionId("");
      }
      await loadContent();
    } catch (deleteError) {
      setError(`Suppression de l’examen : ${deleteError instanceof Error ? deleteError.message : "erreur inconnue"}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSectionSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedExamId) return;
    clearMessages();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const kind = asString(form.get("kind")) as SectionKind;
    const section = {
      exam_id: selectedExamId,
      kind,
      position: sectionPositions[kind],
      duration_seconds: Number(form.get("duration_minutes")) * 60,
    };
    try {
      const supabase = createAdminClient();
      const query = sectionEditor
        ? supabase.from("exam_sections").update(section).eq("id", sectionEditor.id)
        : supabase.from("exam_sections").insert(section);
      const { error: saveError } = await query;
      if (saveError) throw saveError;
      setSectionEditor(false);
      setSelectedSectionId("");
      setNotice(sectionEditor ? "L’épreuve a été mise à jour." : "L’épreuve a été ajoutée à l’examen.");
      await loadContent();
    } catch (saveError) {
      setError(`Enregistrement de l’épreuve : ${saveError instanceof Error ? saveError.message : "erreur inconnue"}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSection(section: SectionRow) {
    if (!window.confirm(`Supprimer l’épreuve ${section.kind} et tout son contenu ?`)) return;
    clearMessages();
    setBusy(true);
    try {
      const supabase = createAdminClient();
      const { error: deleteError } = await supabase.from("exam_sections").delete().eq("id", section.id);
      if (deleteError) throw deleteError;
      setSelectedSectionId("");
      setNotice(`L’épreuve ${section.kind} a été supprimée.`);
      await loadContent();
    } catch (deleteError) {
      setError(`Suppression de l’épreuve : ${deleteError instanceof Error ? deleteError.message : "erreur inconnue"}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleQuestionSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSection) return;
    clearMessages();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const audioPath = asString(form.get("audio_path")).trim() || null;
    const imagePath = asString(form.get("image_path")).trim() || null;
    const passage = asString(form.get("passage")).trim() || null;
    const question: Omit<QuestionRow, "id"> = {
      section_id: selectedSection.id,
      position: Number(form.get("position")),
      tier: Number(form.get("tier")),
      passage,
      prompt: asString(form.get("prompt")).trim(),
      options: answerLetters.map((letter) => asString(form.get(`option_${letter}`)).trim()),
      correct_option: asString(form.get("correct_option")) as AnswerLetter,
      explanation: asString(form.get("explanation")).trim() || null,
      level: asString(form.get("level")).trim() || null,
      points: Number(form.get("points")),
      media_url: audioPath,
      audio_path: audioPath,
      image_path: imagePath,
      duration_seconds: selectedSection.kind === "CO" ? Number(form.get("duration_seconds")) : null,
    };

    if (!Number.isInteger(question.tier) || question.tier < 1 || question.tier > 6) {
      setError("Le niveau de tirage doit être compris entre 1 et 6.");
      setBusy(false);
      return;
    }
    if (question.options.some((option) => !option)) {
      setError("Renseignez les quatre options A, B, C et D.");
      setBusy(false);
      return;
    }
    if (selectedSection.kind === "CO" && (!question.duration_seconds || question.duration_seconds < 1)) {
      setError("Une durée en secondes est requise pour chaque question de compréhension orale.");
      setBusy(false);
      return;
    }

    try {
      const supabase = createAdminClient();
      const query = questionEditor
        ? supabase.from("questions").update(question).eq("id", questionEditor.id)
        : supabase.from("questions").insert(question);
      const { error: saveError } = await query;
      if (saveError) throw saveError;
      setQuestionEditor(false);
      setNotice(questionEditor ? "La question a été mise à jour." : "La question a été ajoutée.");
      await loadContent();
    } catch (saveError) {
      setError(`Enregistrement de la question : ${saveError instanceof Error ? saveError.message : "erreur inconnue"}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteQuestion(question: QuestionRow) {
    if (!window.confirm(`Supprimer la question ${question.position} ?`)) return;
    clearMessages();
    setBusy(true);
    try {
      const supabase = createAdminClient();
      const { error: deleteError } = await supabase.from("questions").delete().eq("id", question.id);
      if (deleteError) throw deleteError;
      const audioPath = question.audio_path || question.media_url;
      if (audioPath && !questions.some((item) => item.id !== question.id && (item.audio_path || item.media_url) === audioPath)) {
        const { error: storageError } = await supabase.storage.from(audioBucket).remove([audioPath]);
        if (storageError) console.error("Unable to remove orphaned exam audio:", storageError.message);
      }
      if (question.image_path && !questions.some((item) => item.id !== question.id && item.image_path === question.image_path)) {
        const { error: storageError } = await supabase.storage.from(imageBucket).remove([question.image_path]);
        if (storageError) console.error("Unable to remove orphaned exam image:", storageError.message);
      }
      setNotice(`La question ${question.position} a été supprimée.`);
      await loadContent();
    } catch (deleteError) {
      setError(`Suppression de la question : ${deleteError instanceof Error ? deleteError.message : "erreur inconnue"}`);
    } finally {
      setBusy(false);
    }
  }

  async function handlePromptSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSection) return;
    clearMessages();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const prompt: Omit<ProductionPromptRow, "id"> = {
      section_id: selectedSection.id,
      task_number: Number(form.get("task_number")),
      instructions: asString(form.get("instructions")).trim(),
      min_words: form.get("min_words") ? Number(form.get("min_words")) : null,
      max_words: form.get("max_words") ? Number(form.get("max_words")) : null,
      prep_seconds: form.get("prep_seconds") ? Number(form.get("prep_seconds")) : null,
      speak_seconds: form.get("speak_seconds") ? Number(form.get("speak_seconds")) : null,
    };
    if (prompt.min_words !== null && prompt.max_words !== null && prompt.min_words > prompt.max_words) {
      setError("Le minimum de mots ne peut pas être supérieur au maximum.");
      setBusy(false);
      return;
    }
    try {
      const supabase = createAdminClient();
      const query = promptEditor
        ? supabase.from("prompts_production").update(prompt).eq("id", promptEditor.id)
        : supabase.from("prompts_production").insert(prompt);
      const { error: saveError } = await query;
      if (saveError) throw saveError;
      setPromptEditor(false);
      setNotice(promptEditor ? "La consigne de production a été mise à jour." : "La consigne de production a été ajoutée.");
      await loadContent();
    } catch (saveError) {
      setError(`Enregistrement de la consigne : ${saveError instanceof Error ? saveError.message : "erreur inconnue"}`);
    } finally {
      setBusy(false);
    }
  }

  async function deletePrompt(prompt: ProductionPromptRow) {
    if (!window.confirm(`Supprimer la consigne ${prompt.task_number} ?`)) return;
    clearMessages();
    setBusy(true);
    try {
      const supabase = createAdminClient();
      const { error: deleteError } = await supabase.from("prompts_production").delete().eq("id", prompt.id);
      if (deleteError) throw deleteError;
      setNotice(`La consigne ${prompt.task_number} a été supprimée.`);
      await loadContent();
    } catch (deleteError) {
      setError(`Suppression de la consigne : ${deleteError instanceof Error ? deleteError.message : "erreur inconnue"}`);
    } finally {
      setBusy(false);
    }
  }

  async function storeMediaFile(file: File, kind: StoredMediaFile["kind"], upsert: boolean) {
    const bucket = kind === "audio" ? audioBucket : imageBucket;
    const path = `${selectedExamId}/${selectedSectionId}/${file.name}`;
    const extension = mediaExtension(file);
    const contentType = kind === "audio"
      ? extension === "mp3" ? "audio/mpeg" : "audio/wav"
      : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
    const supabase = createAdminClient();
    const { data, error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
      contentType,
      upsert,
    });
    if (uploadError) throw uploadError;
    const { data: signed, error: signedError } = await supabase.storage.from(bucket).createSignedUrl(data.path, 3600);
    if (signedError) throw signedError;
    return { path: data.path, signedUrl: signed.signedUrl, name: file.name, kind };
  }

  function setMediaFormValue(kind: StoredMediaFile["kind"], path: string) {
    const fieldName = kind === "audio" ? "audio_path" : "image_path";
    const field = document.querySelector<HTMLInputElement>(`[name='${fieldName}']`);
    if (field) {
      field.value = path;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (kind === "audio") {
      const legacyField = document.querySelector<HTMLInputElement>("[name='media_url']");
      if (legacyField) legacyField.value = path;
    }
  }

  async function uploadSingleMedia(event: ChangeEvent<HTMLInputElement>, kind: StoredMediaFile["kind"]) {
    const target = event.currentTarget;
    const file = target.files?.[0];
    target.value = "";
    if (!file || !selectedSection) return;
    clearMessages();
    const validationError = validateMediaFile(file, kind);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    try {
      const media = await storeMediaFile(file, kind, true);
      setMediaFormValue(kind, media.path);
      setUploadedMedia((current) => [
        ...current.filter((item) => !(item.kind === kind && normalizedFileName(item.name) === normalizedFileName(file.name))),
        media,
      ]);
      setUploadedMediaSection(`${selectedExamId}:${selectedSectionId}`);
      if (kind === "audio") setSignedAudioUrls((current) => ({ ...current, [media.path]: media.signedUrl }));
      else setSignedImageUrls((current) => ({ ...current, [media.path]: media.signedUrl }));
      setNotice("Média téléversé dans le bucket privé. Enregistrez la question pour conserver le lien.");
    } catch (uploadError) {
      setError(`Envoi du média : ${uploadError instanceof Error ? uploadError.message : "erreur inconnue"}. Vérifiez la migration 019 et les droits Storage admin.`);
    } finally {
      setBusy(false);
    }
  }

  async function uploadMediaBatch(event: ChangeEvent<HTMLInputElement>, kind: StoredMediaFile["kind"]) {
    const target = event.currentTarget;
    const files = Array.from(target.files ?? []);
    target.value = "";
    if (!files.length || !selectedSection) return;
    clearMessages();
    const errors: string[] = [];
    const names = new Set<string>();
    for (const file of files) {
      const validationError = validateMediaFile(file, kind);
      if (validationError) errors.push(`${file.name} : ${validationError}`);
      const normalizedName = normalizedFileName(file.name);
      if (names.has(normalizedName)) errors.push(`${file.name} : nom présent plusieurs fois dans cette sélection.`);
      names.add(normalizedName);
    }
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }

    setBusy(true);
    let uploaded = 0;
    const batchErrors: string[] = [];
    try {
      for (const file of files) {
        try {
          const media = await storeMediaFile(file, kind, false);
          uploaded += 1;
          setUploadedMedia((current) => [...current.filter((item) => item.path !== media.path), media]);
          setUploadedMediaSection(`${selectedExamId}:${selectedSectionId}`);
          if (kind === "audio") setSignedAudioUrls((current) => ({ ...current, [media.path]: media.signedUrl }));
          else setSignedImageUrls((current) => ({ ...current, [media.path]: media.signedUrl }));
        } catch (uploadError) {
          batchErrors.push(`${file.name} : ${uploadError instanceof Error ? uploadError.message : "erreur inconnue"}`);
        }
      }
      if (uploaded) setNotice(`${uploaded} fichier(s) ${kind === "audio" ? "audio" : "image"} envoyé(s) dans le bucket privé.`);
      if (batchErrors.length) setError(`Échec d’envoi : ${batchErrors.join(" ; ")}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedSection) return;
    clearMessages();

    try {
      const text = await file.text();
      const rawRows: Record<string, unknown>[] = file.name.toLowerCase().endsWith(".json")
        ? (() => {
            const json: unknown = JSON.parse(text);
            // Accept either a bare array or an envelope { section, questions: [...] }
            const jsonArray: unknown = Array.isArray(json)
              ? json
              : json !== null && typeof json === "object" && Array.isArray((json as Record<string, unknown>).questions)
                ? (json as Record<string, unknown>).questions
                : null;
            if (!Array.isArray(jsonArray)) throw new Error("Le fichier JSON doit contenir un tableau ou un objet { section, questions: [...] }.");
            return jsonArray.map((row) => {
              if (typeof row !== "object" || row === null || Array.isArray(row)) {
                throw new Error("Chaque question JSON doit être un objet.");
              }
              return row as Record<string, unknown>;
            });
          })()
        : parseCsv(text);
      if (rawRows.length > 500) throw new Error("Un import est limité à 500 questions à la fois.");
      const parsedRows = rawRows.map(normalizeImportRow);
      if (selectedSection.kind !== "CO" && parsedRows.some((row) => row.duration_seconds !== null)) {
        throw new Error("Les durées par question sont réservées à la section CO.");
      }
      if (selectedSection.kind === "CO" && parsedRows.some((row) => !row.duration_seconds)) {
        throw new Error("Chaque question CO importée doit avoir une durée en secondes.");
      }
      const positions = new Set(parsedRows.map((row) => row.position));
      if (positions.size !== parsedRows.length) throw new Error("Le fichier contient des numéros de position dupliqués.");
      const storedFiles = await listSectionMedia(createAdminClient(), selectedExamId, selectedSection.id);
      const assetsByKindAndName = new Map(
        storedFiles.map((stored) => [`${stored.kind}:${normalizedFileName(stored.name)}`, stored.path]),
      );
      const missingFiles = new Set<string>();
      const references = new Map<string, number>();
      const rowsWithMedia = parsedRows.map((row) => {
        const audioKey = row.audio_file ? `audio:${normalizedFileName(row.audio_file)}` : "";
        const imageKey = row.image_file ? `image:${normalizedFileName(row.image_file)}` : "";
        if (row.audio_file) references.set(audioKey, (references.get(audioKey) ?? 0) + 1);
        if (row.image_file) references.set(imageKey, (references.get(imageKey) ?? 0) + 1);
        const resolvedAudioPath = row.audio_file ? assetsByKindAndName.get(audioKey) ?? null : null;
        const resolvedImagePath = row.image_file ? assetsByKindAndName.get(imageKey) ?? null : null;
        if (row.audio_file && !resolvedAudioPath) missingFiles.add(`audio_file : ${row.audio_file}`);
        if (row.image_file && !resolvedImagePath) missingFiles.add(`image_file : ${row.image_file}`);
        return { ...row, resolved_audio_path: resolvedAudioPath, resolved_image_path: resolvedImagePath };
      });
      const duplicateFiles = [...references.entries()]
        .filter(([, count]) => count > 1)
        .map(([key, count]) => `${key.slice(key.indexOf(":") + 1)} (${count} références)`);
      const questionsWithoutAudio = selectedSection.kind === "CO"
        ? rowsWithMedia.filter((row) => {
            const existing = sectionQuestions.find((question) => question.position === row.position);
            return !row.resolved_audio_path && !(!row.audio_file && (existing?.audio_path || existing?.media_url));
          }).map((row) => row.position)
        : [];
      setImportPreview({
        fileName: file.name,
        rows: rowsWithMedia,
        mode: "upsert",
        missingFiles: [...missingFiles],
        duplicateFiles,
        questionsWithoutAudio,
      });
    } catch (importError) {
      setError(`Lecture de l’import : ${importError instanceof Error ? importError.message : "fichier invalide"}`);
    }
  }

  async function confirmImport() {
    if (!importPreview || !selectedSection) return;
    clearMessages();
    if (importPreview.missingFiles.length) {
      setError("Import bloqué : envoyez les fichiers introuvables dans le bucket privé avant de confirmer.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createAdminClient();
      if (importPreview.mode === "passages") {
        const passages = importPreview.rows.map(({ position, passage }) => ({ position, passage }));
        const { data: updatedCount, error: importError } = await supabase.rpc("admin_update_question_passages", {
          p_section_id: selectedSection.id,
          p_passages: passages,
        });
        if (importError) throw importError;
        if (updatedCount !== passages.length) {
          throw new Error(`La base a confirmé ${updatedCount ?? 0} mise(s) à jour sur ${passages.length}.`);
        }
        setNotice(
          `${passages.length} passage(s) mis à jour depuis ${importPreview.fileName}. ` +
          "Les identifiants des questions sont conservés ; aucune question, tentative ou résultat n’a été supprimé.",
        );
      } else {
        const rows = importPreview.rows.map((row) => {
          const {
            audio_file,
            image_file,
            resolved_audio_path,
            resolved_image_path,
            ...question
          } = row;
          const existing = sectionQuestions.find((item) => item.position === row.position);
          const audioPath = audio_file
            ? resolved_audio_path ?? null
            : existing?.audio_path || existing?.media_url || null;
          const imagePath = image_file ? resolved_image_path ?? null : existing?.image_path ?? null;
          return {
            ...question,
            section_id: selectedSection.id,
            audio_path: audioPath,
            image_path: imagePath,
            media_url: audioPath,
          };
        });
        const { error: importError } = await supabase.from("questions").upsert(rows, { onConflict: "section_id,position" });
        if (importError) throw importError;
        setNotice(`${rows.length} question(s) ajoutée(s) ou mise(s) à jour par position depuis ${importPreview.fileName}.`);
      }
      setImportPreview(null);
      await loadContent();
    } catch (importError) {
      setError(`Import echoue - 0/${importPreview?.rows.length ?? 0} questions - Erreur : ${importError instanceof Error ? importError.message : "erreur inconnue"}. Verifiez la console Supabase.`);
    } finally {
      setBusy(false);
    }
  }

  function updateDrawRule(tier: number, field: "draw_count" | "points_per_question", value: number) {
    setDrawRules((current) => {
      const currentRule = current.find((rule) => rule.section_id === selectedSectionId && rule.tier === tier);
      const nextRule: SectionDrawRule = {
        section_id: selectedSectionId,
        tier,
        draw_count: field === "draw_count" ? value : currentRule?.draw_count ?? 0,
        points_per_question: field === "points_per_question" ? value : currentRule?.points_per_question ?? 1,
      };
      return [
        ...current.filter((rule) => !(rule.section_id === selectedSectionId && rule.tier === tier)),
        nextRule,
      ];
    });
  }

  async function saveDrawRules() {
    if (!selectedSection || expectedQuestionCount === null) return;
    clearMessages();
    const invalidTier = sectionRuleRows.find((rule, index) => (
      !Number.isInteger(rule.draw_count)
      || rule.draw_count < 0
      || rule.draw_count > availableByTier[index]
      || !Number.isFinite(rule.points_per_question)
      || rule.points_per_question < 0
    ));
    if (invalidTier) {
      setError(`Le niveau ${invalidTier.tier} doit tirer entre 0 et ${availableByTier[invalidTier.tier - 1]} question(s) prête(s), avec un nombre de points positif ou nul.`);
      return;
    }
    if (configuredQuestionCount !== expectedQuestionCount) {
      setError(`Le total à tirer doit être de ${expectedQuestionCount} questions (actuellement ${configuredQuestionCount}).`);
      return;
    }
    if (configuredMaximumScore <= 0) {
      setError("Le score maximum du tirage doit être supérieur à zéro.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createAdminClient();
      const { error: saveError } = await supabase
        .from("section_draw_rules")
        .upsert(sectionRuleRows, { onConflict: "section_id,tier" });
      if (saveError) throw saveError;
      setNotice(`Règles de tirage de l’épreuve ${selectedSection.kind} enregistrées.`);
      await loadContent();
    } catch (saveError) {
      setError(`Enregistrement des règles : ${saveError instanceof Error ? saveError.message : "erreur inconnue"}`);
    } finally {
      setBusy(false);
    }
  }

  async function assignQuestionTiers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSection) return;
    clearMessages();
    setBusy(true);
    try {
      const ranges = parseTierRanges(tierRangesText);
      const uncoveredQuestion = sectionQuestions.find((question) => (
        !ranges.some((range) => question.position >= range.start && question.position <= range.end)
      ));
      if (uncoveredQuestion) {
        throw new Error(`Les plages ne couvrent pas la question en position ${uncoveredQuestion.position}.`);
      }

      const supabase = createAdminClient();
      const { data: updatedCount, error: assignError } = await supabase.rpc("admin_assign_question_tiers", {
        p_section_id: selectedSection.id,
        p_ranges: ranges.map((range) => ({
          start_position: range.start,
          end_position: range.end,
          tier: range.tier,
        })),
      });
      if (assignError) throw assignError;
      setTierRangesOpen(false);
      setNotice(`${updatedCount ?? 0} question(s) classée(s) par niveau.`);
      await loadContent();
    } catch (assignError) {
      setError(`Attribution des niveaux : ${assignError instanceof Error ? assignError.message : "erreur inconnue"}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !exams.length) {
    return <p className="rounded-xl border border-slate-200 bg-white p-5 text-slate-700" role="status">Chargement du contenu depuis Supabase…</p>;
  }

  if (!supabaseConfigured) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900" role="status">
        Le panneau de contenu nécessite une URL Supabase et la variable NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY dans .env.local. Les données d’examen de démonstration ne sont pas utilisées ici.
      </p>
    );
  }

  return (
    <div className="space-y-7">
      {(error || notice) && (
        <div
          className={`rounded-xl border p-4 ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Examens</h2>
            <p className="mt-1 text-sm text-slate-600">Créez les épreuves, leur contenu, et choisissez quels examens sont publiés.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="secondary-btn" href="/templates/questions-template.csv" download>Télécharger le modèle CSV</a>
            <a className="secondary-btn" href="/templates/questions-template.json" download>Télécharger le modèle JSON</a>
            <button className="primary-btn" type="button" onClick={() => { clearMessages(); setExamEditor(null); }}>+ Nouvel examen</button>
          </div>
        </div>

        {exams.length === 0 ? (
          <p className="mt-6 rounded-xl bg-slate-50 p-5 text-slate-600">Aucun examen dans la base. Créez un examen pour commencer.</p>
        ) : (
          <div className="mt-6 grid gap-3">
            {exams.map((exam) => (
              <article key={exam.id} className={`rounded-xl border p-4 ${selectedExamId === exam.id ? "border-blue-400 bg-blue-50/30" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => { setSelectedExamId(exam.id); setSelectedSectionId(""); clearMessages(); }}
                  >
                    <span className="block font-semibold text-slate-900">{exam.title}</span>
                    <span className="mt-1 block text-sm text-slate-600">
                      {exam.exam_type} · {exam.is_free ? "Gratuit" : "Payant"} · {exam.status === "published" ? "Publié" : exam.status === "draft" ? "Brouillon" : "Archivé"} · {exam.sections.length} épreuve(s)
                    </span>
                  </button>
                  <div className="flex gap-2">
                    <button className="secondary-btn" type="button" onClick={() => { clearMessages(); setExamEditor(exam); }}>Modifier</button>
                    <button className="secondary-btn text-red-700" disabled={busy} type="button" onClick={() => void deleteExam(exam)}>Supprimer</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {selectedExam && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="section-label">Contenu de l’examen</p>
              <h2 className="text-2xl font-bold text-slate-900">{selectedExam.title}</h2>
            </div>
            <button className="primary-btn" type="button" onClick={() => { clearMessages(); setSectionEditor(null); }}>+ Ajouter une épreuve</button>
          </div>

          {selectedExam.sections.length === 0 ? (
            <p className="mt-5 text-slate-600">Ajoutez au moins une section à cet examen.</p>
          ) : (
            <div className="mt-5 space-y-3">
              {selectedExam.sections.map((section) => (
                <article key={section.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button type="button" className="text-left" onClick={() => { setSelectedSectionId(section.id); clearMessages(); }}>
                      <strong className="text-slate-900">{section.kind}</strong>
                      <span className="ml-2 text-sm text-slate-600">{formatDuration(section.duration_seconds)}</span>
                      <span className="ml-2 text-sm text-slate-500">
                        {section.kind === "EE" || section.kind === "EO"
                          ? `${prompts.filter((prompt) => prompt.section_id === section.id).length} consigne(s)`
                          : `${questions.filter((question) => question.section_id === section.id).length} question(s)`}
                      </span>
                    </button>
                    <div className="flex gap-2">
                      <button className="secondary-btn" type="button" onClick={() => { clearMessages(); setSectionEditor(section); }}>Modifier</button>
                      <button className="secondary-btn text-red-700" disabled={busy} type="button" onClick={() => void deleteSection(section)}>Supprimer</button>
                    </div>
                  </div>
                  {selectedSectionId === section.id && (
                    <div className="mt-5 border-t border-slate-200 pt-5">
                      {section.kind !== "EE" && section.kind !== "EO" && (
                        <section className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <h3 className="font-semibold text-slate-900">Médias privés de l’épreuve</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            MP3/WAV : 20 Mo maximum par fichier. PNG/JPG/WebP : 5 Mo maximum par fichier.
                            Les fichiers sont indexés par leur nom d’origine dans des buckets privés.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button className="secondary-btn" disabled={busy} type="button" onClick={() => audioBatchInput.current?.click()}>
                              Envoyer plusieurs fichiers audio
                            </button>
                            <button className="secondary-btn" disabled={busy} type="button" onClick={() => imageBatchInput.current?.click()}>
                              Envoyer plusieurs images
                            </button>
                            <input
                              accept=".mp3,.wav,audio/mpeg,audio/wav"
                              className="hidden"
                              multiple
                              onChange={(event) => void uploadMediaBatch(event, "audio")}
                              ref={audioBatchInput}
                              type="file"
                            />
                            <input
                              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                              className="hidden"
                              multiple
                              onChange={(event) => void uploadMediaBatch(event, "image")}
                              ref={imageBatchInput}
                              type="file"
                            />
                          </div>
                          <p className="mt-3 text-xs text-slate-600">
                            {uploadedMediaSection === `${selectedExamId}:${selectedSectionId}` ? uploadedMedia.length : 0} fichier(s) déjà envoyé(s) pour cette épreuve
                            {uploadedMediaSection === `${selectedExamId}:${selectedSectionId}` && uploadedMedia.length > 0 && ` : ${uploadedMedia.map((media) => media.name).join(", ")}`}
                          </p>
                        </section>
                      )}
                      {section.kind === "EE" || section.kind === "EO" ? (
                        <div>
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                              <h3 className="font-semibold text-slate-900">Consignes de production</h3>
                              <p className="text-sm text-slate-600">Ajoutez les sujets d’expression écrite ou orale.</p>
                            </div>
                            <button className="secondary-btn" type="button" onClick={() => { clearMessages(); setPromptEditor(null); }}>+ Ajouter une consigne</button>
                          </div>
                          {sectionPrompts.map((prompt) => (
                            <div key={prompt.id} className="mb-3 rounded-lg bg-slate-50 p-3">
                              <p className="whitespace-pre-wrap text-sm text-slate-800">{prompt.task_number}. {prompt.instructions}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {prompt.min_words !== null ? `${prompt.min_words} mots min.` : ""}
                                {prompt.max_words !== null ? ` · ${prompt.max_words} mots max.` : ""}
                                {prompt.prep_seconds !== null ? ` · ${prompt.prep_seconds} s préparation` : ""}
                                {prompt.speak_seconds !== null ? ` · ${prompt.speak_seconds} s expression` : ""}
                              </p>
                              <div className="mt-2 flex gap-2">
                                <button className="secondary-btn" type="button" onClick={() => { clearMessages(); setPromptEditor(prompt); }}>Modifier</button>
                                <button className="secondary-btn text-red-700" disabled={busy} type="button" onClick={() => void deletePrompt(prompt)}>Supprimer</button>
                              </div>
                            </div>
                          ))}
                          {promptEditor !== false && (
                            <form className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4" onSubmit={(event) => void handlePromptSave(event)}>
                              <label className="admin-field">Numéro de tâche
                                <input defaultValue={promptEditor?.task_number ?? sectionPrompts.length + 1} min="1" name="task_number" required type="number" />
                              </label>
                              <label className="admin-field">Consigne
                                <textarea defaultValue={promptEditor?.instructions ?? ""} minLength={1} name="instructions" required rows={4} />
                              </label>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="admin-field">Mots minimum<input defaultValue={promptEditor?.min_words ?? ""} min="0" name="min_words" type="number" /></label>
                                <label className="admin-field">Mots maximum<input defaultValue={promptEditor?.max_words ?? ""} min="0" name="max_words" type="number" /></label>
                                <label className="admin-field">Préparation (secondes)<input defaultValue={promptEditor?.prep_seconds ?? ""} min="0" name="prep_seconds" type="number" /></label>
                                <label className="admin-field">Expression (secondes)<input defaultValue={promptEditor?.speak_seconds ?? ""} min="0" name="speak_seconds" type="number" /></label>
                              </div>
                              <EditorActions busy={busy} onCancel={() => setPromptEditor(false)} />
                            </form>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h3 className="font-semibold text-slate-900">Banque de questions</h3>
                              <p className="text-sm text-slate-600">Quatre options par question ; la bonne réponse reste dans la base sécurisée.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="secondary-btn"
                                disabled={!sectionQuestions.length}
                                type="button"
                                onClick={() => {
                                  clearMessages();
                                  const lastPosition = Math.max(1, ...sectionQuestions.map((question) => question.position));
                                  setTierRangesText(section.kind === "CE"
                                    ? "1-4 → 1\n5-10 → 2\n11-19 → 3\n20-29 → 4\n30-35 → 5\n36-39 → 6"
                                    : `1-${lastPosition} → 1`);
                                  setTierRangesOpen(true);
                                }}
                              >
                                Définir les niveaux par plages de numéros
                              </button>
                              <button className="secondary-btn" type="button" onClick={() => importInput.current?.click()}>Importer CSV / JSON</button>
                              <button className="secondary-btn" type="button" onClick={() => { clearMessages(); setQuestionEditor(null); }}>+ Ajouter une question</button>
                            </div>
                          </div>
                          <input accept=".csv,.json,text/csv,application/json" className="hidden" onChange={(event) => void handleImportFile(event)} ref={importInput} type="file" />
                          {selectedSection && ["CO", "SL", "CE"].includes(selectedSection.kind) && (
                            <section className="mb-5 rounded-xl border border-slate-200 p-4" aria-labelledby="draw-rules-title">
                              <div className="mb-3">
                                <h4 id="draw-rules-title" className="font-semibold text-slate-900">Règles de tirage</h4>
                                <p className="text-sm text-slate-600">
                                  Seules les questions avec une bonne réponse renseignée sont disponibles. Le tirage requis est de {expectedQuestionCount} questions.
                                </p>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[560px] text-left text-sm">
                                  <thead>
                                    <tr className="border-b text-slate-600">
                                      <th className="p-2">Niveau</th>
                                      <th className="p-2">Questions disponibles</th>
                                      <th className="p-2">À tirer</th>
                                      <th className="p-2">Points par question</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sectionRuleRows.map((rule) => (
                                      <tr className="border-b last:border-0" key={rule.tier}>
                                        <th className="p-2 font-medium">Niveau {rule.tier}</th>
                                        <td className="p-2">{availableByTier[rule.tier - 1]}</td>
                                        <td className="p-2">
                                          <input
                                            aria-label={`Nombre à tirer au niveau ${rule.tier}`}
                                            className="w-24 rounded border border-slate-300 px-2 py-1"
                                            max={availableByTier[rule.tier - 1]}
                                            min="0"
                                            onChange={(event) => updateDrawRule(rule.tier, "draw_count", Number(event.target.value))}
                                            type="number"
                                            value={rule.draw_count}
                                          />
                                        </td>
                                        <td className="p-2">
                                          <input
                                            aria-label={`Points par question au niveau ${rule.tier}`}
                                            className="w-28 rounded border border-slate-300 px-2 py-1"
                                            min="0"
                                            onChange={(event) => updateDrawRule(rule.tier, "points_per_question", Number(event.target.value))}
                                            step="0.01"
                                            type="number"
                                            value={rule.points_per_question}
                                          />
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                                <p>
                                  Total tiré : <strong>{configuredQuestionCount}/{expectedQuestionCount}</strong>
                                  {" · "}Score maximum : <strong>{configuredMaximumScore}</strong>
                                </p>
                                <button className="primary-btn" disabled={busy} type="button" onClick={() => void saveDrawRules()}>
                                  Enregistrer les règles
                                </button>
                              </div>
                            </section>
                          )}
                          {sectionQuestions.map((question) => (
                            <div key={question.id} className="mb-3 rounded-lg bg-slate-50 p-3">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  {question.passage?.trim() ? (
                                    <div className="mb-3 rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-800 shadow-sm whitespace-pre-wrap">
                                      <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Document à lire :</p>
                                      {question.passage}
                                    </div>
                                  ) : null}
                                  <p className="font-medium text-slate-900">{question.position}. {question.prompt}</p>
                                  <ol className="mt-2 grid gap-x-5 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
                                    {question.options.map((option, index) => (
                                      <li key={`${question.id}-${index}`}><strong>{answerLetters[index]}.</strong> {option}{question.correct_option === answerLetters[index] ? " ✓" : ""}</li>
                                    ))}
                                  </ol>
                                  <p className="mt-2 text-xs text-slate-500">
                                    Niveau de tirage {question.tier} · {question.points} point(s) · {question.level || "Niveau CECRL non indiqué"}
                                    {question.duration_seconds ? ` · ${question.duration_seconds} s` : ""}
                                  </p>
                                  {question.explanation && <p className="mt-1 text-sm text-slate-600">Explication : {question.explanation}</p>}
                                  {(question.audio_path || question.media_url) && signedAudioUrls[question.audio_path || question.media_url || ""] && (
                                    <audio className="mt-2 max-w-full" controls src={signedAudioUrls[question.audio_path || question.media_url || ""]}>Votre navigateur ne prend pas en charge l’audio.</audio>
                                  )}
                                  {question.image_path && signedImageUrls[question.image_path] && (
                                    <img alt={`Illustration de la question ${question.position}`} className="mt-2 max-w-full" src={signedImageUrls[question.image_path]} />
                                  )}
                                </div>
                                <div className="flex gap-2">
                                  <button className="secondary-btn" type="button" onClick={() => { clearMessages(); setQuestionEditor(question); }}>Modifier</button>
                                  <button className="secondary-btn text-red-700" disabled={busy} type="button" onClick={() => void deleteQuestion(question)}>Supprimer</button>
                                </div>
                              </div>
                            </div>
                          ))}

                          {questionEditor !== false && (
                            <form className="grid gap-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4" onSubmit={(event) => void handleQuestionSave(event)}>
                              <div className="grid gap-3 sm:grid-cols-4">
                                <label className="admin-field">Position<input defaultValue={questionEditor?.position ?? sectionQuestions.length + 1} min="1" name="position" required type="number" /></label>
                                <label className="admin-field">Niveau de tirage (1–6)<input defaultValue={questionEditor?.tier ?? 1} max="6" min="1" name="tier" required type="number" /></label>
                                <label className="admin-field">Points<input defaultValue={questionEditor?.points ?? 1} min="0" name="points" required step="0.1" type="number" /></label>
                                <label className="admin-field">Niveau<input defaultValue={questionEditor?.level ?? ""} name="level" placeholder="A1, A2, B1…" /></label>
                              </div>
                              <label className="admin-field">Document / texte
                                <textarea defaultValue={questionEditor?.passage ?? ""} name="passage" placeholder="Texte, article, annonce, email ou document à lire (optionnel)" rows={5} />
                              </label>
                              <label className="admin-field">Énoncé<textarea defaultValue={questionEditor?.prompt ?? ""} minLength={1} name="prompt" required rows={3} /></label>
                              <div className="grid gap-3 sm:grid-cols-2">
                                {answerLetters.map((letter, index) => (
                                  <label key={letter} className="admin-field">Option {letter}
                                    <input defaultValue={questionEditor?.options[index] ?? ""} name={`option_${letter}`} required />
                                  </label>
                                ))}
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="admin-field">Bonne réponse
                                  <select defaultValue={questionEditor?.correct_option ?? "A"} name="correct_option">
                                    {answerLetters.map((letter) => <option key={letter} value={letter}>{letter}</option>)}
                                  </select>
                                </label>
                                {section.kind === "CO" && <label className="admin-field">Durée de la question (secondes)
                                  <input defaultValue={questionEditor?.duration_seconds ?? 45} min="1" name="duration_seconds" required type="number" />
                                </label>}
                              </div>
                              <label className="admin-field">Explication<textarea defaultValue={questionEditor?.explanation ?? ""} name="explanation" rows={2} /></label>
                              <div className="grid gap-4 sm:grid-cols-2">
                                <div className="grid content-start gap-2">
                                  <label className="admin-field">Chemin de l’audio privé
                                    <input defaultValue={questionEditor?.audio_path || questionEditor?.media_url || ""} name="audio_path" placeholder="Envoyez un MP3 ou WAV, ou entrez un chemin Storage" />
                                  </label>
                                  {(questionEditor?.audio_path || questionEditor?.media_url) && signedAudioUrls[questionEditor.audio_path || questionEditor.media_url || ""] && (
                                    <audio className="max-w-full" controls src={signedAudioUrls[questionEditor.audio_path || questionEditor.media_url || ""]}>Votre navigateur ne prend pas en charge l’audio.</audio>
                                  )}
                                  <button className="secondary-btn justify-self-start" disabled={busy} type="button" onClick={() => audioInput.current?.click()}>Remplacer le média</button>
                                  <input accept=".mp3,.wav,audio/mpeg,audio/wav" className="hidden" onChange={(event) => void uploadSingleMedia(event, "audio")} ref={audioInput} type="file" />
                                </div>
                                <div className="grid content-start gap-2">
                                  <label className="admin-field">Chemin de l’image privée
                                    <input defaultValue={questionEditor?.image_path ?? ""} name="image_path" placeholder="Envoyez une image PNG, JPG ou WebP" />
                                  </label>
                                  {questionEditor?.image_path && signedImageUrls[questionEditor.image_path] && (
                                    <img alt={`Aperçu de la question ${questionEditor.position}`} className="max-w-full" src={signedImageUrls[questionEditor.image_path]} />
                                  )}
                                  <button className="secondary-btn justify-self-start" disabled={busy} type="button" onClick={() => imageInput.current?.click()}>Remplacer le média</button>
                                  <input accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void uploadSingleMedia(event, "image")} ref={imageInput} type="file" />
                                </div>
                              </div>
                              <EditorActions busy={busy} onCancel={() => setQuestionEditor(false)} />
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {examEditor !== false && (
        <Modal title={examEditor ? "Modifier l’examen" : "Nouvel examen"} onClose={() => setExamEditor(false)}>
          <form className="grid gap-4" onSubmit={(event) => void handleExamSave(event)}>
            <label className="admin-field">Titre<input defaultValue={examEditor?.title ?? ""} name="title" required /></label>
            <label className="admin-field">Type
              <select defaultValue={examEditor?.exam_type ?? examTypes[0]} name="exam_type">
                {examTypes.map((type) => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label className="admin-field">Statut
              <select defaultValue={examEditor?.status ?? "draft"} name="status">
                <option value="draft">Brouillon</option>
                <option value="published">Publié</option>
                <option value="archived">Archivé</option>
              </select>
            </label>
            <label className="admin-field">Ordre d’affichage<input defaultValue={examEditor?.sort_order ?? 0} name="sort_order" type="number" /></label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input defaultChecked={examEditor?.is_free ?? false} name="is_free" type="checkbox" /> Examen gratuit
            </label>
            <EditorActions busy={busy} onCancel={() => setExamEditor(false)} />
          </form>
        </Modal>
      )}

      {sectionEditor !== false && selectedExam && (
        <Modal title={sectionEditor ? "Modifier l’épreuve" : "Ajouter une épreuve"} onClose={() => setSectionEditor(false)}>
          <form className="grid gap-4" onSubmit={(event) => void handleSectionSave(event)}>
            <label className="admin-field">Épreuve
              <select defaultValue={sectionEditor?.kind ?? ""} name="kind" required>
                <option disabled value="">Sélectionner</option>
                {sectionKinds.map((kind) => (
                  <option
                    key={kind}
                    disabled={selectedExam.sections.some((section) => section.kind === kind && section.id !== sectionEditor?.id)}
                    value={kind}
                  >
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">Durée de l’épreuve (minutes)
              <input defaultValue={sectionEditor ? sectionEditor.duration_seconds / 60 : 25} min="1" name="duration_minutes" required type="number" />
            </label>
            <EditorActions busy={busy} onCancel={() => setSectionEditor(false)} />
          </form>
        </Modal>
      )}

      {tierRangesOpen && selectedSection && (
        <Modal title="Définir les niveaux par plages de numéros" onClose={() => setTierRangesOpen(false)}>
          <form className="grid gap-4" onSubmit={(event) => void assignQuestionTiers(event)}>
            <p className="text-sm text-slate-600">
              Indiquez une plage de positions par ligne. Les plages doivent couvrir toutes les questions sans se chevaucher.
              Exemple : <code>1-4 → 1</code>.
            </p>
            <label className="admin-field">Plages de positions → niveau
              <textarea
                onChange={(event) => setTierRangesText(event.target.value)}
                required
                rows={7}
                value={tierRangesText}
              />
            </label>
            <EditorActions busy={busy} onCancel={() => setTierRangesOpen(false)} submitLabel="Appliquer les niveaux" />
          </form>
        </Modal>
      )}

      {importPreview && (
        <Modal title={`Confirmer l’import (${importPreview.rows.length} questions)`} onClose={() => setImportPreview(null)}>
          <p className="mb-4 text-sm text-slate-600">
            Fichier : {importPreview.fileName} · Section {selectedSection?.kind}. Vérifiez les positions avant de confirmer.
          </p>
          <label className="admin-field mb-4">
            Mode d’import
            <select
              onChange={(event) => {
                const mode = event.target.value as ImportMode;
                setImportPreview((current) => current ? { ...current, mode } : current);
              }}
              value={importPreview.mode}
            >
              <option value="upsert">Ajouter ou mettre à jour le contenu complet par position</option>
              <option value="passages">Mettre à jour uniquement les passages des positions existantes</option>
            </select>
          </label>
          {importPreview.mode === "passages" && (
            <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" role="note">
              Seul le champ « document / texte » sera modifié. Chaque position du fichier doit déjà exister dans cette section ;
              sinon l’import entier est refusé. Les identifiants des questions et les tentatives/résultats existants sont conservés.
            </p>
          )}
          {importPreview.mode === "upsert" && (
            <div className="mb-4 grid gap-2 text-sm">
              {importPreview.missingFiles.length > 0 && (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800" role="alert">
                  Fichiers introuvables — import désactivé : {importPreview.missingFiles.join(", ")}.
                </p>
              )}
              {importPreview.questionsWithoutAudio.length > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900" role="status">
                  Questions CO sans audio associé : {importPreview.questionsWithoutAudio.join(", ")}.
                </p>
              )}
              {importPreview.duplicateFiles.length > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900" role="status">
                  Noms de fichiers référencés plusieurs fois : {importPreview.duplicateFiles.join(", ")}.
                </p>
              )}
            </div>
          )}
          <div className="mb-5 max-h-72 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">#</th><th className="p-2">Niveau</th><th className="p-2">Audio</th><th className="p-2">Image</th><th className="p-2">Document / texte</th><th className="p-2">Énoncé</th><th className="p-2">Bonne réponse</th><th className="p-2">Points</th></tr></thead>
              <tbody>
                {importPreview.rows.slice(0, 50).map((row) => (
                  <tr className="border-t border-slate-100" key={row.position}>
                    <td className="p-2">{row.position}</td>
                    <td className="p-2">{row.tier}</td>
                    <td className="max-w-36 truncate p-2 text-xs">{row.audio_file || <span className="text-slate-400 italic">—</span>}</td>
                    <td className="max-w-36 truncate p-2 text-xs">{row.image_file || <span className="text-slate-400 italic">—</span>}</td>
                    <td className="max-w-64 truncate p-2 text-xs text-slate-600">{row.passage || <span className="text-slate-400 italic">—</span>}</td>
                    <td className="max-w-80 truncate p-2">{row.prompt}</td>
                    <td className="p-2">{row.correct_option}</td>
                    <td className="p-2">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {importPreview.rows.length > 50 && <p className="p-2 text-xs text-slate-500">Aperçu limité aux 50 premières lignes.</p>}
          </div>
          <EditorActions
            busy={busy}
            onCancel={() => setImportPreview(null)}
            submitLabel={importPreview.mode === "passages" ? "Mettre à jour les passages" : "Importer les questions"}
            submitDisabled={importPreview.mode === "upsert" && importPreview.missingFiles.length > 0}
            onSubmit={() => void confirmImport()}
          />
        </Modal>
      )}

      {loading && exams.length > 0 && <p className="text-sm text-slate-500" role="status">Actualisation du contenu…</p>}
    </div>
  );
}

function EditorActions({
  busy,
  onCancel,
  submitLabel = "Enregistrer",
  onSubmit,
  submitDisabled = false,
}: {
  busy: boolean;
  onCancel: () => void;
  submitLabel?: string;
  onSubmit?: () => void;
  submitDisabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button className="secondary-btn" disabled={busy} type="button" onClick={onCancel}>Annuler</button>
      {onSubmit
        ? <button className="primary-btn" disabled={busy || submitDisabled} type="button" onClick={onSubmit}>{busy ? "En cours…" : submitLabel}</button>
        : <button className="primary-btn" disabled={busy} type="submit">{busy ? "Enregistrement…" : submitLabel}</button>}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="admin-modal-title" aria-modal="true" className="admin-modal" role="dialog">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-slate-900" id="admin-modal-title">{title}</h2>
          <button aria-label="Fermer" className="secondary-btn" type="button" onClick={onClose}>×</button>
        </div>
        {children}
      </section>
    </div>
  );
}
