import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

const paramsSchema = z.object({ examId: z.string().uuid() });
const answerSchema = z.object({
  attemptId: z.string().uuid(),
  questionId: z.string().uuid(),
  selectedOption: z.enum(["A", "B", "C", "D"]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Les examens nécessitent une connexion à Supabase." }, { status: 503 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Identifiant d’examen invalide." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }
  const parsedAnswer = answerSchema.safeParse(payload);
  if (!parsedAnswer.success) {
    return NextResponse.json({ error: "Format de réponse invalide." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_exam_answer", {
    p_exam_id: parsedParams.data.examId,
    p_attempt_id: parsedAnswer.data.attemptId,
    p_question_id: parsedAnswer.data.questionId,
    p_selected_option: parsedAnswer.data.selectedOption,
  });
  if (error) {
    console.error("Unable to save exam answer:", error.message);
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "private, no-store" } });
}
