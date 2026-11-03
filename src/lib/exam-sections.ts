export const sectionKinds = ["CO", "SL", "CE", "EE", "EO"] as const;

export type SectionKind = (typeof sectionKinds)[number];

export const sectionPositions: Record<SectionKind, number> = {
  CO: 1,
  SL: 2,
  CE: 3,
  EE: 4,
  EO: 5,
};

export function sortSectionsByKind<T extends { kind: SectionKind }>(sections: T[]): T[] {
  return [...sections].sort(
    (left, right) => sectionPositions[left.kind] - sectionPositions[right.kind],
  );
}
