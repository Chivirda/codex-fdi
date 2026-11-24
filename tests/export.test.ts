import { describe, expect, it } from 'vitest';
import { generateDraft } from '../src/export/serialize';
import { generateDeclarations } from '../src/css/generate';
import { minimalTree, treeNode } from './fixtures/tree/minimal';
function textTree(text = 'Hello') { const tree = minimalTree(); tree.nodes.child!.inspector = { id: 'child', name: 'Text', type: 'TEXT', characters: text,
  width: 80, height: 20, typography: { fontFamily: 'Averta CY', fontSize: 16 }, warnings: [] }; return tree; }
describe('bounded HTML/CSS draft serialization', () => {
  it('escapes HTML and preserves exact whitespace/newlines/Unicode without synthetic inner indentation', () => {
    const result = generateDraft(textTree('  A & B\n世界 👋 <script>"x"</script>\r '), { blockClass: 'card' });
    expect(result.status).toBe('draft');
    expect(result.html).toContain('<p class="card__text">  A &amp; B\n世界 👋 &lt;script&gt;&quot;x&quot;&lt;/script&gt;&#13; </p>');
    expect(result.css).toContain('white-space: pre-wrap;'); expect(result.html).not.toContain('<script>');
  });
  it('serializes empty TEXT and explicit button tags with type=button', () => {
    const result = generateDraft(textTree(''), { blockClass: 'button', tags: { root: 'button' } });
    expect(result.html).toContain('<button class="button" type="button">');
    expect(result.html).toContain('<span class="button__text"></span>');
    expect(result.css).toContain('appearance: none;'); expect(result.css).toContain('display: inline-block;');
  });
  it('reuses every generator declaration and preserves explicit nested flex in scoped rules', () => {
    const tree = textTree(); tree.nodes.root!.inspector!.layout = { direction: 'row', gap: 8, padding: [1, 2, 3, 4] };
    const result = generateDraft(tree, { blockClass: 'card' });
    for (const node of Object.values(tree.nodes)) for (const d of generateDeclarations(node.inspector!)) expect(result.css).toContain(d.declaration);
    expect(result.css).toContain('.card .card__text {'); expect(result.css).toContain('display: flex;'); expect(result.css).not.toContain('position: absolute');
  });
  it('keeps partial branch markers in the copied markup and exclusions explicit', () => {
    const tree = textTree(); tree.nodes.root!.branch = { status: 'truncated', reason: 'node-limit', omittedChildren: 5 }; tree.completeness = 'partial';
    tree.diagnostics = [{ code: 'TREE_TRUNCATED', severity: 'warning', nodeId: 'root', revision: 2, message: '5 children omitted' }];
    const result = generateDraft(tree, { blockClass: 'card' });
    expect(result.html).toContain('Branch truncated: omitted content is not generated.'); expect(result.plan.diagnostics.some(d => d.code === 'PARTIAL_BRANCH')).toBe(true);
  });
  it('omits hidden descendants even when they were included for inspection', () => {
    const tree = textTree(); tree.includeHidden = true; tree.nodes.child!.visible = false;
    const result = generateDraft(tree, { blockClass: 'card' });
    expect(result.plan.excludedIds).toEqual(['child']); expect(result.html).not.toContain('Hello'); expect(result.css).not.toContain('.card__text');
    expect(result.html).toContain('Source omitted: see export diagnostics.');
  });
  it('blocks invalid snapshot, semantic decisions and unrepresentable Unicode', () => {
    const tree = textTree(); tree.nodes.root!.childIds.push('unknown');
    expect(generateDraft(tree, { blockClass: 'card' })).toMatchObject({ status: 'blocked', html: '', css: '' });
    expect(generateDraft(textTree(), { blockClass: 'card', tags: { root: 'p', child: 'h1' } }).status).toBe('blocked');
    for (const content of ['\u0000', '\ud800']) expect(generateDraft(textTree(content), { blockClass: 'card' }).status).toBe('blocked');
  });
  it('does not include source names/IDs inside executable comments and emits no asset URLs', () => {
    const tree = textTree(); tree.nodes.child!.inspector!.name = '--><img src=https://evil.test>'; tree.nodes.child!.inspector!.type = 'VECTOR';
    const result = generateDraft(tree, { blockClass: 'card' });
    expect(result.html).not.toContain('evil.test'); expect(result.html).not.toContain('<img'); expect(result.css).not.toContain('url(');
  });
  it('bounds output after HTML escaping, without returning a silently truncated fragment', () => {
    const tree = minimalTree(); tree.nodes = { root: treeNode('root') }; tree.sourceOrder = ['root'];
    for (let i = 0; i < 8; i++) { const id = `text${i}`; tree.nodes[id] = treeNode(id, 'root'); tree.nodes[id]!.inspector = { id, name: id, type: 'TEXT', characters: '&'.repeat(64000), warnings: [] }; tree.nodes.root!.childIds.push(id); tree.sourceOrder.push(id); }
    const result = generateDraft(tree, { blockClass: 'card' });
    expect(result).toMatchObject({ status: 'blocked', html: '', css: '' }); expect(result.plan.diagnostics.some(d => d.code === 'EXPORT_LIMIT')).toBe(true);
  });
});
