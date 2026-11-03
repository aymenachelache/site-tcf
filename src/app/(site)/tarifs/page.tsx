import Link from "next/link";
import { PurchasePlanButton } from "@/components/purchase-plan-button";
import { getPlans } from "@/lib/plans";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

export const instant = false;

export default async function TarifsPage() {
  const { plans, unavailable } = await getPlans();
  const isConfigured = isSupabaseConfigured();
  const { data: authData } = isConfigured
    ? await (await createClient()).auth.getUser()
    : { data: { user: null } };
  const emailConfirmed = Boolean(authData.user?.email_confirmed_at);

  return (
    <section className="section">
      <div className="container">
        <div className="mx-auto max-w-3xl text-center">
          <p className="section-label">Paiement manuel</p>
          <h1 className="text-4xl font-black text-slate-900">Choisissez un accès</h1>
          <p className="mt-3 text-slate-600">
            Le paiement est fait par BaridiMob. Envoyez votre reçu via WhatsApp après votre virement ; l’accès est activé après vérification.
          </p>
        </div>

        {unavailable ? (
          <p className="mx-auto mt-10 max-w-2xl rounded-xl border border-slate-200 bg-white p-5 text-center text-slate-600" role="status">
            Les offres sont momentanément indisponibles
          </p>
        ) : plans.length === 0 ? (
          <p className="mx-auto mt-10 max-w-2xl rounded-xl border border-slate-200 bg-white p-5 text-center text-slate-600" role="status">
            Les offres sont momentanément indisponibles
          </p>
        ) : (
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => (
              <article key={plan.id} className={`plan-card relative ${plan.highlighted ? "border-blue-500 ring-2 ring-blue-100" : ""}`}>
                {plan.badge && (
                  <span className="absolute -top-3 left-5 rounded-full bg-blue-700 px-3 py-1 text-xs font-bold text-white">
                    {plan.badge}
                  </span>
                )}
                <div className="text-sm font-semibold uppercase tracking-[0.08em] text-blue-600">{plan.name}</div>
                {plan.objective && <p className="mt-2 text-sm font-semibold text-slate-700">{plan.objective}</p>}
                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  {plan.examType === "TCF Tout Public" ? "TCF TP" : plan.examType}
                </p>
                <div className="mt-4 text-4xl font-black text-slate-900">
                  {plan.price === 0 ? "Gratuit" : `${new Intl.NumberFormat("fr-DZ").format(plan.price)} DA`}
                </div>
                <div className="mt-2 text-sm text-slate-500">{plan.duration}</div>
                {plan.features.length ? (
                  <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-700">
                    {plan.features.map((feature) => (
                      <li className="flex gap-2" key={feature}>
                        <span className="font-bold text-emerald-600" aria-hidden="true">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                ) : plan.description ? (
                  <p className="mt-4 text-slate-600">{plan.description}</p>
                ) : null}
                {plan.price === 0 ? (
                  <Link href="/examen" className="secondary-btn mt-5 inline-flex w-full justify-center">Accéder gratuitement</Link>
                ) : !isConfigured ? (
                  <p className="mt-5 text-sm text-amber-800">Configurez Supabase pour acheter ce forfait.</p>
                ) : authData.user && !emailConfirmed ? (
                  <p className="mt-5 text-sm text-amber-800" role="status">Confirmez votre email pour acheter</p>
                ) : authData.user ? (
                  <PurchasePlanButton label="Choisir cette offre" planId={plan.id} />
                ) : (
                  <Link href="/login?next=/tarifs" className="primary-btn mt-5 inline-flex w-full justify-center">Choisir cette offre</Link>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
