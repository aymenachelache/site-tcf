import { createClient } from "@/utils/supabase/server";

export async function getAdminContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error("Unable to verify admin session:", userError.message);
    return { supabase, user: null, error: "La session administrateur n’a pas pu être vérifiée.", status: 401 };
  }
  if (!user) {
    return { supabase, user: null, error: "Connexion administrateur requise.", status: 401 };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, suspended")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Unable to verify admin role:", profileError.message);
    return { supabase, user: null, error: "Le rôle administrateur n’a pas pu être vérifié.", status: 500 };
  }
  if (!profile || profile.suspended || profile.role !== "admin") {
    return { supabase, user: null, error: "Accès administrateur requis.", status: 403 };
  }

  return { supabase, user, error: null, status: 200 };
}
