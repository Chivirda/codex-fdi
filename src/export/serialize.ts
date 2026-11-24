import { generateDeclarations } from '../css/generate';
import type { ExportDraft, ExportOptions, StructurePlan } from '../shared/export';
import { createStructurePlan } from '../structure/plan';
import { TREE_LIMITS, type TreeSnapshot } from '../shared/tree';
export const escapeHTML = (value: string): string => value.replace(/[&<>"'\r]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\r': '&#13;' })[char]!);
/** Only text output. Never mount this markup or generated CSS into the plugin DOM. */
function serializeHTML(plan: StructurePlan, snapshot: TreeSnapshot): string {
  const byId = new Map(plan.nodes.map(node => [node.id, node]));
  const lines = ['<!-- Design Inspector draft: review semantics, layout and excluded content. -->'];
  const pending: { id: string; depth: number; close: boolean; omitted?: boolean }[] = [{ id: plan.rootId, depth: 0, close: false }];
  while (pending.length) {
    const task = pending.pop()!;
    const pad = '  '.repeat(task.depth);
    if (task.omitted) { lines.push(`${pad}<!-- Branch truncated: omitted content is not generated. -->`); continue; }
    const node = byId.get(task.id); if (!node) continue;
    if (task.close) { lines.push(`${pad}</${node.tag}>`); continue; }
    if (node.placeholder) { lines.push(`${pad}<!-- Source omitted: see export diagnostics. -->`); continue; }
    const open = `<${node.tag} class="${escapeHTML(node.className)}"${node.tag === 'button' ? ' type="button"' : ''}>`;
    if (node.text !== undefined) { lines.push(`${pad}${open}${escapeHTML(node.text)}</${node.tag}>`); continue; }
    lines.push(`${pad}${open}`); pending.push({ ...task, close: true });
    if (snapshot.nodes[node.id]?.branch.status === 'truncated') {
      // Constant text only: no untrusted source names/IDs inside HTML comments.
      pending.push({ id: '', depth: task.depth + 1, close: false, omitted: true });
    }
    for (let i = node.childIds.length - 1; i >= 0; i--) pending.push({ id: node.childIds[i]!, depth: task.depth + 1, close: false });
  }
  return lines.join('\n');
}
export function generateDraft(snapshot: TreeSnapshot, options: ExportOptions): ExportDraft {
  const plan = createStructurePlan(snapshot, options);
  if (plan.blocked) return { status: 'blocked', html: '', css: '', plan };
  let html = serializeHTML(plan, snapshot);
  const rules: string[] = [];
  for (const node of plan.nodes) {
    if (node.placeholder) continue;
    const inspector = snapshot.nodes[node.id]!.inspector!;
    const declarations: string[] = [];
    if (node.tag === 'button') declarations.push('appearance: none;', 'border: 0;', 'padding: 0;', 'background: transparent;', 'font: inherit;', 'color: inherit;');
    declarations.push('margin: 0;');
    if (node.tag === 'span') declarations.push('display: inline-block;');
    if (node.text !== undefined) declarations.push('white-space: pre-wrap;');
    declarations.push(...generateDeclarations(inspector).map(d => d.declaration));
    const selector = node.id === snapshot.rootId ? `.${plan.blockClass}` : `.${plan.blockClass} .${node.className}`;
    rules.push(`${selector} {\n${declarations.map(d => `  ${d}`).join('\n')}\n}`);
  }
  let css = rules.join('\n\n');
  let bytes = 0;
  for (const char of html + css) { const code = char.codePointAt(0)!; bytes += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4; }
  if (bytes > TREE_LIMITS.maxMessageBytes) { plan.blocked = true; plan.diagnostics.push({ code: 'EXPORT_LIMIT', nodeId: plan.rootId, message: 'HTML/CSS exceeds the 2 MiB output budget.' }); html = ''; css = ''; }
  return { status: plan.blocked ? 'blocked' : 'draft', html, css, plan };
}
