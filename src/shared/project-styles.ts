import type { InspectorNode } from './contracts';

export const CSS_LIMITS = { fileBytes: 2 * 1024 * 1024, totalBytes: 4 * 1024 * 1024, files: 8, rules: 12000, declarations: 60000 } as const;
export interface SourceLocation { fileId: string; fileName: string; line: number; column: number }
export interface ImportedDeclaration {
  property: string; value: string; important: boolean; order: number;
  normalized?: string; reason?: string;
}
export interface SelectorInfo {
  text: string; classes: string[]; kind: 'simple' | 'conditional' | 'unsupported';
  specificity: [number, number, number]; reason?: string; simple?: boolean;
}
export interface ImportedRule {
  selectors: SelectorInfo[]; declarations: ImportedDeclaration[];
  source: SourceLocation; order: number; conditions: string[];
}
export interface CSSVariable {
  name: string; value: string; important: boolean; selectors: string[];
  source: SourceLocation; order: number; conditions: string[];
}
export interface ParsedStylesheet {
  id: string; name: string; bytes: number; importedAt: number;
  rules: ImportedRule[]; variables: CSSVariable[]; warnings: string[];
  registeredVariables?: string[];
  unresolvedImports?: boolean;
}
export interface NormalizationOptions { remBase?: number; variables?: Record<string, string> }
export interface IndexedClass {
  rules?: ImportedRule[]; copyable?: boolean;
  className: string; selectors: string[]; declarations: ImportedDeclaration[];
  category: 'safe' | 'conditional' | 'unsupported'; limitations: string[]; sources: SourceLocation[];
}
export interface StyleIndex {
  classes: IndexedClass[]; variables: Record<string, string>; warnings: string[];
  ruleCount: number; variableCount: number;
}
export interface MatchProperty { property: string; figma?: string; css?: string; reason?: string }
export interface StyleMatch {
  classes: string[]; selector: string; category: 'safe' | 'conditional' | 'unsupported';
  score: number; confidence: 'high' | 'medium' | 'low';
  matched: MatchProperty[]; different: MatchProperty[]; missing: MatchProperty[]; incomparable: MatchProperty[];
  limitations: string[]; coverage: Record<string, string[]>; override?: string;
  copyable?: boolean; matchedCSS?: string;
}
export interface VariableSuggestion { property: string; variable: string; declaration: string; value: string }
export interface MatchingResult { matches: StyleMatch[]; variables: VariableSuggestion[]; warnings: string[] }
export interface FileMetadata { id: string; name: string; bytes: number; importedAt: number; rules: number; classes: number; variables: number }
/** Only metadata/settings persist. CSS and its index are session-local and require reimport. */
export interface StylesProfile { version: 1; name: string; remBase: number; files: FileMetadata[] }
export interface ProjectSnapshot { files: FileMetadata[]; classes: number; variables: number; rules: number; warnings: string[] }
export type StylesCommand =
  | { type: 'import'; id: string; name: string; css: string }
  | { type: 'remove'; id: string }
  | { type: 'refresh' }
  | { type: 'match'; node: InspectorNode; remBase: number }
  | { type: 'reset' };
export interface StylesResponse { snapshot: ProjectSnapshot; matching?: MatchingResult }
export interface StylesRequest { id: number; command: StylesCommand }
export type StylesReply = { id: number; response: StylesResponse } | { id: number; error: string };
