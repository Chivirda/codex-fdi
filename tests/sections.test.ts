import { describe, expect, it, vi } from 'vitest';
import { installSections } from '../src/ui/sections';
import { DEFAULT_SECTIONS, type SectionId } from '../src/shared/sections';

class NativeDetails extends EventTarget {
  private expanded = false;
  private pending = false;
  get open(): boolean { return this.expanded; }
  set open(value: boolean) {
    if (value === this.expanded) return;
    this.expanded = value;
    // Model the browser's asynchronous coalesced details toggle task.
    if (!this.pending) {
      this.pending = true;
      queueMicrotask(() => {
        this.pending = false;
        this.dispatchEvent(new Event('toggle'));
      });
    }
  }
}
function setup() {
  const nodes = { properties: new NativeDetails(), spacing: new NativeDetails(), css: new NativeDetails() };
  const send = vi.fn();
  const get = <T extends HTMLElement>(id: string): T => nodes[id.replace('-section', '') as SectionId] as unknown as T;
  const restore = installSections(get, send);
  return { nodes, send, restore };
}
const flush = async (): Promise<void> => { await Promise.resolve(); };

describe('native inspector sections', () => {
  it('defaults all sections open and requests saved state without echoing initial toggle events', async () => {
    const { nodes, send } = setup();
    expect(Object.values(nodes).every(node => node.open)).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'sections-ready' });
    await flush();
    expect(send).toHaveBeenCalledOnce();
  });

  it('toggles each section independently and sends complete immutable snapshots', async () => {
    const { nodes, send } = setup();
    await flush();
    send.mockClear();
    nodes.spacing.open = false;
    await flush();
    expect(send).toHaveBeenLastCalledWith({ type: 'set-sections', sections: { properties: true, spacing: false, css: true } });
    const previous = send.mock.calls[0]?.[0];
    nodes.css.open = false;
    await flush();
    expect(send).toHaveBeenLastCalledWith({ type: 'set-sections', sections: { properties: true, spacing: false, css: false } });
    nodes.properties.open = false;
    await flush();
    expect(send).toHaveBeenLastCalledWith({ type: 'set-sections', sections: { properties: false, spacing: false, css: false } });
    expect(previous).toEqual({ type: 'set-sections', sections: { properties: true, spacing: false, css: true } });
  });

  it('restores valid preferences without saves despite queued or repeated native toggle events', async () => {
    const { nodes, send, restore } = setup();
    const saved = { properties: false, spacing: true, css: false };
    restore(saved); // Default-open events have not fired yet.
    restore(saved);
    await flush();
    expect(nodes.properties.open).toBe(false);
    expect(nodes.spacing.open).toBe(true);
    expect(nodes.css.open).toBe(false);
    nodes.css.dispatchEvent(new Event('toggle'));
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'sections-ready' });
    nodes.spacing.open = false;
    await flush();
    expect(send).toHaveBeenLastCalledWith({ type: 'set-sections', sections: { properties: false, spacing: false, css: false } });
  });

  it('ignores invalid preferences and keeps open defaults', async () => {
    const { nodes, send, restore } = setup();
    for (const value of [undefined, null, [], {}, { properties: false }, { ...DEFAULT_SECTIONS, css: 'false' }]) restore(value);
    await flush();
    expect(Object.values(nodes).every(node => node.open)).toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });

  it('does not let a late restore undo an already delivered user toggle', async () => {
    const { nodes, send, restore } = setup();
    await flush();
    nodes.properties.open = false;
    await flush();
    restore({ properties: true, spacing: false, css: false });
    await flush();
    expect(nodes.properties.open).toBe(false);
    expect(nodes.spacing.open).toBe(true);
    expect(nodes.css.open).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('detects a user toggle before its asynchronous event and protects it from late restore', async () => {
    const { nodes, send, restore } = setup();
    await flush();
    nodes.spacing.open = false;
    restore({ properties: false, spacing: true, css: false });
    await flush();
    expect(nodes.properties.open).toBe(true);
    expect(nodes.spacing.open).toBe(false);
    expect(nodes.css.open).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ type: 'set-sections', sections: { properties: true, spacing: false, css: true } });
  });

  it('coalesces multiple user toggles into the latest full state without duplicate saves', async () => {
    const { nodes, send } = setup();
    await flush();
    nodes.properties.open = false;
    nodes.spacing.open = false;
    nodes.css.open = false;
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ type: 'set-sections', sections: { properties: false, spacing: false, css: false } });
  });

  it('restores preferences into a new session without sharing nodes or mutable state', async () => {
    const first = setup();
    await flush();
    first.nodes.css.open = false;
    await flush();
    const saved = first.send.mock.calls.find(([message]) => message.type === 'set-sections')?.[0];
    if (saved?.type !== 'set-sections') throw new Error('Expected preference snapshot');
    const second = setup();
    second.restore(saved.sections);
    await flush();
    expect(second.nodes.css.open).toBe(false);
    expect(second.nodes.css).not.toBe(first.nodes.css);
    expect(second.send).toHaveBeenCalledExactlyOnceWith({ type: 'sections-ready' });
    expect(first.nodes.css.open).toBe(false);
  });
});
