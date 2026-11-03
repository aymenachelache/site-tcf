import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sendTransactionalEmail } from "@/lib/transactional-email";
import { createClient } from "@/utils/supabase/server";

const requestSchema = z.object({ planId: z.string().uuid() });
const referenceAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function createReference(): string {
  const bytes = randomBytes(4);
  const code = Array.from(bytes, (byte) => referenceAlphabet[byte % referenceAlphabet.length]).join("");
  return `TCF-${code}`;
}

async function findPendingPayment(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, planId: string) {
  const { data: payment, error } = await supabase
    .from("payment_requests")
    .select("id, reference")
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .eq("status", "pending")
    .maybeSingle();

  if (error) {
    console.error("Unable to find existing pending payment request:", error.message);
    throw new Error("La demande de paiement existante n’a pas pu être vérifiée.");
  }
  return payment;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Le paiement nécessite une connexion à Supabase." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.error("Unable to verify payment request user:", authError.message);
    return NextResponse.json({ error: "La session n’a pas pu être vérifiée." }, { status: 401 });
  }
  if (!user?.email) {
    return NextResponse.json({ error: "Connectez-vous avec une adresse email vérifiée avant d’acheter." }, { status: 401 });
  }
  if (!user.email_confirmed_at) {
    return NextResponse.json({ error: "Confirmez votre email avant d’acheter." }, { status: 403 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("suspended")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Unable to verify payment requester profile:", profileError.message);
    return NextResponse.json({ error: "Le profil n’a pas pu être vérifié." }, { status: 500 });
  }
  if (!profile || profile.suspended) {
    return NextResponse.json({ error: "Ce compte ne peut pas effectuer d’achat." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Forfait invalide." }, { status: 400 });
  }

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id, name, price_dzd, exam_ids, exam_credits, active")
    .eq("id", parsed.data.planId)
    .eq("active", true)
    .maybeSingle();
  if (planError) {
    console.error("Unable to load payment plan:", planError.message);
    return NextResponse.json({ error: "Le forfait n’a pas pu être vérifié." }, { status: 500 });
  }
  if (!plan) {
    return NextResponse.json({ error: "Ce forfait n’est plus disponible." }, { status: 404 });
  }
  if (plan.price_dzd < 1) {
    return NextResponse.json({ error: "Ce forfait est gratuit ; aucun paiement manuel n’est nécessaire." }, { status: 400 });
  }
  if (!plan.exam_ids.length && !(plan.exam_credits && plan.exam_credits > 0)) {
    return NextResponse.json({ error: "Ce forfait n’ouvre aucun examen et ne contient aucun crédit." }, { status: 400 });
  }

  try {
    const pendingPayment = await findPendingPayment(supabase, user.id, plan.id);
    if (pendingPayment) return NextResponse.json(pendingPayment);
  } catch (lookupError) {
    return NextResponse.json({
      error: lookupError instanceof Error ? lookupError.message : "La demande existante n’a pas pu être vérifiée.",
    }, { status: 500 });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reference = createReference();
    const { data: payment, error: insertError } = await supabase
      .from("payment_requests")
      .insert({
        user_id: user.id,
        email: user.email.trim().toLowerCase(),
        plan_id: plan.id,
        amount_dzd: plan.price_dzd,
        reference,
      })
      .select("id, reference")
      .single();

    if (!insertError) {
      const paymentUrl = new URL(`/paiement/${payment.id}`, request.nextUrl.origin).toString();
      const whatsappNumber = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
      const whatsappMessage = `Bonjour, je veux activer le pack ${plan.name}. Mon email : ${user.email}. Référence : ${reference}. Je joins mon reçu BaridiMob.`;
      const whatsappUrl = whatsappNumber.length >= 8 && whatsappNumber.length <= 15
        ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`
        : null;
      const emailMessages = [
        sendTransactionalEmail({
          kind: "payment-requested",
          to: user.email,
          planName: plan.name,
          reference,
          amountDzd: plan.price_dzd,
          paymentUrl,
          whatsappUrl,
          baridimobRip: process.env.NEXT_PUBLIC_BARIDIMOB_RIP?.trim() ?? "",
          accountName: process.env.NEXT_PUBLIC_BARIDIMOB_ACCOUNT_NAME?.trim() ?? "",
        }),
      ];
      const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL?.trim();
      if (adminEmail) {
        emailMessages.push(sendTransactionalEmail({
          kind: "payment-request-admin",
          to: adminEmail,
          customerEmail: user.email,
          planName: plan.name,
          reference,
          amountDzd: plan.price_dzd,
          paymentUrl,
          whatsappUrl,
        }));
      } else {
        console.error("New payment request admin email was not sent: ADMIN_NOTIFICATION_EMAIL is not configured.");
      }
      await Promise.all(emailMessages);
      return NextResponse.json(payment, { status: 201 });
    }
    if (insertError.code === "23505") {
      try {
        const pendingPayment = await findPendingPayment(supabase, user.id, plan.id);
        if (pendingPayment) return NextResponse.json(pendingPayment);
      } catch (lookupError) {
        return NextResponse.json({
          error: lookupError instanceof Error ? lookupError.message : "La demande existante n’a pas pu être vérifiée.",
        }, { status: 500 });
      }
      if (attempt < 2) continue;
    }
    console.error("Unable to create payment request:", insertError.message);
    return NextResponse.json({ error: "La demande de paiement n’a pas pu être créée." }, { status: 400 });
  }

  return NextResponse.json({ error: "Impossible de générer une référence unique. Réessayez." }, { status: 503 });
}
