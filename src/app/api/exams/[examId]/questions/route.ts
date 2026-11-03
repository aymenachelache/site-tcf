import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

const paramsSchema = z.object({
  examId: z.string().uuid(),
  attemptId: z.string().uuid(),
});
const questionIdSchema = z.string().uuid();
const audioBucket = "tcf-exam-audio";
const imageBucket = "tcf-exam-images";
const signedUrlLifetimeSeconds = 300;

type AttemptQuestion = Record<string, unknown> & {
  id: string;
  audioPath?: string | null;
  imagePath?: string | null;
  mediaUrl?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serviceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Les examens nécessitent une connexion à Supabase." }, { status: 503 });
  }

  const parsedParams = paramsSchema.safeParse({
    ...(await params),
    attemptId: request.nextUrl.searchParams.get("attempt"),
  });
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Identifiant d’examen ou de tentative invalide." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_exam_attempt", {
    p_exam_id: parsedParams.data.examId,
    p_attempt_id: parsedParams.data.attemptId,
  });
  if (error) {
    console.error("Unable to load exam attempt:", error.message);
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  if (!isRecord(data) || !Array.isArray(data.questions)) {
    console.error("Exam attempt returned an invalid question payload.");
    return NextResponse.json({ error: "Les questions de cette tentative n’ont pas pu être chargées." }, { status: 500 });
  }

  const questions = data.questions as AttemptQuestion[];
  const requestedQuestionId = request.nextUrl.searchParams.get("questionId");
  if (requestedQuestionId !== null) {
    const parsedQuestionId = questionIdSchema.safeParse(requestedQuestionId);
    if (!parsedQuestionId.success) {
      return NextResponse.json({ error: "Identifiant de question invalide." }, { status: 400 });
    }
    const question = questions.find((item) => item.id === parsedQuestionId.data);
    if (!question) {
      return NextResponse.json({ error: "Cette question ne fait pas partie de cette tentative." }, { status: 404 });
    }

    const audioPath = typeof question.audioPath === "string" ? question.audioPath
      : typeof question.mediaUrl === "string" ? question.mediaUrl
        : null;
    const imagePath = typeof question.imagePath === "string" ? question.imagePath : null;
    if (!audioPath && !imagePath) {
      return NextResponse.json({ audioUrl: null, imageUrl: null }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const storage = serviceRoleClient();
    if (!storage) {
      console.error("Exam media signing is not configured: Supabase service credentials are missing.");
      return NextResponse.json({ error: "La signature des médias d’examen n’est pas configurée." }, { status: 503 });
    }
    const [audioResult, imageResult] = await Promise.all([
      audioPath ? storage.storage.from(audioBucket).createSignedUrl(audioPath, signedUrlLifetimeSeconds) : null,
      imagePath ? storage.storage.from(imageBucket).createSignedUrl(imagePath, signedUrlLifetimeSeconds) : null,
    ]);
    if (audioResult?.error || imageResult?.error) {
      console.error("Unable to sign exam question media:", audioResult?.error?.message ?? imageResult?.error?.message);
      return NextResponse.json({ error: "Les médias de cette question n’ont pas pu être chargés." }, { status: 500 });
    }
    return NextResponse.json({
      audioUrl: audioResult?.data.signedUrl ?? null,
      imageUrl: imageResult?.data.signedUrl ?? null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const safeQuestions = questions.map((question) => {
    const audioPath = typeof question.audioPath === "string" ? question.audioPath
      : typeof question.mediaUrl === "string" ? question.mediaUrl
        : null;
    const imagePath = typeof question.imagePath === "string" ? question.imagePath : null;
    const safeQuestion = { ...question };
    delete safeQuestion.audioPath;
    delete safeQuestion.imagePath;
    delete safeQuestion.mediaUrl;
    return {
      ...safeQuestion,
      hasAudio: Boolean(audioPath),
      hasImage: Boolean(imagePath),
    };
  });

  return NextResponse.json({ ...data, questions: safeQuestions }, { headers: { "Cache-Control": "private, no-store" } });
}
