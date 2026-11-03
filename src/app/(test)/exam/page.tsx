import { ExamDemo } from "@/components/exam-demo";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

export const instant = false;

export default async function ExamRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; fullscreen?: string; exam?: string; attempt?: string }>;
}) {
  const params = await searchParams;
  if (!isSupabaseConfigured() || params.start !== "1" || !params.exam) redirect("/examen");

  if (params.attempt) {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError && authError.name !== "AuthSessionMissingError") {
      console.error("Unable to verify exam attempt user:", authError.message);
      redirect("/examen");
    }
    if (user) {
      const { data: attempt, error: attemptError } = await supabase
        .from("attempts")
        .select("id")
        .eq("id", params.attempt)
        .eq("exam_id", params.exam)
        .eq("user_id", user.id)
        .in("status", ["in_progress", "submitted"])
        .maybeSingle();
      if (attemptError) {
        console.error("Unable to verify exam attempt:", attemptError.message);
        redirect("/examen");
      }
      if (!attempt) redirect("/examen");
    } else {
      const { data: isPublicAttempt, error: attemptError } = await supabase.rpc("public_free_attempt_exists", {
        p_attempt_id: params.attempt,
        p_exam_id: params.exam,
      });
      if (attemptError) {
        console.error("Unable to verify public free exam attempt:", attemptError.message);
        redirect("/examen");
      }
      if (!isPublicAttempt) redirect("/examen");
    }
  }

  return (
    <ExamDemo
      autoStart={params.start === "1"}
      examId={params.exam}
      attemptId={params.attempt}
      fullscreenUnavailable={params.fullscreen === "error"}
    />
  );
}
