import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

const paramsSchema = z.object({ examId: z.string().uuid() });

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Les examens nécessitent une connexion à Supabase." }, { status: 503 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Identifiant d’examen invalide." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error: authError } = await supabase.auth.getUser();
  if (authError && authError.name !== "AuthSessionMissingError") {
    console.error("Unable to verify exam starter:", authError.message);
    return NextResponse.json({ error: "La session n’a pas pu être vérifiée." }, { status: 401 });
  }

  const { data: attemptId, error: startError } = await supabase.rpc("start_exam", {
    p_exam_id: parsedParams.data.examId,
  });
  if (startError) {
    console.error("Unable to start exam:", startError.message);
    const status = startError.code === "42501" ? 403 : startError.code === "P0002" ? 404 : 400;
    return NextResponse.json({ error: startError.message }, { status });
  }
  if (typeof attemptId !== "string") {
    console.error("Exam start returned an invalid attempt identifier.");
    return NextResponse.json({ error: "La tentative d’examen n’a pas pu être créée." }, { status: 500 });
  }

  return NextResponse.json({ attemptId }, { status: 201 });
}
