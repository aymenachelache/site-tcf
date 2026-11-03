import { notFound, redirect } from "next/navigation";
import { AttemptResultDetail } from "@/components/attempt-result-detail";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

export const instant = false;

export default async function AttemptResultPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.error("Unable to verify result page session:", error.message);
    redirect("/login");
  }
  if (!user) redirect("/login");

  const { attemptId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) notFound();

  return (
    <section className="section">
      <div className="container mx-auto max-w-5xl">
        <AttemptResultDetail attemptId={attemptId} />
      </div>
    </section>
  );
}
