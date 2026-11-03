import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminSignOut } from "@/components/admin-signout";
import { AdminPanel } from "@/components/admin-panel";
import { AdminPlans } from "@/components/admin-plans";
import { AdminDashboardAnalytics, type AdminAnalyticsData } from "@/components/admin-dashboard-analytics";
import { ExamCatalog } from "@/components/exam-catalog";
import { getPlans } from "@/lib/plans";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";
import "../../(site)/examen/catalog.css";

type AdminView = "dashboard" | "exams" | "pricing" | "plans" | "content";

export const instant = false;

const adminViews: { id: AdminView; label: string; href: string; icon: string }[] = [
  { id: "dashboard", label: "Tableau de bord", href: "/admin?view=dashboard", icon: "▦" },
  { id: "exams", label: "Examens", href: "/admin?view=exams", icon: "▤" },
  { id: "pricing", label: "Tarifs publics", href: "/admin?view=pricing", icon: "◈" },
  { id: "plans", label: "Offres", href: "/admin?view=plans", icon: "◆" },
  { id: "content", label: "Gestion du contenu", href: "/admin?view=content", icon: "⚙" },
];

function getAdminView(value: string | string[] | undefined): AdminView {
  return value === "exams" || value === "pricing" || value === "plans" || value === "content" ? value : "dashboard";
}

async function AdminPricingView() {
  const { plans, unavailable } = await getPlans();

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Offres visibles par les utilisateurs</p>
      <h2 className="mt-1 text-2xl font-bold text-slate-900">Tarifs publics</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        Consultez les forfaits affichés aux candidats. Pour les modifier, utilisez la section Offres.
      </p>

      {unavailable ? (
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          Les tarifs ne sont pas disponibles. Vérifiez la connexion Supabase et la table des offres.
        </p>
      ) : plans.length === 0 ? (
        <p className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600" role="status">
          Aucune offre active à afficher.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-5" key={plan.id}>
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{plan.name}</p>
              <p className="mt-3 text-3xl font-bold text-slate-900">
                {plan.price === 0 ? "Gratuit" : `${new Intl.NumberFormat("fr-DZ").format(plan.price)} DA`}
              </p>
              <p className="mt-1 text-sm text-slate-500">{plan.duration}</p>
              {plan.description && <p className="mt-4 text-sm leading-6 text-slate-600">{plan.description}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  if (!isSupabaseConfigured()) {
    redirect("/login?error=access");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error("Unable to verify admin session:", userError.message);
  }
  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, suspended")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Unable to verify admin role:", profileError.message);
    redirect("/dashboard?error=access");
  }
  if (!profile || profile.suspended || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const { view: requestedView } = await searchParams;
  const currentView = getAdminView(requestedView);
  const currentLabel = adminViews.find((item) => item.id === currentView)?.label ?? "Tableau de bord";
  const { data: analytics, error: analyticsError } = await supabase.rpc("admin_dashboard_analytics");
  if (analyticsError) {
    console.error("Unable to load admin dashboard analytics:", analyticsError.code, analyticsError.message);
  }
  const analyticsData = analytics as AdminAnalyticsData | null;
  const analyticsUnavailableMessage = analyticsError?.code === "PGRST202" || analyticsError?.code === "42883"
    ? "Exécutez supabase/migrations/016_dashboard_analytics_and_notifications.sql pour activer les indicateurs admin."
    : analyticsError
      ? "Les indicateurs administrateur n’ont pas pu être chargés."
      : null;

  return (
    <div id="admin-dashboard" className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-slate-950 text-white lg:flex">
        <Link className="flex h-20 items-center gap-3 border-b border-white/10 px-6" href="/">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-sm font-black">TCF</span>
          <span className="text-sm font-semibold tracking-wide">SIMULATION <span className="text-slate-400">ADMIN</span></span>
        </Link>
        <nav aria-label="Navigation administration" className="flex-1 space-y-2 px-4 py-7">
          <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Espace de gestion</p>
          {adminViews.map((item) => (
            <Link
              aria-current={currentView === item.id ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
                currentView === item.id
                  ? "bg-blue-600 font-semibold text-white"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
              href={item.href}
              key={item.id}
            >
              <span aria-hidden="true">{item.icon}</span> {item.label}
            </Link>
          ))}
          <Link
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            href="/admin/paiements"
          >
            <span aria-hidden="true">◉</span> Paiements & accès
            {analyticsData && analyticsData.pendingPayments > 0 && (
              <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white" aria-label={`${analyticsData.pendingPayments} demandes en attente`}>
                {analyticsData.pendingPayments}
              </span>
            )}
            {!analyticsData && analyticsError && <span className="ml-auto text-xs text-amber-300" title={analyticsUnavailableMessage ?? undefined}>!</span>}
          </Link>
          <Link
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            href="/admin/utilisateurs"
          >
            <span aria-hidden="true">♙</span> Utilisateurs
          </Link>
        </nav>
        <div className="m-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-semibold text-white">Accès administrateur</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">La gestion des examens est protégée par le rôle admin.</p>
        </div>
        <Link className="border-t border-white/10 px-6 py-5 text-sm text-slate-300 hover:text-white" href="/">
          ← Retour au site
        </Link>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur md:px-8">
          <div>
            <p className="text-xs font-medium text-slate-500">Administration / {currentLabel}</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Espace administrateur</p>
          </div>
          <div className="flex items-center gap-3">
            <Link className="hidden rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex" href="/">
              Voir le site
            </Link>
            <AdminSignOut />
            <span aria-label="Administrateur" className="grid size-9 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">A</span>
          </div>
        </header>
        <nav aria-label="Navigation administration mobile" className="flex gap-5 overflow-x-auto border-b border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 lg:hidden">
          {adminViews.map((item) => (
            <Link
              aria-current={currentView === item.id ? "page" : undefined}
              className={`whitespace-nowrap ${currentView === item.id ? "font-bold text-blue-700" : "hover:text-blue-700"}`}
              href={item.href}
              key={item.id}
            >
              {item.label}
            </Link>
          ))}
          <Link className="whitespace-nowrap hover:text-blue-700" href="/admin/paiements">
            Paiements
            {analyticsData && analyticsData.pendingPayments > 0 && (
              <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white" aria-label={`${analyticsData.pendingPayments} demandes en attente`}>
                {analyticsData.pendingPayments}
              </span>
            )}
          </Link>
          <Link className="whitespace-nowrap hover:text-blue-700" href="/admin/utilisateurs">Utilisateurs</Link>
        </nav>

        <main className="mx-auto max-w-[1440px] space-y-8 px-5 py-8 md:px-8">
          {currentView === "dashboard" && (
          <section id="admin-overview" className="scroll-mt-24">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-blue-700">Espace de travail</p>
                <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Tableau de bord</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Suivez l’activité du site et gérez les simulations TCF Tout Public (CO, SL et CE).
                </p>
              </div>
            </div>

            <AdminDashboardAnalytics
              data={analyticsData}
              error={analyticsUnavailableMessage}
            />

            <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Link className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md" href="/admin?view=exams">
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-lg bg-blue-50 text-lg text-blue-700" aria-hidden="true">▤</span>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Admin</span>
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-900">Examens blancs</h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">Consultez le catalogue des examens publiés.</p>
              </Link>
              <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-lg bg-violet-50 text-lg text-violet-700" aria-hidden="true">↕</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Ordre fixe</span>
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-900">Ordre des épreuves</h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">CO → SL → CE, les trois épreuves du TCF Tout Public.</p>
              </article>
              <Link className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md" href="/admin?view=pricing">
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-lg bg-amber-50 text-lg text-amber-700" aria-hidden="true">◈</span>
                  <span className="text-xs font-semibold text-blue-700">Consulter →</span>
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-900">Tarifs publics</h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">Consultez les offres affichées aux utilisateurs sur le site.</p>
              </Link>
              <Link className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md" href="/admin?view=plans">
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-lg bg-indigo-50 text-lg text-indigo-700" aria-hidden="true">◆</span>
                  <span className="text-xs font-semibold text-blue-700">Modifier →</span>
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-900">Offres</h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">Modifiez les prix, crédits, durées et textes affichés sur le site.</p>
              </Link>
              <Link className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md" href="/admin?view=content">
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-lg bg-emerald-50 text-lg text-emerald-700" aria-hidden="true">⚙</span>
                  <span className="text-xs font-semibold text-blue-700">Gérer →</span>
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-900">Gestion du contenu</h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">Créez et modifiez les examens, épreuves, questions et consignes.</p>
              </Link>
            </div>
          </section>
          )}

          {currentView === "exams" && <ExamCatalog />}

          {currentView === "pricing" && <AdminPricingView />}

          {currentView === "plans" && <AdminPlans />}

          {currentView === "content" && (
            <section id="exam-management" className="scroll-mt-24">
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Contenu</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">Gestion du contenu des examens</h1>
              </div>
            <AdminPanel />
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
