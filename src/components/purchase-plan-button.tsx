"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function PurchasePlanButton({
  planId,
  label = "Acheter",
  className = "",
}: {
  planId: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const purchaseInProgress = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function purchase() {
    if (purchaseInProgress.current) return;
    purchaseInProgress.current = true;
    setBusy(true);
    setError("");
    let navigating = false;
    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const payload = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !payload.id) {
        if (response.status === 401) {
          navigating = true;
          router.push("/login?next=/tarifs");
          return;
        }
        throw new Error(payload.error ?? "La demande d’achat a échoué.");
      }
      navigating = true;
      router.push(`/paiement/${payload.id}`);
    } catch (purchaseError) {
      setError(purchaseError instanceof Error ? purchaseError.message : "La demande d’achat a échoué.");
    } finally {
      if (!navigating) {
        purchaseInProgress.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <div className="mt-5">
      <button className={`primary-btn w-full ${className}`} disabled={busy} onClick={() => void purchase()} type="button">
        {busy ? "Chargement…" : label}
      </button>
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
