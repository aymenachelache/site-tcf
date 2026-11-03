import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/lib/admin-auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sendTransactionalEmail } from "@/lib/transactional-email";

type PaymentNotificationAction = "approve" | "reject";

async function sendPaymentNotification(
  supabase: Awaited<ReturnType<typeof getAdminContext>>["supabase"],
  requestId: string,
  action: PaymentNotificationAction,
  note?: string,
): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !sender) {
    console.error("Payment notification was not sent: RESEND_API_KEY or RESEND_FROM_EMAIL is missing.");
    return "Action enregistrée, mais l’email n’a pas été envoyé : configurez RESEND_API_KEY et RESEND_FROM_EMAIL.";
  }

  const { data: payment, error: paymentError } = await supabase
    .from("payment_requests")
    .select("email, reference, amount_dzd, plan_id")
    .eq("id", requestId)
    .maybeSingle();
  if (paymentError || !payment) {
    console.error("Unable to load payment notification details:", paymentError?.message ?? "Payment request not found.");
    return "Action enregistrée, mais les informations de notification email n’ont pas pu être chargées.";
  }

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("name")
    .eq("id", payment.plan_id)
    .maybeSingle();
  if (planError) {
    console.error("Unable to load payment notification plan:", planError.message);
    return "Action enregistrée, mais le nom du forfait n’a pas pu être chargé pour l’email.";
  }

  const isApproved = action === "approve";
  const message = isApproved
    ? `Votre paiement pour le forfait ${plan?.name ?? "TCF"} (référence ${payment.reference}) a été vérifié. Votre accès est activé.`
    : `Votre demande pour le forfait ${plan?.name ?? "TCF"} (référence ${payment.reference}) a été refusée.${note ? ` Motif : ${note}` : ""}`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender,
        to: [payment.email],
        subject: isApproved ? "Votre accès TCF est activé" : "Mise à jour de votre demande TCF",
        text: `${message}\n\nMontant : ${new Intl.NumberFormat("fr-DZ").format(payment.amount_dzd)} DA.`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Resend rejected payment notification:", response.status, errorText);
      return "Action enregistrée, mais l’email de notification n’a pas pu être envoyé.";
    }
    return null;
  } catch (error) {
    console.error("Unable to send payment notification:", error);
    return "Action enregistrée, mais l’email de notification n’a pas pu être envoyé.";
  }
}

async function sendActivatedPaymentNotification(
  supabase: Awaited<ReturnType<typeof getAdminContext>>["supabase"],
  requestId: string,
  entitlementId: string | null,
): Promise<string | null> {
  if (!entitlementId) {
    console.error("Payment was approved but its entitlement ID was not returned.");
    return "Paiement activé, mais les informations de l’accès n’ont pas pu être chargées pour l’email.";
  }

  const { data: payment, error: paymentError } = await supabase
    .from("payment_requests")
    .select("email, reference, amount_dzd, plan_id")
    .eq("id", requestId)
    .maybeSingle();
  if (paymentError || !payment) {
    console.error("Unable to load payment activation email details:", paymentError?.message ?? "Payment request not found.");
    return "Paiement activé, mais les informations de notification n’ont pas pu être chargées.";
  }

  const [{ data: plan, error: planError }, { data: entitlement, error: entitlementError }] = await Promise.all([
    supabase.from("plans").select("name").eq("id", payment.plan_id).maybeSingle(),
    supabase.from("entitlements").select("credits_remaining, exam_ids, expires_at").eq("id", entitlementId).maybeSingle(),
  ]);
  if (planError || entitlementError || !plan || !entitlement) {
    console.error(
      "Unable to load payment activation details:",
      planError?.message ?? entitlementError?.message ?? "Plan or entitlement not found.",
    );
    return "Paiement activé, mais les informations de l’accès n’ont pas pu être chargées pour l’email.";
  }

  const outcome = await sendTransactionalEmail({
    kind: "access-activated",
    to: payment.email,
    planName: plan.name,
    reference: payment.reference,
    amountDzd: payment.amount_dzd,
    creditsRemaining: entitlement.credits_remaining,
    includedExamCount: entitlement.exam_ids.length,
    expiresAt: entitlement.expires_at,
  });
  return outcome.sent ? null : "Action enregistrée, mais l’email de notification n’a pas pu être envoyé.";
}

const actionSchema = z.object({
  action: z.enum(["approve", "reject", "grant", "revoke", "extend"]),
  requestId: z.string().uuid().optional(),
  entitlementId: z.string().uuid().optional(),
  receiptRef: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
  email: z.string().trim().email().max(320).optional(),
  planId: z.string().uuid().optional(),
  days: z.number().int().min(1).max(3650).optional(),
});

function paymentDashboardError(
  section: "demandes" | "offres" | "accès",
  error: { code?: string; message: string },
): string {
  const detail = `${error.code ? `[${error.code}] ` : ""}${error.message}`;
  if (section === "accès" && (error.code === "PGRST202" || error.code === "42883")) {
    return `La fonction Supabase admin_list_entitlements() est introuvable. Exécutez supabase/migrations/006_manual_payments_and_exam_access.sql dans le SQL Editor. Détail : ${detail}`;
  }
  if (section === "offres" && (error.code === "42703" || error.code === "PGRST204" || error.code === "PGRST200")) {
    return `Les colonnes d’offres attendues sont absentes. Exécutez supabase/migrations/007_plan_presentation_fields.sql dans le SQL Editor. Détail : ${detail}`;
  }
  if (error.code === "42501") {
    return `Supabase refuse l’accès aux ${section}. Vérifiez que les migrations 001, 006 et 007 ont été exécutées et que votre profil possède le rôle admin. Détail : ${detail}`;
  }
  return `Chargement des ${section} impossible. Détail Supabase : ${detail}`;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n’est pas configuré." }, { status: 503 });
  }
  const context = await getAdminContext();
  if (context.error) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const email = request.nextUrl.searchParams.get("email")?.trim() ?? "";
  let paymentQuery = context.supabase
    .from("payment_requests")
    .select("id, user_id, email, plan_id, amount_dzd, reference, status, receipt_ref, admin_note, created_at, processed_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (email) paymentQuery = paymentQuery.ilike("email", `%${email}%`);

  const [
    { data: payments, error: paymentError },
    { data: plans, error: planError },
    { data: entitlements, error: entitlementError },
    { data: auditLog, error: auditLogError },
  ] =
    await Promise.all([
      paymentQuery,
      context.supabase.from("plans").select("id, name, price_dzd, exam_ids, exam_credits, access_days, active").order("sort_order"),
      context.supabase.rpc("admin_list_entitlements"),
      context.supabase.rpc("admin_list_payment_audit"),
    ]);

  if (paymentError) {
    console.error("Unable to load admin payment requests:", paymentError.code, paymentError.message);
    return NextResponse.json({ error: paymentDashboardError("demandes", paymentError) }, { status: 500 });
  }
  if (planError) {
    console.error("Unable to load admin payment plans:", planError.code, planError.message);
    return NextResponse.json({ error: paymentDashboardError("offres", planError) }, { status: 500 });
  }
  if (entitlementError) {
    console.error("Unable to load admin entitlements:", entitlementError.code, entitlementError.message);
    return NextResponse.json({ error: paymentDashboardError("accès", entitlementError) }, { status: 500 });
  }
  const entitlementRows = (entitlements ?? []) as Array<{ email: string | null }>;
  const filteredEntitlements = email
    ? entitlementRows.filter((entitlement) =>
        entitlement.email?.toLowerCase().includes(email.toLowerCase()))
    : entitlementRows;
  if (auditLogError) {
    console.error("Unable to load payment audit log:", auditLogError.code, auditLogError.message);
    return NextResponse.json({
      error: auditLogError.code === "PGRST202" || auditLogError.code === "42883"
        ? "Le journal d’audit des paiements manque dans Supabase. Exécutez la migration 015_payment_audit_and_exam_entitlement_access.sql."
        : `Chargement du journal d’audit impossible : ${auditLogError.message}`,
    }, { status: 500 });
  }

  return NextResponse.json({ payments, plans, entitlements: filteredEntitlements, auditLog });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n’est pas configuré." }, { status: 503 });
  }
  const context = await getAdminContext();
  if (context.error) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Les données de l’action sont invalides." }, { status: 400 });
  }

  const input = parsed.data;
  let rpcName: string;
  let rpcArgs: Record<string, string | number | null>;

  switch (input.action) {
    case "approve":
    case "reject":
      if (!input.requestId) return NextResponse.json({ error: "Demande de paiement manquante." }, { status: 400 });
      if (input.action === "approve" && !input.receiptRef) {
        return NextResponse.json({ error: "Le numéro de transaction est obligatoire." }, { status: 400 });
      }
      if (input.action === "reject" && !input.note) {
        return NextResponse.json({ error: "Le motif du refus est obligatoire." }, { status: 400 });
      }
      rpcName = "admin_process_payment";
      rpcArgs = {
        p_request_id: input.requestId,
        p_action: input.action,
        p_receipt_ref: input.receiptRef ?? null,
        p_note: input.note ?? null,
      };
      break;
    case "grant":
      if (!input.email || !input.planId) {
        return NextResponse.json({ error: "Email et forfait sont obligatoires pour une activation directe." }, { status: 400 });
      }
      rpcName = "admin_grant_access";
      rpcArgs = { p_email: input.email.toLowerCase(), p_plan_id: input.planId };
      break;
    case "revoke":
    case "extend":
      if (!input.entitlementId) return NextResponse.json({ error: "Accès manquant." }, { status: 400 });
      if (input.action === "extend" && !input.days) {
        return NextResponse.json({ error: "Le nombre de jours est obligatoire." }, { status: 400 });
      }
      rpcName = "admin_adjust_entitlement";
      rpcArgs = {
        p_entitlement_id: input.entitlementId,
        p_action: input.action,
        p_days: input.days ?? null,
        p_note: input.note ?? null,
      };
      break;
  }

  const { data, error } = await context.supabase.rpc(rpcName, rpcArgs);
  if (error) {
    console.error(`Admin payment action ${input.action} failed:`, error.message);
    const uniqueErrorDetails = [error.message, error.details, error.hint].filter(Boolean).join(" ");
    if (
      input.action === "approve"
      && error.code === "23505"
      && (uniqueErrorDetails.includes("payment_requests_receipt_ref_unique") || uniqueErrorDetails.includes("receipt_ref"))
    ) {
      return NextResponse.json({
        error: "Ce numéro de transaction a déjà été utilisé pour une autre demande.",
      }, { status: 409 });
    }
    const status = error.code === "42501" ? 403 : error.code === "23505" ? 409 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  let notificationWarning: string | null = null;
  try {
    if (input.action === "approve" && input.requestId) {
      notificationWarning = await sendActivatedPaymentNotification(
        context.supabase,
        input.requestId,
        typeof data === "string" ? data : null,
      );
    } else if (input.action === "reject" && input.requestId) {
      notificationWarning = await sendPaymentNotification(context.supabase, input.requestId, input.action, input.note);
    } else if (input.action === "grant" && input.email && input.planId) {
      const [{ data: plan, error: planError }, { data: entitlement, error: entitlementError }] = await Promise.all([
        context.supabase.from("plans").select("name").eq("id", input.planId).maybeSingle(),
        context.supabase
          .from("entitlements")
          .select("credits_remaining, exam_ids, expires_at")
          .eq("id", typeof data === "string" ? data : "")
          .maybeSingle(),
      ]);
      if (planError || entitlementError || !plan || !entitlement) {
        console.error(
          "Unable to load manual access email details:",
          planError?.message ?? entitlementError?.message ?? "Plan or entitlement not found.",
        );
        notificationWarning = "Accès enregistré, mais les informations de l’email n’ont pas pu être chargées.";
      } else {
        const emailResult = await sendTransactionalEmail({
          kind: "access-activated",
          to: input.email,
          planName: plan.name,
          creditsRemaining: entitlement.credits_remaining,
          includedExamCount: entitlement.exam_ids.length,
          expiresAt: entitlement.expires_at,
        });
        if (!emailResult.sent) notificationWarning = "Accès enregistré, mais l’email de notification n’a pas pu être envoyé.";
      }
    }
  } catch (notificationError) {
    console.error("Admin payment action succeeded but notification processing failed:", notificationError);
    notificationWarning = "Action enregistrée, mais l’email de notification n’a pas pu être envoyé.";
  }

  return NextResponse.json({ ok: true, id: data, warning: notificationWarning });
}
