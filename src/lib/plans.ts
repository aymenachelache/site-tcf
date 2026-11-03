import { paymentPlans } from "@/lib/mock-data";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/utils/supabase/server";

export type Plan = {
  id: string;
  name: string;
  price: number;
  description: string;
  duration: string;
  highlighted: boolean;
  sortOrder: number;
  objective: string;
  badge: string;
  features: string[];
  examType: string;
  examCredits: number | null;
  accessDays: number | null;
};

export type PlanCatalogResult = {
  plans: Plan[];
  unavailable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function readBoolean(row: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => row[key] === true);
}

function readFeatures(row: Record<string, unknown>): string[] {
  const value = row.features;
  if (!Array.isArray(value)) return [];
  return value.filter((feature): feature is string => typeof feature === "string" && Boolean(feature.trim()));
}

function formatDuration(row: Record<string, unknown>): string {
  const credits = readNumber(row, ["exam_credits", "exam_count", "credits", "exams_count"]);
  const days = readNumber(row, ["access_days", "duration_days", "days"]);
  const parts: string[] = [];
  if (credits !== null) parts.push(`${credits} simulation${credits === 1 ? "" : "s"}`);
  if (days !== null) parts.push(`valables ${days} jour${days === 1 ? "" : "s"}`);
  if (parts.length) return parts.join(" · ");

  return readString(row, ["duration", "duration_label", "period"]) ?? "Accès selon l’offre";
}

export async function getPlans(): Promise<PlanCatalogResult> {
  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV === "production") {
      console.error("Pricing plans are unavailable because Supabase is not configured.");
      return { plans: [], unavailable: true };
    }

    return {
      plans: paymentPlans.map((plan, sortOrder) => ({
        id: plan.name,
        name: plan.name,
        price: plan.price,
        description: plan.description,
        duration: plan.duration,
        highlighted: sortOrder === 1,
        sortOrder,
        objective: "",
        badge: sortOrder === 1 ? "Le plus choisi" : "",
        features: [],
        examType: "TCF Tout Public",
        examCredits: null,
        accessDays: null,
      })),
      unavailable: false,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, description, price_dzd, exam_ids, exam_credits, access_days, active, sort_order, objective, badge, features, exam_type")
    .order("sort_order");
  if (error) {
    console.error("Unable to load pricing plans from Supabase:", error.message);
    return { plans: [], unavailable: true };
  }

  const plans = (Array.isArray(data) ? data : [])
    .filter(isRecord)
    .filter((row) => row.active !== false)
    .flatMap((row, index): Plan[] => {
      const name = readString(row, ["name", "title", "label"]);
      const price = readNumber(row, ["price_dzd", "price", "amount", "price_da"]);
      if (!name || price === null || price < 0) {
        console.error(`Ignoring invalid plan row at index ${index}: expected a name and non-negative price.`);
        return [];
      }

      const badge = readString(row, ["badge"]) ?? "";
      return [{
        id: readString(row, ["id", "slug"]) ?? name,
        name,
        price,
        description: readString(row, ["description", "subtitle"]) ?? "",
        duration: formatDuration(row),
        highlighted: Boolean(badge) || readBoolean(row, ["featured", "is_featured", "is_popular"]),
        sortOrder: readNumber(row, ["sort_order", "display_order", "position"]) ?? index,
        objective: readString(row, ["objective"]) ?? "",
        badge,
        features: readFeatures(row),
        examType: readString(row, ["exam_type"]) ?? "TCF Tout Public",
        examCredits: readNumber(row, ["exam_credits"]),
        accessDays: readNumber(row, ["access_days"]),
      }];
    })
    .sort((first, second) => first.sortOrder - second.sortOrder);

  if (plans.length === 0) {
    console.error("No active pricing plans are available in Supabase.");
    return { plans: [], unavailable: true };
  }

  return { plans, unavailable: false };
}
