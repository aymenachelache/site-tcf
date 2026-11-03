import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

const paramsSchema = z.object({ examId: z.string().uuid() });
const submissionSchema = z.object({ attemptId: z.string().uuid() });

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
  const parsedSubmission = submissionSchema.safeParse(payload);
  if (!parsedSubmission.success) {
    return NextResponse.json({ error: "Format de soumission invalide." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_exam", {
    p_exam_id: parsedParams.data.examId,
    p_attempt_id: parsedSubmission.data.attemptId,
  });
  if (error) {
    console.error("Unable to submit exam:", error.message);
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  if (!data || typeof data !== "object") {
    console.error("Exam submission returned an invalid results payload.");
    return NextResponse.json({ error: "Les résultats n’ont pas pu être calculés." }, { status: 500 });
  }

  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
