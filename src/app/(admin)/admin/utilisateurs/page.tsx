import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminSignOut } from "@/components/admin-signout";
import { AdminUsers } from "@/components/admin-users";
import { getAdminContext } from "@/lib/admin-auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const instant = false;

export default async function AdminUsersPage() {
  if (!isSupabaseConfigured()) redirect("/login?error=access");

  const context = await getAdminContext();
  if (!context.user) {
    redirect(context.status === 401 ? "/login" : "/dashboard?error=access");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-slate-950 text-white lg:flex">
        <Link className="flex h-20 items-center gap-3 border-b border-white/10 px-6" href="/">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-sm font-black">TCF</span>
          <span className="text-sm font-semibold tracking-wide">SIMULATION <span className="text-slate-400">ADMIN</span></span>
        </Link>
        <nav aria-label="Navigation administration" className="flex-1 space-y-2 px-4 py-7">
          <Link className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white" href="/admin">
            <span aria-hidden="true">▦</span> Tableau de bord
          </Link>
          <Link className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white" href="/admin?view=exams">
            <span aria-hidden="true">▤</span> Examens
          </Link>
          <Link className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white" href="/admin?view=pricing">
            <span aria-hidden="true">◈</span> Tarifs publics
          </Link>
          <Link className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white" href="/admin?view=plans">
            <span aria-hidden="true">◆</span> Offres
          </Link>
          <Link className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white" href="/admin?view=content">
            <span aria-hidden="true">⚙</span> Gestion du contenu
          </Link>
          <Link className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white" href="/admin/paiements">
            <span aria-hidden="true">◉</span> Paiements & accès
          </Link>
          <Link aria-current="page" className="flex items-center gap-3 rounded-lg bg-blue-600 px-3 py-3 text-sm font-semibold text-white" href="/admin/utilisateurs">
            <span aria-hidden="true">♙</span> Utilisateurs
          </Link>
        </nav>
        <Link className="border-t border-white/10 px-6 py-5 text-sm text-slate-300 hover:text-white" href="/">← Retour au site</Link>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur md:px-8">
          <div>
            <p className="text-xs font-medium text-slate-500">Administration / Utilisateurs</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Espace administrateur</p>
          </div>
          <AdminSignOut />
        </header>
        <nav aria-label="Navigation administration mobile" className="flex gap-5 overflow-x-auto border-b border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 lg:hidden">
          <Link className="whitespace-nowrap hover:text-blue-700" href="/admin">Tableau de bord</Link>
          <Link className="whitespace-nowrap hover:text-blue-700" href="/admin?view=exams">Examens</Link>
          <Link className="whitespace-nowrap hover:text-blue-700" href="/admin?view=pricing">Tarifs publics</Link>
          <Link className="whitespace-nowrap hover:text-blue-700" href="/admin?view=plans">Offres</Link>
          <Link className="whitespace-nowrap hover:text-blue-700" href="/admin?view=content">Contenu</Link>
          <Link className="whitespace-nowrap hover:text-blue-700" href="/admin/paiements">Paiements & accès</Link>
          <Link aria-current="page" className="whitespace-nowrap font-bold text-blue-700" href="/admin/utilisateurs">Utilisateurs</Link>
        </nav>
        <main className="mx-auto max-w-[1440px] space-y-8 px-5 py-8 md:px-8">
          <AdminUsers currentAdminId={context.user.id} />
        </main>
      </div>
    </div>
  );
}
