import "server-only";

export const mockAnswerKey: Record<string, { section: "CO" | "SL" | "CE"; correctIndex: number; points: number }> = {
  "co-1": { section: "CO", correctIndex: 1, points: 10 },
  "co-2": { section: "CO", correctIndex: 2, points: 12 },
  "co-3": { section: "CO", correctIndex: 2, points: 12 },
  "sl-1": { section: "SL", correctIndex: 2, points: 15 },
  "sl-2": { section: "SL", correctIndex: 0, points: 15 },
  "ce-1": { section: "CE", correctIndex: 1, points: 20 },
  "ce-2": { section: "CE", correctIndex: 1, points: 18 },
} as const;
