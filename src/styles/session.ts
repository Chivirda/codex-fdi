import { CSS_LIMITS } from '../shared/project-styles';
import type { ParsedStylesheet, ProjectSnapshot, StylesCommand, StylesResponse, StylesRequest, StylesReply } from '../shared/project-styles';
import { parseCSS } from './parser';
import { buildStyleIndex } from './index';
import { findMatches } from './match';

/** One local analysis session, shared by the Worker and the sandbox fallback. No raw CSS retained. */
export class StylesSession {
  private files = new Map<string, ParsedStylesheet>();
  private remBase = 10;
  private index = buildStyleIndex([]);
  private cachedSnapshot: ProjectSnapshot | undefined;
  private snapshot(): ProjectSnapshot {
    if (this.cachedSnapshot) return this.cachedSnapshot;
    this.cachedSnapshot = {
      files: [...this.files.values()].map(file => ({
        id: file.id, name: file.name, bytes: file.bytes, importedAt: file.importedAt, rules: file.rules.length,
        classes: new Set(file.rules.flatMap(rule => rule.selectors.flatMap(selector => selector.classes))).size,
        variables: new Set(file.variables.map(variable => variable.name)).size,
      })),
      classes: new Set(this.index.classes.map(item => item.className)).size,
      rules: this.index.ruleCount, variables: this.index.variableCount,
      warnings: [...new Set([...this.index.warnings, ...[...this.files.values()].flatMap(file => file.warnings)])].slice(0, 30),
    };
    return this.cachedSnapshot;
  }
  private rebuild(): void { this.index = buildStyleIndex([...this.files.values()], { remBase: this.remBase }); this.cachedSnapshot = undefined; }
  handle(command: StylesCommand): StylesResponse {
    if (!command || typeof command !== 'object') throw new Error('Invalid CSS analysis request.');
    if (command.type === 'import') {
      if (typeof command.id !== 'string' || !command.id || command.id.length > 255 || typeof command.name !== 'string'
        || !command.name || command.name.length > 255 || typeof command.css !== 'string') throw new Error('Invalid CSS file.');
      if (!this.files.has(command.id) && this.files.size >= CSS_LIMITS.files) throw new Error(`Import up to ${CSS_LIMITS.files} CSS files.`);
      if (command.css.length > CSS_LIMITS.fileBytes) throw new Error('CSS file exceeds the 2 MiB limit.');
      const parsed = parseCSS(command.css, { id: command.id, name: command.name });
      const others = [...this.files.values()].filter(file => file.id !== command.id);
      if (others.reduce((sum, file) => sum + file.bytes, parsed.bytes) > CSS_LIMITS.totalBytes) throw new Error('Total CSS exceeds 4 MiB.');
      if (others.reduce((sum, file) => sum + file.rules.length, parsed.rules.length) > CSS_LIMITS.rules) throw new Error('Total CSS rule limit exceeded.');
      const count = (file: ParsedStylesheet): number => file.rules.reduce((sum, rule) => sum + rule.declarations.length, 0);
      if (others.reduce((sum, file) => sum + count(file), count(parsed)) > CSS_LIMITS.declarations) throw new Error('Total CSS declaration limit exceeded.');
      // Build before committing: a failed replacement preserves the previous working session.
      const replacement = new Map(this.files);
      replacement.set(parsed.id, parsed);
      const nextIndex = buildStyleIndex([...replacement.values()], { remBase: this.remBase });
      this.files = replacement;
      this.index = nextIndex;
      this.cachedSnapshot = undefined;
    } else if (command.type === 'remove') {
      if (typeof command.id !== 'string') throw new Error('Invalid CSS file identifier.');
      this.files.delete(command.id);
      this.rebuild();
    } else if (command.type === 'reset') {
      this.files.clear(); this.rebuild();
    } else if (command.type === 'refresh') this.rebuild();
    else if (command.type === 'match') {
      if (!Number.isFinite(command.remBase) || command.remBase <= 0 || !command.node || typeof command.node !== 'object') throw new Error('Enter a finite rem base greater than zero.');
      if (this.remBase !== command.remBase) { this.remBase = command.remBase; this.rebuild(); }
      return { snapshot: this.snapshot(), matching: findMatches(command.node, this.index, { remBase: this.remBase }) };
    } else throw new Error('Unknown CSS analysis request.');
    return { snapshot: this.snapshot() };
  }
}

export function respondToStyles(session: StylesSession, request: StylesRequest): StylesReply {
  try { return { id: request.id, response: session.handle(request.command) }; }
  catch (error) { return { id: request.id, error: error instanceof Error ? error.message : 'CSS analysis failed.' }; }
}
