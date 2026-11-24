import type { TreeIdentity } from './tree';
export const HTML_TAGS = ['div', 'span', 'p', 'section', 'article', 'header', 'footer', 'nav', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button'] as const;
export type HTMLTag = typeof HTML_TAGS[number];
export interface ExportOptions { blockClass: string; tags?: Record<string, HTMLTag>; elements?: Record<string, string> }
export interface ExportDiagnostic { code: string; nodeId: string; message: string }
export interface StructureNode { id: string; parentId: string | null; childIds: string[]; tag: HTMLTag; className: string;
  text?: string; placeholder?: string }
export interface StructurePlan { identity: TreeIdentity; blockClass: string; rootId: string; nodes: StructureNode[];
  excludedIds: string[]; diagnostics: ExportDiagnostic[]; blocked: boolean }
export interface ExportDraft { status: 'draft' | 'blocked'; html: string; css: string; plan: StructurePlan }
/** Deliberately conservative BEM identifiers. CSS utilities/selector syntax are not block names. */
export function validBlockClass(value: string): boolean { return typeof value === 'string' && value.length <= 80 && /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(value); }
export function validElementName(value: string): boolean { return typeof value === 'string' && value.length <= 48 && /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(value); }
