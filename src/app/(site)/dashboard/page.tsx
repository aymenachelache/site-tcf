import { redirect } from "next/navigation";
import { UserDashboard } from "@/components/user-dashboard";
import { ProfilePhoneForm } from "@/components/profile-phone-form";
import { CandidateDashboardShell } from "@/components/candidate-dashboard-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";
import "./dashboard.css";

export const instant = false;

const emptyProps = {
  name: "",
  exams: [],
  examSections: [],
  attempts: [],
  attemptCount: 0,
  results: [],
  entitlements: [],
  payments: [],
};

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) {
    return (
      <CandidateDashboardShell>
        <UserDashboard
          {...emptyProps}
          dataError="Supabase n’est pas configuré. Le tableau est vide et n’affiche aucune donnée de démonstration."
        />
      </CandidateDashboardShell>
    );
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("Unable to verify dashboard session:", authError.message);
    redirect("/login");
  }
  if (!authData.user) redirect("/login");

  const [profileResponse, examResponse, examSectionResponse, attemptResponse, attemptCountResponse, entitlementResponse, paymentResponse] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name, phone").eq("user_id", authData.user.id).maybeSingle(),
    supabase.from("exams").select("id, title, exam_type, is_free").eq("status", "published").order("sort_order"),
    supabase.from("exam_catalog_sections").select("exam_id, kind, duration_seconds, question_count"),
    supabase.from("attempts").select("id, exam_id, submitted_at").eq("user_id", authData.user.id).eq("status", "submitted").order("submitted_at", { ascending: false }).limit(100),
    supabase.from("attempts").select("id", { count: "exact", head: true }).eq("user_id", authData.user.id),
    supabase.from("entitlements").select("id, plan_id, exam_ids, credits_remaining, starts_at, expires_at, revoked").eq("user_id", authData.user.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("payment_requests").select("id, plan_id, amount_dzd, reference, status, admin_note, created_at").eq("user_id", authData.user.id).order("created_at", { ascending: false }).limit(100),
  ]);
  const errors = [
    profileResponse.error,
    examResponse.error,
    attemptResponse.error,
    attemptCountResponse.error,
    entitlementResponse.error,
    paymentResponse.error,
  ].filter((error) => error !== null);
  if (errors.length > 0) {
    for (const error of errors) console.error("Unable to load user dashboard data:", error.message);
    return (
      <CandidateDashboardShell>
        <UserDashboard
          {...emptyProps}
          dataError="Les données du tableau de bord n’ont pas pu être chargées. Vérifiez les migrations Supabase et les autorisations RLS."
        />
      </CandidateDashboardShell>
    );
  }

  if (examSectionResponse.error) {
    console.error("Unable to load dashboard exam metadata:", examSectionResponse.error.message);
  }

  const attempts = attemptResponse.data ?? [];
  const attemptIds = attempts.map((attempt) => attempt.id);
  const resultResponse = attemptIds.length
    ? await supabase.from("results")
      .select("attempt_id, section_kind, score, cefr_level")
      .in("attempt_id", attemptIds)
      .in("section_kind", ["CO", "SL", "CE"])
    : { data: [], error: null };
  if (resultResponse.error) {
    console.error("Unable to load user results:", resultResponse.error.message);
    return (
      <CandidateDashboardShell>
        <UserDashboard
          {...emptyProps}
          dataError="Les résultats n’ont pas pu être chargés. Vérifiez les autorisations RLS de la table results."
        />
      </CandidateDashboardShell>
    );
  }

  const planIds = [...new Set([
    ...(entitlementResponse.data ?? []).flatMap((access) => access.plan_id ? [access.plan_id] : []),
    ...(paymentResponse.data ?? []).map((payment) => payment.plan_id),
  ])];
  const planResponse = planIds.length
    ? await supabase.from("plans").select("id, name, exam_credits").in("id", planIds)
    : { data: [], error: null };
  if (planResponse.error) {
    console.error("Unable to load user plan names:", planResponse.error.message);
    return (
      <CandidateDashboardShell>
        <UserDashboard
          {...emptyProps}
          dataError="Les noms des forfaits n’ont pas pu être chargés."
        />
      </CandidateDashboardShell>
    );
  }

  const planNames = new Map((planResponse.data ?? []).map((plan) => [plan.id, plan.name]));
  const profile = profileResponse.data;
  const name = profile?.first_name ?? "";
  const planCredits = new Map((planResponse.data ?? []).map((plan) => [plan.id, plan.exam_credits]));

  return (
    <CandidateDashboardShell>
      <UserDashboard
        name={name}
        exams={examResponse.data ?? []}
        examSections={(examSectionResponse.data ?? []).map((section) => ({
          ...section,
          kind: section.kind as "CO" | "SL" | "CE" | "EE" | "EO",
        }))}
        attempts={attempts}
        attemptCount={attemptCountResponse.count ?? 0}
        results={resultResponse.data ?? []}
        entitlements={(entitlementResponse.data ?? []).map((access) => ({
          ...access,
          plan_name: access.plan_id ? planNames.get(access.plan_id) ?? "Accès manuel" : "Accès manuel",
          total_credits: access.plan_id ? planCredits.get(access.plan_id) ?? null : null,
        }))}
        payments={(paymentResponse.data ?? []).map((payment) => ({
          ...payment,
          plan_name: planNames.get(payment.plan_id) ?? "Forfait",
        }))}
      />
      <div className="candidate-dashboard-profile">
        <ProfilePhoneForm userId={authData.user.id} initialPhone={profile?.phone ?? null} />
      </div>
    </CandidateDashboardShell>
  );
}
