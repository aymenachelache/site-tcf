"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CancelPaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function cancelPayment() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/payments/${encodeURIComponent(paymentId)}`, { method: "DELETE" });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "La demande n’a pas pu être annulée.");
      setConfirmOpen(false);
      router.refresh();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "La demande n’a pas pu être annulée.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button className="secondary-btn" disabled={busy} onClick={() => { setError(""); setConfirmOpen(true); }} type="button">
        {busy ? "Annulation…" : "Annuler cette demande"}
      </button>
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setConfirmOpen(false);
        }}>
          <section
            aria-labelledby="cancel-payment-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
          >
            <h2 className="text-xl font-bold text-slate-900" id="cancel-payment-title">Confirmer l’annulation</h2>
            <p className="mt-3 text-slate-600">Voulez-vous vraiment annuler cette demande de paiement ? Cette action ne peut pas être annulée.</p>
            {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="secondary-btn"
                disabled={busy}
                onClick={() => { setConfirmOpen(false); setError(""); }}
                type="button"
              >
                Garder la demande
              </button>
              <button
                className="primary-btn"
                disabled={busy}
                onClick={() => void cancelPayment()}
                type="button"
              >
                {busy ? "Annulation…" : "Confirmer l’annulation"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
