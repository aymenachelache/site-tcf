import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n’est pas configuré." }, { status: 503 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Identifiant de paiement invalide." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    if (authError.name === "AuthSessionMissingError") {
      return NextResponse.json({ error: "Connectez-vous pour annuler cette demande." }, { status: 401 });
    }
    console.error("Unable to verify payment cancellation user:", authError.message);
    return NextResponse.json({ error: "La session n’a pas pu être vérifiée." }, { status: 401 });
  }
  if (!authData.user) {
    return NextResponse.json({ error: "Connectez-vous pour annuler cette demande." }, { status: 401 });
  }

  const { data: paymentId, error: updateError } = await supabase.rpc("cancel_payment_request", {
    p_request_id: parsedParams.data.id,
  });

  if (updateError?.code === "P0002") {
    return NextResponse.json({
      error: "Cette demande est introuvable, ne vous appartient pas ou n’est plus en attente.",
    }, { status: 409 });
  }
  if (updateError) {
    console.error("Unable to cancel payment request:", updateError.code, updateError.message);
    if (updateError.code === "PGRST202" || updateError.code === "42883") {
      return NextResponse.json({
        error: "La fonction d’annulation manque dans Supabase. Exécutez la migration 010_cancel_own_pending_payment.sql dans le SQL Editor.",
      }, { status: 503 });
    }
    return NextResponse.json({
      error: `La demande n’a pas pu être annulée. Erreur Supabase [${updateError.code}]: ${updateError.message}`,
    }, { status: 400 });
  }
  if (!paymentId) {
    return NextResponse.json({
      error: "Cette demande est introuvable, ne vous appartient pas ou n’est plus en attente.",
    }, { status: 409 });
  }

  return NextResponse.json({ ok: true, id: paymentId });
}
