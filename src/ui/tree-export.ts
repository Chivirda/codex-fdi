import { generateDraft } from '../export/serialize';
import { HTML_TAGS, validBlockClass, validElementName, type HTMLTag, type ExportDraft } from '../shared/export';
import type { TreeSnapshot } from '../shared/tree';

export function installTreeExport(root: HTMLElement): {
  setRoot(id?: string): void; setSnapshot(snapshot?: TreeSnapshot): void; selectNode(id?: string): void;
  useBlockClass(className: string, rootId: string): boolean;
} {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element;
  };
  const block = make('input', 'tree-block-class'); block.type = 'text'; block.value = 'component'; block.maxLength = 80;
  const base = make('label', 'tree-export-field'); base.append(make('span', '', 'Block class (without a dot)'), block);
  const tag = make('select', 'tree-export-tag');
  for (const value of ['auto', ...HTML_TAGS]) { const option = make('option', '', value === 'auto' ? 'Suggested tag' : value); option.value = value; tag.append(option); }
  const tagLabel = make('label', 'tree-export-field'); tagLabel.append(make('span', '', 'Tag for selected tree node'), tag);
  const elementName = make('input', 'tree-element-name'); elementName.type = 'text'; elementName.maxLength = 48;
  const elementLabel = make('label', 'tree-export-field'); elementLabel.append(make('span', '', 'BEM element (empty = layer name)'), elementName);
  const nodeName = make('p', 'tree-help');
  const mappedClass = make('p', 'tree-export-mapping');
  const status = make('p', 'tree-export-status'); status.id = 'tree-export-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  block.setAttribute('aria-describedby', 'tree-export-status');
  elementName.setAttribute('aria-describedby', 'tree-export-status');
  const note = make('p', 'tree-help', 'Draft only: tags are proposals; generated CSS uses current fixed sizes. Imported classes are names only, not confirmed style bindings. Unsupported content stays explicit.');
  const htmlCopy = make('button', '', 'Copy HTML draft'); htmlCopy.type = 'button';
  const cssCopy = make('button', '', 'Copy CSS draft'); cssCopy.type = 'button';
  const actions = make('div', 'tree-export-actions'); actions.append(htmlCopy, cssCopy);
  const html = make('pre', 'tree-export-html'); html.tabIndex = 0; html.setAttribute('aria-label', 'HTML draft source');
  const css = make('pre', 'tree-export-css'); css.tabIndex = 0; css.setAttribute('aria-label', 'CSS draft source');
  const htmlDetails = make('details', 'info-details'); htmlDetails.append(make('summary', '', 'HTML draft'), html);
  const cssDetails = make('details', 'info-details'); cssDetails.append(make('summary', '', 'CSS draft'), css);
  const warnings = make('details', 'info-details'); const warningsTitle = make('summary'); const warningsList = make('ul', 'tree-node-warnings'); warnings.append(warningsTitle, warningsList);
  root.replaceChildren(make('h3', '', 'Structure export · draft'), note, base, nodeName, tagLabel, elementLabel, mappedClass, actions, status, warnings, htmlDetails, cssDetails);
  let rootId: string | undefined, snapshot: TreeSnapshot | undefined, selectedId: string | undefined, draft: ExportDraft | undefined;
  let tags: Record<string, HTMLTag> = Object.create(null) as Record<string, HTMLTag>;
  let elements: Record<string, string> = Object.create(null) as Record<string, string>;
  let version = 0, copying = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const buttons = (): void => { htmlCopy.disabled = copying || !snapshot || draft?.status !== 'draft' || !draft.html; cssCopy.disabled = copying || !snapshot || draft?.status !== 'draft' || !draft.css; };
  const editor = (): void => {
    const node = selectedId ? snapshot?.nodes[selectedId] : undefined;
    tag.disabled = !node?.inspector; elementName.disabled = !node || selectedId === rootId;
    elementLabel.hidden = !node || selectedId === rootId;
    tag.value = selectedId && tags[selectedId] || 'auto'; elementName.value = selectedId && elements[selectedId] || '';
    nodeName.textContent = node ? `Editing: ${node.inspector?.name || node.id}` : 'Select a captured tree node to choose its tag and element name.';
    const mapping = draft?.plan.nodes.find(item => item.id === selectedId);
    mappedClass.textContent = mapping ? `${mapping.placeholder ? 'Excluded' : `<${mapping.tag}>`} · ${mapping.className}` : '';
  };
  const render = (): void => {
    clearTimeout(timer); timer = undefined; version++; draft = undefined;
    block.setAttribute('aria-invalid', String(!validBlockClass(block.value.trim())));
    elementName.setAttribute('aria-invalid', String(!!selectedId && !!elements[selectedId] && !validElementName(elements[selectedId]!)));
    warningsList.replaceChildren(); html.textContent = ''; css.textContent = '';
    if (!snapshot) { status.textContent = 'Inspect subtree to generate an HTML/CSS draft.'; warningsTitle.textContent = 'Draft warnings'; editor(); buttons(); return; }
    draft = generateDraft(snapshot, { blockClass: block.value, tags, elements });
    if (draft.status === 'blocked') warnings.open = true;
    html.textContent = draft.html; css.textContent = draft.css;
    status.textContent = draft.status === 'blocked' ? `Export blocked: ${draft.plan.diagnostics[0]?.message ?? 'Review diagnostics.'}`
      : `Draft: ${draft.plan.nodes.filter(node => !node.placeholder).length} HTML nodes · ${draft.plan.excludedIds.length} excluded. Review semantics, layout and warnings.`;
    warningsTitle.textContent = `${draft.plan.diagnostics.length} draft warnings / exclusions`;
    for (const diagnostic of draft.plan.diagnostics.slice(0, 80)) warningsList.append(make('li', '', `${diagnostic.nodeId} · ${diagnostic.code}: ${diagnostic.message}`));
    if (draft.plan.diagnostics.length > 80) warningsList.append(make('li', '', `${draft.plan.diagnostics.length - 80} additional warnings; inspect the source nodes.`));
    editor(); buttons();
  };
  const schedule = (): void => {
    version++; draft = undefined; buttons(); status.textContent = 'Updating draft…';
    clearTimeout(timer); timer = setTimeout(render, 120);
  };
  block.addEventListener('input', schedule);
  tag.addEventListener('change', () => {
    if (!selectedId || !snapshot?.nodes[selectedId]) return;
    if (tag.value === 'auto') delete tags[selectedId]; else tags[selectedId] = tag.value as HTMLTag;
    render();
  });
  elementName.addEventListener('input', () => {
    if (!selectedId || selectedId === rootId) return;
    if (elementName.value.trim()) elements[selectedId] = elementName.value.trim(); else delete elements[selectedId];
    schedule();
  });
  const copy = async (kind: 'html' | 'css', button: HTMLButtonElement): Promise<void> => {
    if (copying || button.disabled || draft?.status !== 'draft' || !snapshot) return;
    const text = draft[kind], epoch = version; copying = true; buttons();
    let ok = false, fallback = false;
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(text); ok = true; }
    catch {
      if (epoch !== version) return;
      fallback = true; const area = make('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area);
      try { area.focus(); area.select(); ok = document.execCommand('copy'); } catch { ok = false; } finally { area.remove(); }
    } finally { copying = false; buttons(); }
    if (epoch !== version) return;
    if (fallback) button.focus(); status.textContent = ok ? `${kind.toUpperCase()} draft copied.` : 'Copy unavailable. Select the draft source and copy it manually.';
  };
  htmlCopy.addEventListener('click', () => { void copy('html', htmlCopy); }); cssCopy.addEventListener('click', () => { void copy('css', cssCopy); });
  render();
  return {
    setRoot(id): void { if (id !== rootId) { rootId = id; block.value = 'component'; snapshot = undefined; selectedId = undefined; tags = Object.create(null) as Record<string, HTMLTag>; elements = Object.create(null) as Record<string, string>; render(); } },
    setSnapshot(data): void { snapshot = data?.rootId === rootId ? data : undefined; selectedId = snapshot?.rootId; tags = Object.create(null) as Record<string, HTMLTag>; elements = Object.create(null) as Record<string, string>; render(); },
    selectNode(id): void { selectedId = id; editor(); },
    useBlockClass(className, id): boolean {
      if (!rootId || id !== rootId || !validBlockClass(className)) return false;
      block.value = className; render(); status.textContent = `Using ${className} as the block name only. Review imported CSS before combining styles.`; return true;
    },
  };
}
