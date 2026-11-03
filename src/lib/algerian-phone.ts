export function normalizeAlgerianPhone(value: string) {
  const compact = value.replace(/[\s()-]/g, "");
  if (/^0[567]\d{8}$/.test(compact)) return `+213${compact.slice(1)}`;
  if (/^\+213[567]\d{8}$/.test(compact)) return compact;
  return null;
}
