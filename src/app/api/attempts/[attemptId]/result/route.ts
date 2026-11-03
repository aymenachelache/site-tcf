import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

const paramsSchema = z.object({ attemptId: z.string().uuid() });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Les résultats nécessitent une connexion à Supabase." }, { status: 503 });
  }

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Identifiant de tentative invalide." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    if (authError) console.error("Unable to verify result owner:", authError.message);
    return NextResponse.json({ error: "Connectez-vous pour consulter ce résultat." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("get_submitted_attempt_result", {
    p_attempt_id: parsed.data.attemptId,
  });
  if (error) {
    console.error("Unable to load submitted attempt result:", error.code, error.message);
    const status = error.code === "42501" ? 404 : error.code === "PGRST202" || error.code === "42883" ? 503 : 500;
    return NextResponse.json({
      error: status === 404
        ? "Ce résultat n’existe pas ou la simulation n’a pas encore été soumise."
        : status === 503
          ? "La migration 016_dashboard_analytics_and_notifications.sql doit être appliquée."
          : "Le résultat détaillé n’a pas pu être chargé.",
    }, { status });
  }

  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
