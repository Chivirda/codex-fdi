import { describe, expect, it } from 'vitest';
import { createStructurePlan } from '../src/structure/plan';
import { minimalTree, treeNode } from './fixtures/tree/minimal';
import type { HTMLTag } from '../src/shared/export';
function textTree() { const data = minimalTree(); data.nodes.child!.inspector = { id: 'child', name: 'Text', type: 'TEXT', characters: 'Hello', warnings: [] }; return data; }
describe('explicit HTML structure and BEM names', () => {
  it('proposes div/p from node types, never headings/buttons from layer names', () => {
    const data = textTree(); data.nodes.root!.inspector!.name = 'button'; data.nodes.child!.inspector!.name = 'H1 title';
    const plan = createStructurePlan(data, { blockClass: 'cookie-banner' });
    expect(plan.nodes.map(n => [n.tag, n.className])).toEqual([['div', 'cookie-banner'], ['p', 'cookie-banner__h1-title']]);
  });
  it('uses one block namespace at every depth, disambiguates duplicates and allows explicit element names', () => {
    const data = textTree(); data.nodes.root!.childIds.push('a'); data.nodes.a = treeNode('a', 'root', ['b']); data.nodes.a.inspector!.name = 'Text';
    data.nodes.b = treeNode('b', 'a'); data.nodes.b.inspector!.name = 'Text'; data.sourceOrder.push('a', 'b');
    const plan = createStructurePlan(data, { blockClass: 'cookie-banner', elements: { b: 'button-label' } });
    expect(plan.nodes.map(n => n.className)).toEqual(['cookie-banner', 'cookie-banner__text', 'cookie-banner__text-2', 'cookie-banner__button-label']);
    expect(new Set(plan.nodes.map(n => n.className)).size).toBe(4);
  });
  it('chooses span descendants in an explicitly selected button and blocks nested buttons', () => {
    const data = textTree();
    expect(createStructurePlan(data, { blockClass: 'btn', tags: { root: 'button' } }).nodes.map(n => n.tag)).toEqual(['button', 'span']);
    expect(createStructurePlan(data, { blockClass: 'btn', tags: { root: 'button', child: 'button' } }).blocked).toBe(true);
    expect(createStructurePlan(data, { blockClass: 'btn', tags: { root: 'button', child: 'h1' } }).blocked).toBe(true);
  });
  it('supports explicit headings/semantic containers but rejects arbitrary tag injection', () => {
    const data = textTree();
    expect(createStructurePlan(data, { blockClass: 'hero', tags: { root: 'header', child: 'h1' } }).nodes.map(n => n.tag)).toEqual(['header', 'h1']);
    expect(createStructurePlan(data, { blockClass: 'hero', tags: { root: 'script' as HTMLTag } }).blocked).toBe(true);
  });
  it.each(['.card', 'a b', '1card', 'x"onclick="evil', 'x{}', 'x'.repeat(81)])('rejects an unsafe/ambiguous base class: %s', blockClass => {
    expect(createStructurePlan(textTree(), { blockClass }).blocked).toBe(true);
  });
  it('rejects stale node decisions and invalid BEM element identifiers', () => {
    expect(createStructurePlan(textTree(), { blockClass: 'card', tags: { removed: 'div' } }).blocked).toBe(true);
    expect(createStructurePlan(textTree(), { blockClass: 'card', elements: { child: 'text onclick' } }).blocked).toBe(true);
  });
  it('records hidden/unsupported exclusions without dropping source mapping silently', () => {
    const data = minimalTree(); data.nodes.child!.inspector!.type = 'VECTOR'; data.nodes.child!.branch = { status: 'unsupported', reason: 'shape', omittedChildren: null };
    data.completeness = 'partial'; data.diagnostics = [{ code: 'NODE_UNSUPPORTED', severity: 'warning', nodeId: 'child', revision: 2, message: 'Vector' }];
    const plan = createStructurePlan(data, { blockClass: 'card' });
    expect(plan.excludedIds).toEqual(['child']); expect(plan.nodes[1]?.placeholder).toBeTruthy(); expect(plan.blocked).toBe(false);
  });
  it('does not infer positions/absolute layout and is deterministic without mutating input', () => {
    const data = textTree(), before = JSON.stringify(data), options = { blockClass: 'card', elements: { child: 'text' } };
    const first = createStructurePlan(data, options);
    expect(first).toEqual(createStructurePlan(data, options)); expect(JSON.stringify(data)).toBe(before);
    expect(first.diagnostics.some(d => d.code === 'LAYOUT_UNCONFIRMED')).toBe(true);
  });
});
