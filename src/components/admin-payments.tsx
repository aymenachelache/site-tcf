"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Payment = {
  id: string;
  user_id: string;
  email: string;
  plan_id: string;
  amount_dzd: number;
  reference: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  receipt_ref: string | null;
  admin_note: string | null;
  created_at: string;
  processed_at: string | null;
};

type Plan = {
  id: string;
  name: string;
  price_dzd: number;
  exam_ids: string[];
  exam_credits: number | null;
  access_days: number | null;
  active: boolean;
};

type Entitlement = {
  id: string;
  user_id: string;
  email: string;
  plan_id: string | null;
  plan_name: string | null;
  exam_ids: string[];
  credits_remaining: number | null;
  starts_at: string;
  expires_at: string | null;
  revoked: boolean;
};

type AuditEntry = {
  id: string;
  actor_id: string | null;
  actor_email: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type DashboardData = { payments: Payment[]; plans: Plan[]; entitlements: Entitlement[]; auditLog: AuditEntry[] };

const auditActionLabels: Record<string, string> = {
  "payment.requested": "Demande créée",
  "payment.cancelled": "Demande annulée",
  "payment.approved": "Paiement activé",
  "payment.rejected": "Paiement refusé",
  "entitlement.granted": "Accès accordé",
  "entitlement.revoked": "Accès révoqué",
  "entitlement.extended": "Accès prolongé",
};

function dateLabel(date: string | null) {
  return date
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date))
    : "—";
}

export function AdminPayments() {
  const [data, setData] = useState<DashboardData>({ payments: [], plans: [], entitlements: [], auditLog: [] });
  const [email, setEmail] = useState("");
  const [query, setQuery] = useState("");
  const [receiptRefs, setReceiptRefs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [grantEmail, setGrantEmail] = useState("");
  const [grantPlan, setGrantPlan] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async (emailFilter: string) => {
    setLoading(true);
    setLoadFailed(false);
    setError("");
    try {
      const response = await fetch(`/api/admin/payments?email=${encodeURIComponent(emailFilter)}`, { cache: "no-store" });
      const result = (await response.json()) as DashboardData & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Chargement des paiements impossible.");
      setData(result);
      setGrantPlan((current) => current || result.plans.find((plan) => plan.active)?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement des paiements impossible.");
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(""), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  async function performAction(input: Record<string, string | number>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = (await response.json()) as { error?: string; warning?: string | null };
      if (!response.ok) throw new Error(result.error ?? "L’action n’a pas abouti.");
      setNotice(result.warning ?? "Action enregistrée et ajoutée au journal d’audit.");
      await loadData(query);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "L’action n’a pas abouti.");
    } finally {
      setBusy(false);
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(email.trim());
    await loadData(email.trim());
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-semibold text-blue-700">BaridiMob · activations manuelles</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Paiements & accès</h1>
      </header>

      <form className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-4" onSubmit={(event) => void search(event)}>
        <label className="sr-only" htmlFor="payment-email-search">Rechercher par email</label>
        <input
          autoComplete="email"
          className="min-w-60 flex-1 rounded-lg border border-slate-300 px-3 py-2"
          id="payment-email-search"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Rechercher par email"
          type="search"
          value={email}
        />
        <button className="primary-btn" disabled={loading} type="submit">Rechercher</button>
        <button className="secondary-btn" disabled={loading} onClick={() => { setEmail(""); setQuery(""); void loadData(""); }} type="button">Tout afficher</button>
      </form>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</p>}
      {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">{notice}</p>}

      <section aria-labelledby="direct-grant-title" className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-bold text-slate-900" id="direct-grant-title">Activer un accès manuellement</h2>
        <form
          className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void performAction({ action: "grant", email: grantEmail.trim(), planId: grantPlan });
          }}
        >
          <label className="sr-only" htmlFor="grant-email">Email du compte</label>
          <input className="rounded-lg border border-slate-300 px-3 py-2" id="grant-email" onChange={(event) => setGrantEmail(event.target.value)} placeholder="Email du compte" required type="email" value={grantEmail} />
          <label className="sr-only" htmlFor="grant-plan">Forfait à activer</label>
          <select className="rounded-lg border border-slate-300 px-3 py-2" id="grant-plan" onChange={(event) => setGrantPlan(event.target.value)} required value={grantPlan}>
            {data.plans.filter((plan) => plan.active).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {new Intl.NumberFormat("fr-DZ").format(plan.price_dzd)} DA</option>)}
          </select>
          <button className="primary-btn" disabled={busy || !grantPlan} type="submit">{busy ? "En cours…" : "Activer"}</button>
        </form>
      </section>

      {!loadFailed && <section aria-labelledby="requests-title">
        <h2 className="text-xl font-bold text-slate-900" id="requests-title">Demandes de paiement {query && <span className="text-sm font-normal text-slate-500">— « {query} »</span>}</h2>
        {loading ? <p className="mt-4 text-slate-600" role="status">Chargement…</p> : data.payments.length === 0 ? (
          <p className="mt-4 rounded-xl border border-slate-200 bg-white p-5 text-slate-600">Aucune demande trouvée.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {data.payments.map((payment) => {
              const plan = data.plans.find((entry) => entry.id === payment.plan_id);
              return (
                <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={payment.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-slate-900">{payment.email}</h3>
                      <p className="mt-1 text-sm text-slate-600">{plan?.name ?? "Forfait"} · {new Intl.NumberFormat("fr-DZ").format(payment.amount_dzd)} DA</p>
                      <p className="text-sm text-slate-600">Référence {payment.reference} · créée {dateLabel(payment.created_at)}</p>
                      {payment.receipt_ref && <p className="text-sm text-slate-600">Transaction : {payment.receipt_ref}</p>}
                      {payment.admin_note && <p className="mt-2 text-sm text-amber-800">Motif / note : {payment.admin_note}</p>}
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">{payment.status}</span>
                  </div>
                  {payment.status === "pending" && (
                    <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <label className="block text-sm font-medium" htmlFor={`receipt-${payment.id}`}>N° transaction du reçu</label>
                        <input className="w-full rounded-lg border border-slate-300 px-3 py-2" id={`receipt-${payment.id}`} onChange={(event) => setReceiptRefs((current) => ({ ...current, [payment.id]: event.target.value }))} value={receiptRefs[payment.id] ?? ""} />
                        <button className="primary-btn" disabled={busy || !receiptRefs[payment.id]?.trim()} onClick={() => void performAction({ action: "approve", requestId: payment.id, receiptRef: receiptRefs[payment.id].trim() })} type="button">Activer</button>
                      </div>
                      <div className="space-y-2">
                        <label className="block text-sm font-medium" htmlFor={`note-${payment.id}`}>Motif en cas de refus</label>
                        <input className="w-full rounded-lg border border-slate-300 px-3 py-2" id={`note-${payment.id}`} onChange={(event) => setNotes((current) => ({ ...current, [payment.id]: event.target.value }))} value={notes[payment.id] ?? ""} />
                        <button className="secondary-btn" disabled={busy || !notes[payment.id]?.trim()} onClick={() => void performAction({ action: "reject", requestId: payment.id, note: notes[payment.id].trim() })} type="button">Refuser</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>}

      {!loadFailed && <section aria-labelledby="entitlements-title">
        <h2 className="text-xl font-bold text-slate-900" id="entitlements-title">Accès activés</h2>
        {data.entitlements.length === 0 ? <p className="mt-4 text-slate-600">Aucun accès activé pour le moment.</p> : (
          <div className="mt-4 space-y-3">
            {data.entitlements.map((entitlement) => (
              <article className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4" key={entitlement.id}>
                <div>
                  <p className="font-semibold">{entitlement.email || entitlement.user_id} · {entitlement.plan_name ?? "Accès manuel"}</p>
                  <p className="text-sm text-slate-600">Début {dateLabel(entitlement.starts_at)} · fin {dateLabel(entitlement.expires_at)} · {entitlement.revoked ? "révoqué" : "actif"}</p>
                  <p className="text-xs text-slate-500">Crédits : {entitlement.credits_remaining ?? "—"} · Examens inclus : {entitlement.exam_ids.length}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="secondary-btn" disabled={busy || entitlement.revoked || !entitlement.expires_at} onClick={() => {
                    const input = window.prompt("Nombre de jours à ajouter (1 à 3650) :");
                    if (input && /^\d+$/.test(input)) void performAction({ action: "extend", entitlementId: entitlement.id, days: Number(input) });
                  }} type="button">Prolonger</button>
                  {!entitlement.revoked && <button className="secondary-btn" disabled={busy} onClick={() => {
                    if (window.confirm("Révoquer cet accès ?")) void performAction({ action: "revoke", entitlementId: entitlement.id });
                  }} type="button">Révoquer</button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>}

      {!loadFailed && <section aria-labelledby="payment-audit-title">
        <h2 className="text-xl font-bold text-slate-900" id="payment-audit-title">Journal d’audit récent</h2>
        {loading ? <p className="mt-4 text-slate-600" role="status">Chargement…</p> : data.auditLog.length === 0 ? (
          <p className="mt-4 rounded-xl border border-slate-200 bg-white p-5 text-slate-600">Aucune action enregistrée.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {data.auditLog.map((entry) => (
              <article className="grid gap-1 p-4 sm:grid-cols-[1fr_auto]" key={entry.id}>
                <div>
                  <p className="font-semibold text-slate-900">{auditActionLabels[entry.action] ?? entry.action}</p>
                  <p className="text-sm text-slate-600">
                    Par {entry.actor_email || entry.actor_id || "système"}
                    {entry.target ? ` · Référence ${entry.target}` : ""}
                  </p>
                  <p className="break-all text-xs text-slate-500">{JSON.stringify(entry.metadata)}</p>
                </div>
                <time className="text-sm text-slate-500">{dateLabel(entry.created_at)}</time>
              </article>
            ))}
          </div>
        )}
      </section>}
    </div>
  );
}
