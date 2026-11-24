import { HTML_TAGS, validBlockClass, validElementName, type ExportOptions, type HTMLTag, type StructurePlan } from '../shared/export';
import { parseTreeSnapshot, type TreeSnapshot } from '../shared/tree';
const containers = new Set(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET', 'SECTION']);
const phrasing = new Set<HTMLTag>(['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button']);
const inline = new Set<HTMLTag>(['span', 'button']);
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const slug = (value: string, fallback: string) => value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/g, '') || fallback.toLowerCase().replace(/[^a-z0-9]/g, '') || 'element';

/** Safe proposals, not recovered HTML semantics. Choices remain explicit user input. */
export function createStructurePlan(snapshot: TreeSnapshot, options: ExportOptions): StructurePlan {
  const plan: StructurePlan = { identity: { requestId: snapshot.requestId, rootId: snapshot.rootId,
    revision: snapshot.revision, documentSessionId: snapshot.documentSessionId }, blockClass: typeof options.blockClass === 'string' ? options.blockClass.trim() : '', rootId: snapshot.rootId,
    nodes: [], excludedIds: [], diagnostics: [], blocked: false };
  const warn = (id: string, code: string, message: string) => plan.diagnostics.push({ nodeId: id, code, message });
  const block = (id: string, message: string) => { plan.blocked = true; warn(id, 'INVALID_EXPORT', message); };
  if (!parseTreeSnapshot(snapshot)) { block(snapshot.rootId, 'Snapshot is invalid. Inspect subtree again.'); return plan; }
  if (!validBlockClass(plan.blockClass)) { block(snapshot.rootId, 'Enter one CSS block class without a dot (letters, digits, underscore or hyphen; start with a letter or underscore).'); return plan; }
  for (const choices of [options.tags, options.elements]) if (choices) for (const id of Object.keys(choices)) {
    if (!own(snapshot.nodes, id)) block(id, 'A choice refers to a node outside this snapshot.');
  }
  const byId = new Map<string, typeof plan.nodes[number]>(), excluded = new Set<string>(), used = new Set([plan.blockClass]);
  for (const id of snapshot.sourceOrder) {
    const node = snapshot.nodes[id]!;
    if (node.parentId && excluded.has(node.parentId)) { excluded.add(id); plan.excludedIds.push(id); continue; }
    const data = node.inspector, parent = node.parentId ? byId.get(node.parentId) : undefined;
    const elementOverride = options.elements && own(options.elements, id) ? options.elements[id] : undefined;
    if (elementOverride !== undefined && !validElementName(elementOverride)) block(id, 'BEM element names use letters/digits and single hyphens, up to 48 characters.');
    const element = elementOverride ?? slug(data?.name ?? '', data?.type ?? 'element');
    let className = id === snapshot.rootId ? plan.blockClass : `${plan.blockClass}__${element}`;
    if (id !== snapshot.rootId) { let suffix = 2; const base = className; while (used.has(className)) className = `${base}-${suffix++}`; used.add(className); }
    let tag: HTMLTag = data?.type === 'TEXT' ? (parent && phrasing.has(parent.tag) ? 'span' : 'p')
      : parent && phrasing.has(parent.tag) ? 'span' : 'div';
    const explicit = options.tags && own(options.tags, id) ? options.tags[id] : undefined;
    if (explicit !== undefined) {
      if (!HTML_TAGS.includes(explicit)) block(id, 'Unsupported HTML tag.'); else tag = explicit;
    }
    if (parent && phrasing.has(parent.tag) && !inline.has(tag)) block(id, `${parent.tag} cannot contain ${tag}; choose a phrasing tag such as span.`);
    // A button anywhere inside another button would be invalid, even through spans.
    if (tag === 'button') {
      let ancestor = parent;
      while (ancestor) { if (ancestor.tag === 'button') { block(id, 'Buttons cannot be nested.'); break; } ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined; }
    }
    const item: typeof plan.nodes[number] = { id, parentId: node.parentId, childIds: [], tag, className };
    const unsupported = !data || !containers.has(data.type) && !['TEXT', 'RECTANGLE'].includes(data.type) || node.branch.status === 'unsupported';
    if (node.visible === false || unsupported || node.branch.status === 'omitted') {
      item.placeholder = node.visible === false ? 'Hidden branch omitted' : 'Unsupported or unavailable source omitted';
      excluded.add(id); plan.excludedIds.push(id); warn(id, 'SOURCE_EXCLUDED', item.placeholder);
    } else if (data.type === 'TEXT') {
      if (node.childIds.length || typeof data.characters !== 'string') block(id, 'Text content is unavailable or contains unsupported children.');
      else if (/[\u0000\ud800-\udfff]/u.test(data.characters.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) block(id, 'Text contains invalid Unicode that HTML cannot preserve.');
      else item.text = data.characters;
    } else if (containers.has(data.type) && !data.layout) warn(id, 'LAYOUT_UNCONFIRMED', 'Manual layout uses natural HTML flow; source positions, overlap and responsive behavior are not inferred.');
    if (node.branch.status === 'truncated') warn(id, 'PARTIAL_BRANCH', `Branch/properties truncated (${node.branch.reason}); missing content is not generated.`);
    if (data?.warnings.length) warn(id, 'SOURCE_WARNINGS', data.warnings.join(' '));
    const local = node.geometry?.parentLocalTransform;
    if (local && (Math.abs(local[0][0] - 1) > 1e-8 || Math.abs(local[1][1] - 1) > 1e-8 || Math.abs(local[0][1]) > 1e-8 || Math.abs(local[1][0]) > 1e-8)) warn(id, 'TRANSFORM_UNSUPPORTED', 'Rotation, scaling, reflection and skew are not exported.');
    byId.set(id, item); plan.nodes.push(item); if (parent) parent.childIds.push(id);
  }
  for (const diagnostic of snapshot.diagnostics) warn(diagnostic.nodeId, diagnostic.code, diagnostic.message);
  warn(snapshot.rootId, 'DRAFT_ONLY', 'Draft structure and fixed-size CSS. Class names do not prove imported CSS applies; review tags, layout and exclusions.');
  return plan;
}
