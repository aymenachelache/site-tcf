import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getAdminContext } from "@/lib/admin-auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const userIdSchema = z.string().uuid();
const actionSchema = z.object({
  userId: userIdSchema,
  action: z.enum(["suspend", "reactivate"]),
  reason: z.string().max(500).optional().default(""),
  confirmation: z.string().optional().default(""),
});
const userListSchema = z.object({
  total: z.number().int().nonnegative(),
  users: z.array(z.object({
    user_id: userIdSchema,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    created_at: z.string(),
    role: z.enum(["admin", "user"]),
    suspended: z.boolean(),
    suspended_at: z.string().nullable(),
    suspended_reason: z.string().nullable(),
  })),
});

function serviceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(request: NextRequest) {
  const context = await getAdminContext();
  if (!context.user) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase n’est pas configuré." }, { status: 503 });
  }

  const params = request.nextUrl.searchParams;
  const page = Number(params.get("page") ?? "1");
  const status = params.get("status") ?? "all";
  if (!Number.isInteger(page) || page < 1 || !["all", "active", "suspended"].includes(status)) {
    return NextResponse.json({ error: "Filtres de recherche invalides." }, { status: 400 });
  }

  const { data, error } = await context.supabase.rpc("admin_list_users", {
    p_search: (params.get("search") ?? "").trim(),
    p_status: status,
    p_page: page,
  });
  if (error) {
    console.error("Unable to load admin users:", error.code, error.message);
    return NextResponse.json({ error: "La liste des utilisateurs n’a pas pu être chargée." }, { status: 500 });
  }

  const parsed = userListSchema.safeParse(data);
  if (!parsed.success) {
    console.error("Admin users RPC returned an invalid response:", parsed.error.message);
    return NextResponse.json({ error: "La liste des utilisateurs a renvoyé des données invalides." }, { status: 500 });
  }

  return NextResponse.json(parsed.data);
}

export async function POST(request: NextRequest) {
  const context = await getAdminContext();
  if (!context.user) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Le contenu de la requête est invalide." }, { status: 400 });
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Action ou données utilisateur invalides." }, { status: 400 });
  }

  const { userId, action, reason, confirmation } = parsed.data;
  const shouldSuspend = action === "suspend";
  if (shouldSuspend && userId === context.user.id) {
    return NextResponse.json({ error: "Vous ne pouvez pas désactiver votre propre compte." }, { status: 403 });
  }

  const { data: target, error: targetError } = await context.supabase
    .from("profiles")
    .select("role, suspended")
    .eq("user_id", userId)
    .maybeSingle();
  if (targetError) {
    console.error("Unable to verify target user:", targetError.message);
    return NextResponse.json({ error: "Le compte ciblé n’a pas pu être vérifié." }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }
  if (target.suspended === shouldSuspend) {
    return NextResponse.json({
      message: shouldSuspend ? "Ce compte est déjà désactivé." : "Ce compte est déjà actif.",
    });
  }

  const adminClient = serviceRoleClient();
  if (!adminClient) {
    console.error("User management is unavailable: Supabase service role credentials are missing.");
    return NextResponse.json({
      error: "Configuration serveur manquante : ajoutez SUPABASE_SERVICE_ROLE_KEY dans .env.local, puis redémarrez le serveur.",
    }, { status: 503 });
  }

  const { data: authUser, error: authUserError } = await adminClient.auth.admin.getUserById(userId);
  if (authUserError || !authUser.user) {
    console.error("Unable to load target Auth user:", authUserError?.message ?? "User not found.");
    return NextResponse.json({ error: "Le compte Auth ciblé est introuvable." }, { status: 404 });
  }

  const previousBanUntil = authUser.user.banned_until;
  const previousBanDuration = previousBanUntil && Date.parse(previousBanUntil) > Date.now()
    ? `${Math.max(1, Math.ceil((Date.parse(previousBanUntil) - Date.now()) / 3_600_000))}h`
    : "none";
  const email = authUser.user.email ?? "";
  const requiredConfirmation = `DESACTIVER ${email.toLowerCase()}`;
  if (shouldSuspend && target.role === "admin" && confirmation !== requiredConfirmation) {
    return NextResponse.json({
      error: `Confirmation renforcée requise : saisissez exactement « ${requiredConfirmation} ».`,
    }, { status: 400 });
  }

  const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(
    userId,
    { ban_duration: shouldSuspend ? "876000h" : "none" },
  );
  if (authUpdateError) {
    console.error("Unable to update Auth ban status:", authUpdateError.message);
    return NextResponse.json({ error: "L’état de connexion du compte n’a pas pu être modifié." }, { status: 502 });
  }

  const { error: suspensionError } = await context.supabase.rpc("admin_set_user_suspension", {
    p_user_id: userId,
    p_suspended: shouldSuspend,
    p_reason: shouldSuspend ? reason : null,
    p_confirmation: confirmation,
  });
  if (suspensionError) {
    const { error: rollbackError } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: shouldSuspend ? previousBanDuration : "876000h",
    });
    if (rollbackError) {
      console.error("Unable to roll back Auth ban after suspension failure:", rollbackError.message);
    }

    console.error("Unable to update user suspension:", suspensionError.code, suspensionError.message);
    if (suspensionError.message.includes("dernier administrateur")) {
      return NextResponse.json({ error: suspensionError.message }, { status: 409 });
    }
    if (suspensionError.message.includes("propre compte")) {
      return NextResponse.json({ error: suspensionError.message }, { status: 403 });
    }
    return NextResponse.json({ error: "L’état du compte n’a pas pu être enregistré." }, { status: 500 });
  }

  return NextResponse.json({
    message: shouldSuspend ? "Le compte a été désactivé." : "Le compte a été réactivé.",
  });
}
