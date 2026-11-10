import type { UIMessage } from '../shared/contracts';
import { DEFAULT_SECTIONS, parseSectionState, type SectionId, type SectionState } from '../shared/sections';

const keys: SectionId[] = ['properties', 'spacing', 'css'];
const same = (a: SectionState, b: SectionState): boolean => keys.every(key => a[key] === b[key]);

/** Keep native details nodes intact; only their presentation state is synchronized. */
export function installSections(
  get: <T extends HTMLElement>(id: string) => T,
  send: (message: UIMessage) => void,
): (data: unknown) => void {
  const details = {
    properties: get<HTMLDetailsElement>('properties-section'),
    spacing: get<HTMLDetailsElement>('spacing-section'),
    css: get<HTMLDetailsElement>('css-section'),
  };
  let synced: SectionState = { ...DEFAULT_SECTIONS };
  let userChanged = false;
  const snapshot = (): SectionState => ({
    properties: details.properties.open,
    spacing: details.spacing.open,
    css: details.css.open,
  });
  const saveUserChange = (): boolean => {
    const current = snapshot();
    // Native toggle events are asynchronous and may be coalesced. Compare the
    // current full snapshot, not a temporary 'restoring' flag or event order.
    if (same(current, synced)) return false;
    userChanged = true;
    synced = current;
    send({ type: 'set-sections', sections: { ...current } });
    return true;
  };
  for (const key of keys) {
    details[key].open = DEFAULT_SECTIONS[key];
    details[key].addEventListener('toggle', saveUserChange);
  }
  send({ type: 'sections-ready' });

  return (data): void => {
    const restored = parseSectionState(data);
    if (!restored || userChanged) return;
    // The user may have changed .open before its queued native toggle fires.
    if (saveUserChange()) return;
    synced = restored;
    for (const key of keys) details[key].open = restored[key];
  };
}
