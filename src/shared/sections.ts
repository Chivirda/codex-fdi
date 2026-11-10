export type SectionId = 'properties' | 'spacing' | 'css';
/** true = expanded. Presentation preference only; never changes inspector data. */
export type SectionState = Record<SectionId, boolean>;
export const DEFAULT_SECTIONS: Readonly<SectionState> = { properties: true, spacing: true, css: true };
export function parseSectionState(value: unknown): SectionState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const state = value as Partial<SectionState>;
  if (typeof state.properties !== 'boolean' || typeof state.spacing !== 'boolean' || typeof state.css !== 'boolean') return undefined;
  return { properties: state.properties, spacing: state.spacing, css: state.css };
}
