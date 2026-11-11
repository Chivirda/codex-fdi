import type { InspectorNode, UIMessage } from '../shared/contracts';
import { CSS_LIMITS, type FileMetadata, type ProjectSnapshot, type StylesProfile, type StyleMatch, type MatchingResult } from '../shared/project-styles';
import { formatMatchValue } from '../styles/numeric';
import type { StylesClient } from '../styles/client';

const emptySnapshot = (): ProjectSnapshot => ({ files: [], classes: 0, variables: 0, rules: 0, warnings: [] });
const validTokens = (tokens: string[]): boolean => tokens.length > 0 && tokens.every(token => token.length > 0 && !/[\s\u0000-\u001f\u007f]/u.test(token));

export function installProjectStyles(root: HTMLElement, client: StylesClient, send: (message: UIMessage) => void): {
  setSelection(node?: InspectorNode): void;
  restoreProfile(profile: StylesProfile): void;
} {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (text: string, action: () => void): HTMLButtonElement => {
    const result = make('button', 'project-button', text);
    result.type = 'button';
    result.addEventListener('click', action);
    return result;
  };
  const labelInput = (text: string, input: HTMLInputElement): HTMLLabelElement => {
    const label = make('label', 'project-field');
    label.append(make('span', '', text), input);
    return label;
  };
  const name = make('input', 'project-name');
  name.type = 'text'; name.value = 'Project styles'; name.maxLength = 80;
  const base = make('input', 'project-rem-base');
  base.type = 'number'; base.value = '10'; base.min = '0.001'; base.step = 'any';
  const fields = make('div', 'project-fields');
  fields.append(labelInput('Profile name', name), labelInput('Project rem base (px)', base));
  const picker = make('input', 'project-import');
  picker.type = 'file'; picker.accept = '.css'; picker.multiple = true;
  const fileLabel = labelInput('Import CSS files', picker);
  const status = make('p', 'project-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const stats = make('p', 'project-stats');
  const filesPanel = make('div', 'project-files');
  const matchesPanel = make('div', 'project-matches');
  const notices = make('ul', 'project-notices');
  const overridePanel = make('div', 'project-selected-override');
  let activeOverridePanel: HTMLElement | undefined;
  const refresh = button('Refresh imported files', () => enqueue(async () => {
    for (const [id, file] of retained) await importFile(id, file);
    applySnapshot((await client.request({ type: 'refresh' })).snapshot);
    status.textContent = 'Refreshed retained file snapshots. Reselect a file to load newer disk contents.';
  }));
  const help = make('p', 'project-help', 'CSS stays in this session. Saved files are reimport reminders only; the first successful import replaces these reminders. Default project rem base is 10 px and can be changed. Refresh rereads retained browser File snapshots; reselect files for newer disk contents. Up to 8 files, 2 MiB each, 4 MiB total.');
  root.replaceChildren(fields, fileLabel, refresh, status, stats, filesPanel, notices, overridePanel, matchesPanel, help);

  const retained = new Map<string, File>();
  const metadata = new Map<string, FileMetadata>();
  let snapshot = emptySnapshot();
  let selected: InspectorNode | undefined;
  let touched = false;
  let generation = 0;
  let pending = 0;
  let queue = Promise.resolve();
  let matchTimer: ReturnType<typeof setTimeout> | undefined;
  const remBase = (): number | undefined => {
    const value = Number(base.value);
    return base.value.trim() && Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const persist = (): void => {
    const value = remBase();
    if (value === undefined) return;
    send({ type: 'save-styles-profile', profile: { version: 1, name: name.value.slice(0, 80), remBase: value, files: [...metadata.values()] } });
  };
  const applySnapshot = (next: ProjectSnapshot): void => {
    snapshot = next;
    for (const file of next.files) metadata.set(file.id, file);
    // Keep restored placeholders useful without allowing metadata to exceed the import limit.
    const active = new Set(next.files.map(file => file.id));
    for (const id of metadata.keys()) {
      if (metadata.size <= CSS_LIMITS.files) break;
      if (!active.has(id)) metadata.delete(id);
    }
    renderFiles();
    persist();
  };
  const displayNotices = (messages: string[]): void => {
    notices.replaceChildren(...[...new Set(messages)].map(message => make('li', '', message)));
  };
  const copyControl = (text: string, payload: string, enabled: boolean, version: number): HTMLElement => {
    const group = make('div', 'project-copy-group');
    const feedback = make('span', 'project-copy-status'); feedback.setAttribute('role', 'status');
    let busy = false;
    const copy = button(text, () => {
      if (!enabled || busy || generation !== version) return;
      busy = true; copy.disabled = true;
      const run = async (): Promise<void> => {
        let copied = false;
        let fallback = false;
        try {
          if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(payload);
          copied = true;
        } catch {
          if (generation !== version || !copy.isConnected) return;
          fallback = true;
          const area = make('textarea'); area.value = payload;
          area.style.position = 'fixed'; area.style.opacity = '0';
          document.body.append(area);
          try { area.focus(); area.select(); copied = document.execCommand('copy'); } catch { copied = false; }
          finally { area.remove(); }
        } finally { busy = false; copy.disabled = !enabled; }
        if (generation !== version || !copy.isConnected) return;
        if (fallback) copy.focus();
        feedback.textContent = copied ? 'Copied.' : 'Copy unavailable. Select the text and copy it manually.';
      };
      void run();
    });
    copy.disabled = !enabled;
    if (!enabled) copy.title = 'This action requires an unambiguous class or available source CSS.';
    group.append(copy, feedback);
    return group;
  };
  const renderMatching = (matching: MatchingResult, version: number): void => {
    matchesPanel.replaceChildren();
    for (const match of matching.matches) renderMatch(match, version);
    if (matching.matches.length === 0) matchesPanel.append(make('p', 'project-help', 'No class matches found for this selection.'));
    if (matching.variables.length) {
      const variables = make('details', 'project-variable-suggestions');
      variables.append(make('summary', '', 'Safe variable suggestions'));
      for (const suggestion of matching.variables) {
        const row = make('div', 'project-variable');
        row.append(make('code', '', suggestion.declaration), copyControl('Copy declaration', suggestion.declaration, true, version));
        variables.append(row);
      }
      matchesPanel.append(variables);
    }
    displayNotices([...snapshot.warnings, ...matching.warnings]);
  };
  const renderMatch = (match: StyleMatch, version: number): void => {
    const details = make('details', 'project-match');
    details.append(make('summary', '', `${match.selector} · ${match.confidence} confidence · ${match.category} · score ${Number(match.score.toFixed(3))}`));
    const copyable = (match.copyable ?? match.category === 'safe') && validTokens(match.classes);
    details.append(copyControl('Copy class', match.classes.join(' '), copyable, version));
    details.append(copyControl('Copy matched CSS', match.matchedCSS ?? '', Boolean(match.matchedCSS), version));
    const selectedOverride = make('div', 'project-candidate-override');
    const choose = button('Use for override', () => {
      if (!copyable || generation !== version) return;
      activeOverridePanel?.replaceChildren();
      activeOverridePanel = selectedOverride;
      overridePanel.replaceChildren(make('p', 'project-help', `Override selector: ${match.selector}`));
      if (match.confidence === 'low' || match.category !== 'safe') selectedOverride.append(make('p', 'project-help', 'Selected by property similarity. Verify that this class applies on the page.'));
      if (!match.different.length) {
        selectedOverride.append(make('p', 'project-help', 'No override needed'));
        selectedOverride.append(make('p', 'project-help', 'No confirmed differences. Missing and incomparable properties are not added to the override.'));
      } else if (match.category !== 'safe') {
        selectedOverride.append(make('p', 'project-help', 'Override unavailable: conditional or unsupported rules require DOM/media context.'));
      } else if (match.override) {
        const preview = make('pre', 'project-override', match.override);
        selectedOverride.append(preview, copyControl('Copy override', match.override, true, version));
      } else {
        selectedOverride.append(make('p', 'project-help', match.different.length ? 'Override unavailable: differences cannot be safely resolved.' : 'No override needed'));
      }
    });
    choose.disabled = !copyable;
    details.append(choose, selectedOverride);
    for (const [label, properties] of [['Matched', match.matched], ['Different', match.different], ['Missing', match.missing], ['Incomparable', match.incomparable]] as const) {
      const group = make('details', 'project-property-group');
      group.append(make('summary', '', `${label} (${properties.length})`));
      const list = make('ul');
      for (const property of properties) list.append(make('li', '', `${property.property}: Figma ${formatMatchValue(property.figma)}; CSS ${formatMatchValue(property.css)}${property.reason ? ` · ${property.reason}` : ''}`));
      group.append(list); details.append(group);
    }
    const limits = make('ul', 'project-limitations');
    for (const limitation of match.limitations) limits.append(make('li', '', limitation));
    details.append(limits);
    const coverage = make('details', 'project-coverage'); coverage.append(make('summary', '', 'Coverage'));
    for (const [key, values] of Object.entries(match.coverage)) coverage.append(make('p', '', `${key}: ${values.join(', ') || '—'}`));
    details.append(coverage); matchesPanel.append(details);
  };
  const scheduleMatch = (): void => {
    clearTimeout(matchTimer);
    const version = generation;
    overridePanel.replaceChildren(make('p', 'project-help', 'Override selector: .inspected-element'), make('p', 'project-help', 'Select a candidate explicitly to inspect its override.'));
    matchesPanel.replaceChildren();
    if (remBase() === undefined) { matchesPanel.append(make('p', 'project-error', 'Enter a finite project rem base greater than 0.')); return; }
    if (!selected) { matchesPanel.append(make('p', 'project-help', 'Select one element to compare project classes.')); return; }
    if (!retained.size) { matchesPanel.append(make('p', 'project-help', 'Import CSS files to compare classes. Saved metadata requires reimport.')); return; }
    if (pending) return;
    const node = selected;
    const value = remBase()!;
    matchTimer = setTimeout(() => {
      matchesPanel.replaceChildren(make('p', 'project-help', 'Comparing project classes…'));
      void client.request({ type: 'match', node, remBase: value }).then(response => {
        if (generation === version && !pending && response.matching) renderMatching(response.matching, version);
      }).catch(error => { if (generation === version) matchesPanel.replaceChildren(make('p', 'project-error', error instanceof Error ? error.message : 'Unable to compare project classes.')); });
    }, 120);
  };
  function renderFiles(): void {
    filesPanel.replaceChildren();
    stats.textContent = `${snapshot.files.length} imported files · ${snapshot.classes} classes · ${snapshot.variables} variables · ${snapshot.rules} rules${metadata.size > retained.size ? ` · ${metadata.size - retained.size} saved files need reimport` : ''}`;
    refresh.disabled = pending > 0 || retained.size === 0;
    for (const file of metadata.values()) {
      const row = make('div', 'project-file');
      row.append(make('p', 'project-file-name', `${file.name} · ${file.bytes} bytes · ${file.rules} rules · ${file.classes} classes · ${file.variables} variables · ${new Date(file.importedAt).toLocaleString()}${retained.has(file.id) ? '' : ' · reimport required'}`));
      const replace = make('input', 'project-file-replace'); replace.type = 'file'; replace.accept = '.css'; replace.setAttribute('aria-label', `Replace ${file.name}`);
      replace.addEventListener('change', () => {
        const chosen = replace.files?.[0]; replace.value = '';
        if (chosen) { touched = true; enqueue(() => importFile(file.id, chosen)); }
      });
      const remove = button(`Remove ${file.name}`, () => { touched = true; enqueue(async () => {
        const response = await client.request({ type: 'remove', id: file.id });
        retained.delete(file.id); metadata.delete(file.id); applySnapshot(response.snapshot);
        status.textContent = `Removed ${file.name}.`;
      }); });
      row.append(replace, remove); filesPanel.append(row);
    }
    displayNotices(snapshot.warnings);
  }
  async function importFile(id: string, file: File): Promise<void> {
    if (!/\.css$/i.test(file.name)) throw new Error('Choose a .css file.');
    const others = [...retained.entries()].filter(([key]) => key !== id);
    if (file.size > CSS_LIMITS.fileBytes || others.reduce((sum, [, existing]) => sum + existing.size, file.size) > CSS_LIMITS.totalBytes || others.length >= CSS_LIMITS.files) {
      throw new Error('CSS import limit exceeded: 8 files, 2 MiB per file, 4 MiB total.');
    }
    status.textContent = `Importing ${file.name}…`;
    const response = await client.request({ type: 'import', id, name: file.name, css: await file.text() });
    if (!retained.size) metadata.clear();
    retained.set(id, file);
    applySnapshot(response.snapshot);
    status.textContent = `Imported ${file.name}. CSS is session-local.`;
  }
  function enqueue(operation: () => Promise<void>): void {
    generation++; pending++; clearTimeout(matchTimer); matchesPanel.replaceChildren(); renderFiles();
    queue = queue.then(operation).catch(error => {
      status.textContent = error instanceof Error ? error.message : 'Project styles operation failed.';
    }).then(() => { pending--; renderFiles(); if (!pending) scheduleMatch(); });
  }
  picker.addEventListener('change', () => {
    const files = Array.from(picker.files ?? []); picker.value = '';
    if (!files.length) return;
    touched = true;
    enqueue(async () => {
      const next = new Map(retained);
      for (const file of files) next.set(file.name, file);
      if (next.size > CSS_LIMITS.files || [...next.values()].reduce((sum, file) => sum + file.size, 0) > CSS_LIMITS.totalBytes || files.some(file => file.size > CSS_LIMITS.fileBytes || !/\.css$/i.test(file.name))) throw new Error('Choose up to 8 CSS files, 2 MiB each and 4 MiB total.');
      for (const file of files) await importFile(file.name, file);
    });
  });
  name.addEventListener('input', () => { touched = true; persist(); });
  base.addEventListener('input', () => { touched = true; generation++; persist(); scheduleMatch(); });
  renderFiles(); scheduleMatch();
  send({ type: 'styles-profile-ready' });
  return {
    setSelection(node): void { selected = node; generation++; scheduleMatch(); },
    restoreProfile(profile): void {
      if (touched || retained.size) return;
      name.value = profile.name; base.value = String(profile.remBase);
      metadata.clear(); for (const file of profile.files) metadata.set(file.id, file);
      generation++; renderFiles(); scheduleMatch();
    },
  };
}
