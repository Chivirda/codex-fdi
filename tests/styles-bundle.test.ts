import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import type { StylesReply } from '../src/shared/project-styles';

describe('browser-only CSS worker bundle', () => {
  it('parses and matches in a context without Node, Figma, DOM or TextEncoder', async () => {
    // Keep this development-only Node API out of the plugin's browser/figma type environment.
    const moduleName: string = 'node:vm';
    const { createContext, runInContext } = await import(moduleName) as {
      createContext(value: Record<string, unknown>): Record<string, unknown>;
      runInContext(code: string, context: Record<string, unknown>, options: { timeout: number }): unknown;
    };
    const bundle = await build({ entryPoints: ['src/styles/worker.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', minify: true });
    const replies: (StylesReply | { type: string })[] = [];
    const sandbox = createContext({ postMessage: (reply: StylesReply) => replies.push(reply) });
    runInContext(bundle.outputFiles[0]!.text, sandbox, { timeout: 3000 });
    expect(replies.shift()).toEqual({ type: 'ready' });
    sandbox.input = { id: 1, command: { type: 'import', id: 'main', name: 'main.css', css: '.card{width:100px;height:50px;--data:"</script><script>globalThis.executed=true</script>"}' } };
    runInContext('onmessage({data:input})', sandbox, { timeout: 3000 });
    expect(replies[0]).toMatchObject({ id: 1, response: { snapshot: { classes: 1 } } });
    expect(sandbox.executed).toBeUndefined();
    sandbox.input = { id: 2, command: { type: 'match', remBase: 10, node: { id: 'node', type: 'FRAME', name: 'Frame', width: 100, height: 50, warnings: [] } } };
    runInContext('onmessage({data:input})', sandbox, { timeout: 3000 });
    expect(replies[1]).toMatchObject({ id: 2, response: { matching: { matches: expect.arrayContaining([expect.objectContaining({ classes: ['card'] })]) } } });
  });
});
