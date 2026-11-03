import { redirect } from "next/navigation";
import Link from "next/link";
import { AdminPayments } from "@/components/admin-payments";
import { getAdminContext } from "@/lib/admin-auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const instant = false;

export default async function AdminPaymentsPage() {
  if (!isSupabaseConfigured()) redirect("/login?error=access");

  const context = await getAdminContext();
  if (context.error) {
    if (context.status === 401) redirect("/login");
    if (context.status === 403) redirect("/dashboard");
    throw new Error(context.error);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 md:px-8">
        <Link className="font-bold text-slate-900" href="/admin">TCF Simulation · Administration</Link>
        <nav className="flex gap-4 text-sm font-medium text-slate-700" aria-label="Administration">
          <Link href="/admin">Dashboard admin</Link>
          <Link aria-current="page" href="/admin/paiements">Paiements</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-5 py-8 md:px-8">
        <AdminPayments />
      </main>
    </div>
  );
}
