"use client";

import { useState, type FormEvent } from "react";
import { normalizeAlgerianPhone } from "@/lib/algerian-phone";
import { createClient } from "@/utils/supabase/client";

export function ProfilePhoneForm({
  userId,
  initialPhone,
}: {
  userId: string;
  initialPhone: string | null;
}) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    const normalizedPhone = normalizeAlgerianPhone(phone);
    if (!normalizedPhone) {
      setError("Saisissez un numéro algérien valide, par exemple 05XX XX XX XX ou +213...");
      return;
    }

    setSaving(true);
    try {
      const { data, error: updateError } = await createClient()
        .from("profiles")
        .update({ phone: normalizedPhone })
        .eq("user_id", userId)
        .select("user_id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error("Le numéro n’a pas pu être enregistré.");
      setPhone(normalizedPhone);
      setMessage("Votre numéro de téléphone a été enregistré.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Le numéro n’a pas pu être enregistré.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="profile-phone-title" className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold text-slate-950" id="profile-phone-title">Mon profil</h2>
      <form className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleSubmit}>
        <label className="grid flex-1 gap-1 text-sm font-medium text-slate-700">
          Numéro de téléphone
          <input
            autoComplete="tel"
            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            onChange={(event) => setPhone(event.target.value)}
            placeholder="05XX XX XX XX ou +213..."
            required
            type="tel"
            value={phone}
          />
        </label>
        <button
          className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      {message && <p className="mt-3 text-sm text-emerald-700" role="status">{message}</p>}
    </section>
  );
}
