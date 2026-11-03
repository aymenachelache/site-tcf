"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { createClient } from "@/utils/supabase/client";

const planSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000),
  price_dzd: z.number().int().min(0).max(100_000_000),
  exam_credits: z.number().int().min(0).max(10_000).nullable(),
  access_days: z.number().int().min(1).max(3650).nullable(),
  objective: z.string().trim().max(120),
  badge: z.string().trim().max(80),
  exam_type: z.enum(["TCF Tout Public", "Canada", "IRN", "Québec"]),
  sort_order: z.number().int().min(0).max(100_000),
  features: z.array(z.string().trim().min(1).max(500)).max(30),
  active: z.boolean(),
});

type PlanRow = z.infer<typeof planSchema> & { id: string };
const examTypes = ["TCF Tout Public", "Canada", "IRN", "Québec"] as const;

function nullableInteger(value: FormDataEntryValue | null, label: string): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const number = Number(text);
  if (!Number.isInteger(number)) throw new Error(`${label} doit être un nombre entier.`);
  return number;
}

export function AdminPlans() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await createClient()
      .from("plans")
      .select("id, name, description, price_dzd, exam_credits, access_days, active, sort_order, objective, badge, features, exam_type")
      .order("sort_order");

    if (loadError) {
      console.error("Unable to load admin plans:", loadError.message);
      setError(`Les offres n’ont pas pu être chargées : ${loadError.message}. Vérifiez que la migration 007 a été exécutée.`);
      setLoading(false);
      return;
    }

    const parsedPlans: PlanRow[] = [];
    for (const [index, row] of (data ?? []).entries()) {
      const parsed = planSchema.safeParse({
        ...row,
        description: row.description ?? "",
        objective: row.objective ?? "",
        badge: row.badge ?? "",
        exam_type: row.exam_type ?? "TCF Tout Public",
        features: Array.isArray(row.features) ? row.features : [],
      });
      if (!parsed.success) {
        console.error(`Ignoring invalid plan row ${index}:`, parsed.error.issues);
        setError(`Une offre contient des données invalides (ligne ${index + 1}).`);
        continue;
      }
      parsedPlans.push({ ...parsed.data, id: row.id });
    }
    setPlans(parsedPlans);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPlans(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPlans]);

  async function savePlan(event: FormEvent<HTMLFormElement>, plan: PlanRow) {
    event.preventDefault();
    setSavingId(plan.id);
    setError("");
    setNotice("");

    try {
      const form = new FormData(event.currentTarget);
      const rawFeatures = String(form.get("features") ?? "");
      const features = rawFeatures.split(/\r?\n/).map((feature) => feature.trim()).filter(Boolean);
      const candidate = {
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        price_dzd: Number(form.get("price_dzd")),
        exam_credits: nullableInteger(form.get("exam_credits"), "Le nombre de simulations"),
        access_days: nullableInteger(form.get("access_days"), "La durée"),
        objective: String(form.get("objective") ?? ""),
        badge: String(form.get("badge") ?? ""),
        exam_type: String(form.get("exam_type")),
        sort_order: Number(form.get("sort_order")),
        features,
        active: form.get("active") === "on",
      };
      const parsed = planSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Vérifiez les champs de l’offre.");
      }

      const { error: saveError } = await createClient()
        .from("plans")
        .update(parsed.data)
        .eq("id", plan.id);
      if (saveError) throw new Error(saveError.message);

      setNotice(`L’offre « ${parsed.data.name} » a été mise à jour.`);
      await loadPlans();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "L’offre n’a pas pu être enregistrée.");
    } finally {
      setSavingId("");
    }
  }

  return (
    <section className="space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Catalogue public</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Gestion des offres</h1>
        <p className="mt-2 text-sm text-slate-600">Modifiez le prix en dinars, les crédits, la durée et les textes affichés sur la landing et /tarifs.</p>
      </header>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</p>}
      {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">{notice}</p>}
      {loading ? (
        <p className="text-sm text-slate-600" role="status">Chargement des offres…</p>
      ) : plans.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-slate-600">Aucune offre n’est présente dans la table plans.</p>
      ) : plans.map((plan) => (
        <form className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={plan.id} onSubmit={(event) => void savePlan(event, plan)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">{plan.name}</h2>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input defaultChecked={plan.active} name="active" type="checkbox" />
              Offre visible et achetable
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="admin-field">Nom<input defaultValue={plan.name} maxLength={100} name="name" required /></label>
            <label className="admin-field">Prix (DA)<input defaultValue={plan.price_dzd} min="0" name="price_dzd" required type="number" /></label>
            <label className="admin-field">Simulations / crédits<input defaultValue={plan.exam_credits ?? ""} min="0" name="exam_credits" type="number" /></label>
            <label className="admin-field">Durée (jours)<input defaultValue={plan.access_days ?? ""} min="1" name="access_days" type="number" /></label>
            <label className="admin-field">Objectif<input defaultValue={plan.objective ?? ""} maxLength={120} name="objective" placeholder="Objectif B2" /></label>
            <label className="admin-field">Badge<input defaultValue={plan.badge ?? ""} maxLength={80} name="badge" placeholder="Le plus choisi" /></label>
            <label className="admin-field">Type TCF
              <select defaultValue={plan.exam_type} name="exam_type">
                {examTypes.map((examType) => <option key={examType} value={examType}>{examType}</option>)}
              </select>
            </label>
            <label className="admin-field">Ordre d’affichage<input defaultValue={plan.sort_order} min="0" name="sort_order" required type="number" /></label>
          </div>
          <label className="admin-field">Description courte<textarea defaultValue={plan.description} maxLength={1000} name="description" rows={2} /></label>
          <label className="admin-field">Avantages (une ligne par point)<textarea defaultValue={plan.features.join("\n")} name="features" rows={5} /></label>
          <div className="flex justify-end">
            <button className="primary-btn" disabled={savingId !== ""} type="submit">
              {savingId === plan.id ? "Enregistrement…" : "Enregistrer l’offre"}
            </button>
          </div>
        </form>
      ))}
    </section>
  );
}
