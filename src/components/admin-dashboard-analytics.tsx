type DailyMetric = { date: string; count: number };
type SectionMetric = { section: "CO" | "SL" | "CE"; average: number; attempts: number };
export type AdminAnalyticsData = {
  totalUsers: number;
  pendingPayments: number;
  revenueDzd: number;
  signupsByDay: DailyMetric[];
  attemptsByDay: DailyMetric[];
  averageScoreBySection: SectionMetric[];
};

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" }).format(new Date(`${value}T12:00:00`));
}

function DailyBars({ title, data }: { title: string; data: DailyMetric[] }) {
  const maximum = Math.max(1, ...data.map((entry) => entry.count));
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold text-slate-900">{title} · 14 derniers jours</h2>
      {data.every((entry) => entry.count === 0) ? (
        <p className="mt-4 text-sm text-slate-600">Aucune donnée sur cette période.</p>
      ) : (
        <div className="mt-5 grid grid-cols-7 gap-x-2 gap-y-3 sm:grid-cols-14">
          {data.map((entry) => (
            <div className="flex min-w-0 flex-col items-center gap-1" key={entry.date} title={`${dayLabel(entry.date)} : ${entry.count}`}>
              <span className="text-[10px] text-slate-500">{entry.count || ""}</span>
              <div aria-label={`${entry.count} le ${dayLabel(entry.date)}`} className="flex h-24 w-full items-end rounded bg-slate-50">
                <div className="w-full rounded-t bg-blue-600" style={{ height: `${Math.max(3, entry.count / maximum * 100)}%` }} />
              </div>
              <span className="text-[10px] text-slate-500">{dayLabel(entry.date)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function AdminDashboardAnalytics({
  data,
  error,
}: {
  data: AdminAnalyticsData | null;
  error: string | null;
}) {
  if (!data) {
    return (
      <div className="mt-7 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900" role="alert">
        {error ?? "Les indicateurs administrateur ne sont pas disponibles."}
      </div>
    );
  }

  const signupsToday = data.signupsByDay.at(-1)?.count ?? 0;
  const attemptsToday = data.attemptsByDay.at(-1)?.count ?? 0;
  const cards = [
    { label: "Utilisateurs", value: String(data.totalUsers) },
    { label: "Inscriptions aujourd’hui", value: String(signupsToday) },
    { label: "Demandes en attente", value: String(data.pendingPayments) },
    { label: "Revenus activés", value: `${new Intl.NumberFormat("fr-DZ").format(data.revenueDzd)} DA` },
    { label: "Simulations démarrées aujourd’hui", value: String(attemptsToday) },
  ];

  return (
    <div className="mt-7 space-y-6">
      <section aria-label="Indicateurs principaux" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={card.label}>
            <p className="text-sm font-medium text-slate-500">{card.label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-950">{card.value}</p>
          </article>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <DailyBars data={data.signupsByDay} title="Inscriptions" />
        <DailyBars data={data.attemptsByDay} title="Simulations démarrées" />
      </div>

      <section aria-labelledby="average-section-score" className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900" id="average-section-score">Score moyen par épreuve · sur 699</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {data.averageScoreBySection.map((section) => (
            <article className="rounded-lg bg-slate-50 p-4" key={section.section}>
              <p className="text-sm font-semibold text-slate-700">{section.section}</p>
              {section.attempts === 0 ? (
                <p className="mt-2 text-sm text-slate-600">Aucun résultat disponible.</p>
              ) : (
                <>
                  <p className="mt-1 text-2xl font-bold text-slate-950">{section.average}</p>
                  <p className="text-xs text-slate-500">sur {section.attempts} résultat(s)</p>
                </>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
