"use client";

import { useEffect, useState } from "react";

type AdminUser = {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  role: "user" | "admin";
  suspended: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
};

type UserList = { total: number; users: AdminUser[] };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value));
}

export function AdminUsers({ currentAdminId }: { currentAdminId: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "suspended">("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<UserList>({ total: 0, users: [] });
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const pageCount = Math.max(1, Math.ceil(result.total / 25));

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          search,
          status,
          page: String(page),
        });
        const response = await fetch(`/api/admin/users?${params}`, { signal: controller.signal });
        const data = await response.json() as UserList & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "La liste des utilisateurs n’a pas pu être chargée.");
        setResult(data);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "La liste des utilisateurs n’a pas pu être chargée.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [page, refresh, search, status]);

  async function changeStatus(user: AdminUser) {
    const action = user.suspended ? "reactivate" : "suspend";
    if (action === "suspend") {
      if (!window.confirm(`Désactiver le compte de ${user.first_name} ${user.last_name} ?`)) return;
    } else if (!window.confirm(`Réactiver le compte de ${user.first_name} ${user.last_name} ?`)) {
      return;
    }

    const reason = action === "suspend"
      ? window.prompt("Motif de la désactivation (facultatif) :", "")
      : null;
    if (reason === null && action === "suspend") return;

    let confirmation = "";
    if (action === "suspend" && user.role === "admin") {
      const required = `DESACTIVER ${(user.email ?? "").toLowerCase()}`;
      const typed = window.prompt(`Cet utilisateur est administrateur. Pour confirmer, saisissez exactement :\n${required}`);
      if (typed === null) return;
      confirmation = typed;
    }

    setPendingAction(user.user_id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.user_id, action, reason: reason ?? "", confirmation }),
      });
      const data = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "L’action n’a pas pu être enregistrée.");
      setNotice(data.message ?? "Action enregistrée.");
      setRefresh((value) => value + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "L’action n’a pas pu être enregistrée.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-blue-700">Comptes et accès</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Utilisateurs</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Recherchez les comptes et gérez leur activation sans supprimer leurs données.</p>
      </header>

      <section aria-label="Recherche des utilisateurs" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row">
        <label className="grid flex-1 gap-1 text-sm font-medium text-slate-700">
          Rechercher
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Nom, prénom, email ou téléphone"
            type="search"
            value={search}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700 sm:w-52">
          Statut
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPage(1);
            }}
            value={status}
          >
            <option value="all">Tous</option>
            <option value="active">Actifs</option>
            <option value="suspended">Désactivés</option>
          </select>
        </label>
      </section>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{notice}</p>}

      <section aria-label="Liste des utilisateurs" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">{loading ? "Chargement…" : `${result.total} résultat(s)`}</p>
          <p className="text-xs text-slate-500">25 comptes par page</p>
        </div>

        <div className="hidden grid-cols-[0.9fr_0.9fr_1.5fr_1.2fr_0.8fr_1.2fr_1.1fr] gap-3 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500 lg:grid">
          <span>Nom</span><span>Prénom</span><span>Email</span><span>Téléphone</span><span>Inscription</span><span>Rôle / statut</span><span>Actions</span>
        </div>
        {result.users.map((user) => {
          const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Sans nom";
          return (
            <article className="grid gap-3 border-t border-slate-100 p-4 lg:grid-cols-[0.9fr_0.9fr_1.5fr_1.2fr_0.8fr_1.2fr_1.1fr] lg:items-start" key={user.user_id}>
              <div>
                <p className="font-semibold text-slate-900 lg:font-normal">
                  <span className="lg:hidden">{fullName}</span>
                  <span className="hidden lg:inline">{user.last_name || "—"}</span>
                </p>
                <p className="mt-1 break-all text-sm text-slate-600 lg:hidden">{user.email ?? "Email indisponible"}</p>
                <p className="text-sm text-slate-600 lg:hidden">{user.phone ?? "Téléphone non renseigné"}</p>
              </div>
              <p className="hidden text-sm text-slate-700 lg:block">{user.first_name || "—"}</p>
              <p className="hidden break-all text-sm text-slate-700 lg:block">{user.email ?? "—"}</p>
              <p className="hidden text-sm text-slate-700 lg:block">{user.phone ?? "—"}</p>
              <p className="text-sm text-slate-600"><span className="font-medium lg:hidden">Inscription : </span>{formatDate(user.created_at)}</p>
              <div className="space-y-1">
                <p className="text-sm text-slate-700">{user.role === "admin" ? "Administrateur" : "Utilisateur"}</p>
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${user.suspended ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
                  {user.suspended ? "Désactivé" : "Actif"}
                </span>
                {user.suspended && (
                  <p className="text-xs leading-5 text-slate-500">
                    {user.suspended_at ? `Depuis le ${formatDate(user.suspended_at)}.` : ""}
                    {user.suspended_reason ? ` Motif : ${user.suspended_reason}` : ""}
                  </p>
                )}
              </div>
              <div>
                <button
                  className={`rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${user.suspended ? "bg-emerald-700 hover:bg-emerald-800" : "bg-red-700 hover:bg-red-800"}`}
                  disabled={pendingAction === user.user_id || user.user_id === currentAdminId}
                  onClick={() => void changeStatus(user)}
                  type="button"
                >
                  {pendingAction === user.user_id ? "En cours…" : user.suspended ? "Réactiver" : "Désactiver"}
                </button>
              </div>
            </article>
          );
        })}
        {!loading && result.users.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-600">Aucun utilisateur ne correspond à ces critères.</p>
        )}
        {loading && result.users.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-600">Chargement des utilisateurs…</p>
        )}

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            type="button"
          >
            Précédent
          </button>
          <span className="text-sm text-slate-600">Page {page} / {pageCount}</span>
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
            disabled={page >= pageCount || loading}
            onClick={() => setPage((value) => value + 1)}
            type="button"
          >
            Suivant
          </button>
        </div>
      </section>
    </section>
  );
}
