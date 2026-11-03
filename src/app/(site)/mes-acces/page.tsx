import Link from "next/link";
import { redirect } from "next/navigation";
import { CancelPaymentButton } from "@/components/cancel-payment-button";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

export const instant = false;

type PaymentRow = {
  id: string;
  plan_id: string;
  amount_dzd: number;
  reference: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  admin_note: string | null;
  created_at: string;
};

type EntitlementRow = {
  id: string;
  plan_id: string | null;
  exam_ids: string[];
  credits_remaining: number | null;
  starts_at: string;
  expires_at: string | null;
  revoked: boolean;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default async function MyAccessPage() {
  if (!isSupabaseConfigured()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    console.error("Unable to verify payment history user:", authError.message);
    redirect("/login");
  }
  if (!user) redirect("/login");

  const [paymentResponse, entitlementResponse] = await Promise.all([
    supabase
      .from("payment_requests")
      .select("id, plan_id, amount_dzd, reference, status, admin_note, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("entitlements")
      .select("id, plan_id, exam_ids, credits_remaining, starts_at, expires_at, revoked")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);
  if (paymentResponse.error || entitlementResponse.error) {
    const error = paymentResponse.error ?? entitlementResponse.error;
    console.error("Unable to load payment and access history:", error?.message);
    throw new Error("L’historique des paiements et accès n’a pas pu être chargé.");
  }

  const payments = (paymentResponse.data ?? []) as PaymentRow[];
  const entitlements = (entitlementResponse.data ?? []) as EntitlementRow[];
  const planIds = [...new Set([
    ...payments.map((payment) => payment.plan_id),
    ...entitlements.flatMap((entitlement) => entitlement.plan_id ? [entitlement.plan_id] : []),
  ])];
  const examIds = [...new Set(entitlements.flatMap((entitlement) => entitlement.exam_ids))];
  const [{ data: plans, error: plansError }, { data: exams, error: examsError }] = await Promise.all([
    planIds.length
      ? supabase.from("plans").select("id, name").in("id", planIds)
      : Promise.resolve({ data: [], error: null }),
    examIds.length
      ? supabase.from("exams").select("id, title").in("id", examIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (plansError || examsError) {
    const error = plansError ?? examsError;
    console.error("Unable to resolve access names:", error?.message);
    throw new Error("Les noms des forfaits ou examens n’ont pas pu être chargés.");
  }

  const planNames = new Map((plans ?? []).map((plan) => [plan.id, plan.name]));
  const examNames = new Map((exams ?? []).map((exam) => [exam.id, exam.title]));
  // This is a server-rendered page, so the timestamp cannot cause a client hydration mismatch.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const activeEntitlements = entitlements.filter((entitlement) =>
    !entitlement.revoked
    && (!entitlement.expires_at || new Date(entitlement.expires_at).getTime() > now)
    && (entitlement.credits_remaining ?? 0) > 0);
  const endedEntitlements = entitlements.filter((entitlement) => !activeEntitlements.includes(entitlement));

  function renderEntitlement(entitlement: EntitlementRow) {
    const includedExams = entitlement.exam_ids.map((id) => examNames.get(id) ?? "Examen retiré");
    const status = entitlement.revoked
      ? "Révoqué"
      : entitlement.expires_at && new Date(entitlement.expires_at).getTime() <= now
        ? "Expiré"
        : (entitlement.credits_remaining ?? 0) <= 0
          ? "Crédits épuisés"
          : "Actif";
    return (
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={entitlement.id}>
        <h3 className="font-bold text-slate-900">{entitlement.plan_id ? planNames.get(entitlement.plan_id) ?? "Accès manuel" : "Accès offert par l’administration"}</h3>
        <p className={`mt-2 text-sm font-semibold ${status === "Actif" ? "text-emerald-700" : "text-slate-500"}`}>
          {status}
        </p>
        <p className="mt-2 text-sm text-slate-600">Débute le {formatDate(entitlement.starts_at)}</p>
        <p className="text-sm text-slate-600">{entitlement.expires_at ? `Expire le ${formatDate(entitlement.expires_at)}` : "Sans date d’expiration"}</p>
        {includedExams.length > 0 && <p className="mt-3 text-sm text-slate-700">Examens : {includedExams.join(", ")}</p>}
        <p className="mt-1 text-sm text-slate-700">
          {(entitlement.credits_remaining ?? 0) === 0
            ? "0 crédit restant"
            : `Crédits restants : ${entitlement.credits_remaining}`}
        </p>
      </article>
    );
  }

  return (
    <section className="section">
      <div className="container mx-auto max-w-5xl">
        <p className="section-label">Votre compte</p>
        <h1 className="text-4xl font-black text-slate-900">Mes accès / paiements</h1>

        <section className="mt-9" aria-labelledby="active-access-heading">
          <h2 className="text-2xl font-bold text-slate-900" id="active-access-heading">Accès actifs</h2>
          {activeEntitlements.length === 0 ? (
            <p className="mt-4 rounded-xl border border-slate-200 bg-white p-5 text-slate-600">Aucun accès actif.</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {activeEntitlements.map(renderEntitlement)}
            </div>
          )}
        </section>

        <section className="mt-10" aria-labelledby="ended-access-heading">
          <h2 className="text-2xl font-bold text-slate-900" id="ended-access-heading">Accès terminés</h2>
          {endedEntitlements.length === 0 ? (
            <p className="mt-4 rounded-xl border border-slate-200 bg-white p-5 text-slate-600">Aucun accès terminé.</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {endedEntitlements.map(renderEntitlement)}
            </div>
          )}
        </section>

        <section className="mt-10" aria-labelledby="payments-heading">
          <h2 className="text-2xl font-bold text-slate-900" id="payments-heading">Demandes de paiement</h2>
          {payments.length === 0 ? (
            <p className="mt-4 rounded-xl border border-slate-200 bg-white p-5 text-slate-600">Vous n’avez pas encore de demande de paiement.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {payments.map((payment) => (
                <article className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5" key={payment.id}>
                  <div>
                    <h3 className="font-bold text-slate-900">{planNames.get(payment.plan_id) ?? "Forfait"} · {new Intl.NumberFormat("fr-DZ").format(payment.amount_dzd)} DA</h3>
                    <p className="mt-1 text-sm text-slate-600">Référence {payment.reference} · {formatDate(payment.created_at)}</p>
                    <p className="mt-1 text-sm font-semibold">
                      {payment.status === "pending"
                        ? "En attente de validation"
                        : payment.status === "approved"
                          ? "Activée"
                          : payment.status === "rejected"
                            ? "Refusée"
                            : "Annulée"}
                    </p>
                    {payment.admin_note && <p className="mt-1 text-sm text-slate-600">Note : {payment.admin_note}</p>}
                  </div>
                  {payment.status === "pending" && (
                    <div className="flex flex-wrap gap-3">
                      <Link className="secondary-btn" href={`/paiement/${payment.id}`}>Voir comment payer</Link>
                      <CancelPaymentButton paymentId={payment.id} />
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
        <Link className="mt-8 inline-block font-semibold text-blue-700 hover:underline" href="/tarifs">Découvrir les forfaits</Link>
      </div>
    </section>
  );
}
