import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

export const instant = false;

export default async function PaymentInstructionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    console.error("Unable to verify payment page user:", authError.message);
    redirect("/login");
  }
  if (!user?.email) redirect("/login");

  const { id } = await params;
  const { data: payment, error: paymentError } = await supabase
    .from("payment_requests")
    .select("id, plan_id, amount_dzd, reference, status, admin_note, created_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (paymentError) {
    console.error("Unable to load payment instructions:", paymentError.message);
    throw new Error("La demande de paiement n’a pas pu être chargée.");
  }
  if (!payment) notFound();

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("name")
    .eq("id", payment.plan_id)
    .maybeSingle();
  if (planError) {
    console.error("Unable to load payment plan name:", planError.message);
    throw new Error("Le forfait n’a pas pu être chargé.");
  }

  const rawWhatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.trim() ?? "";
  const whatsappNumber = /^[+\d\s()-]+$/.test(rawWhatsappNumber)
    ? rawWhatsappNumber.replace(/\D/g, "")
    : "";
  const validWhatsappNumber = whatsappNumber.length >= 8 && whatsappNumber.length <= 15;
  const whatsappMessage = [
    `Bonjour, je veux activer le pack *${plan?.name ?? "TCF"}*.`,
    `Mon email : *${user.email}*.`,
    `Référence : *${payment.reference}*.`,
    "Je joins mon reçu BaridiMob.",
  ].join(" ");
  const whatsappUrl = validWhatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`
    : null;
  const isPending = payment.status === "pending";

  return (
    <section className="section">
      <div className="container mx-auto max-w-3xl">
        <p className="section-label">Paiement manuel BaridiMob</p>
        <h1 className="text-4xl font-black text-slate-900">Comment payer</h1>
        <p className="mt-3 text-slate-600">Effectuez le virement, puis envoyez la capture du reçu sur WhatsApp.</p>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <dl className="grid gap-5 sm:grid-cols-2">
            <div><dt className="text-sm text-slate-500">Forfait</dt><dd className="mt-1 font-semibold">{plan?.name ?? "Forfait"}</dd></div>
            <div><dt className="text-sm text-slate-500">Montant à virer</dt><dd className="mt-1 text-2xl font-bold">{new Intl.NumberFormat("fr-DZ").format(payment.amount_dzd)} DA</dd></div>
            <div><dt className="text-sm text-slate-500">RIP BaridiMob</dt><dd className="mt-1 break-all font-mono">{process.env.NEXT_PUBLIC_BARIDIMOB_RIP || "À configurer"}</dd></div>
            <div><dt className="text-sm text-slate-500">Nom du titulaire</dt><dd className="mt-1 font-semibold">{process.env.NEXT_PUBLIC_BARIDIMOB_ACCOUNT_NAME || "À configurer"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-sm text-slate-500">Votre référence de paiement</dt><dd className="mt-1 text-xl font-black tracking-wider">{payment.reference}</dd></div>
            <div><dt className="text-sm text-slate-500">État</dt><dd className="mt-1 font-semibold">{payment.status === "pending" ? "En attente de validation" : payment.status === "approved" ? "Paiement activé" : "Paiement refusé"}</dd></div>
          </dl>
          {payment.admin_note && <p className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Note de l’administration : {payment.admin_note}</p>}
        </div>

        {isPending && (
          <>
            <ol className="mt-7 list-decimal space-y-3 pl-6 text-slate-700">
              <li>Effectuez le virement BaridiMob du montant indiqué vers le RIP ci-dessus.</li>
              <li>Prenez une capture lisible du reçu de transaction.</li>
              <li>Envoyez le reçu sur WhatsApp avec votre référence de paiement.</li>
            </ol>
            {whatsappUrl ? (
              <a className="primary-btn mt-7 inline-flex" href={whatsappUrl} rel="noreferrer" target="_blank">
                Envoyer mon reçu sur WhatsApp
              </a>
            ) : (
              <p className="mt-6 text-sm text-red-700" role="alert">Le numéro WhatsApp n’est pas encore configuré.</p>
            )}
          </>
        )}
        <p className="mt-6 text-sm text-slate-500">L’accès est activé après vérification manuelle de votre reçu.</p>
        <Link className="mt-5 inline-block text-sm font-semibold text-blue-700 hover:underline" href="/mes-acces">Voir mes accès et paiements</Link>
      </div>
    </section>
  );
}
