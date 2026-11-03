import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { sendTransactionalEmail } from "@/lib/transactional-email";

type ExpiringNotification = {
  notification_id: string;
  email: string;
  first_name: string;
  plan_name: string;
  expires_at: string;
};

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "La tâche de notification n’est pas configurée." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Expiring entitlement email cron is not configured: Supabase service credentials are missing.");
    return NextResponse.json({ error: "La connexion serveur à Supabase n’est pas configurée." }, { status: 503 });
  }

  const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.rpc("claim_expiring_entitlement_notifications");
  if (error) {
    console.error("Unable to claim expiring entitlement notifications:", error.code, error.message);
    return NextResponse.json({ error: "Les notifications d’expiration n’ont pas pu être préparées." }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  for (const notification of (data ?? []) as ExpiringNotification[]) {
    const outcome = await sendTransactionalEmail({
      kind: "access-expiring",
      to: notification.email,
      firstName: notification.first_name,
      planName: notification.plan_name,
      expiresAt: notification.expires_at,
    });
    const { error: updateError } = await supabase.rpc("finish_entitlement_notification", {
      p_notification_id: notification.notification_id,
      p_sent: outcome.sent,
      p_error: outcome.error ?? null,
    });
    if (updateError) {
      console.error("Unable to record entitlement notification result:", updateError.code, updateError.message);
      failed += 1;
    } else if (outcome.sent) {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return NextResponse.json({ claimed: data?.length ?? 0, sent, failed });
}
