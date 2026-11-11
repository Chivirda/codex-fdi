import { describe, expect, it } from 'vitest';
import { StylesSession, respondToStyles } from '../src/styles/session';
import { parseStylesProfile } from '../src/styles/profile';
import { CSS_LIMITS } from '../src/shared/project-styles';

describe('local CSS session and bounded profiles', () => {
  it('imports, replaces atomically, matches, refreshes and removes without retaining source text', () => {
    const session = new StylesSession();
    const first = session.handle({ type: 'import', id: 'main', name: 'main.css', css: '.card{width:100px;height:50px}' });
    expect(first.snapshot.files).toHaveLength(1);
    expect(first.snapshot.classes).toBe(1);
    expect(() => session.handle({ type: 'import', id: 'main', name: 'main.css', css: '.card{' })).toThrow();
    expect(session.handle({ type: 'refresh' }).snapshot.files[0]?.rules).toBe(1);
    const result = session.handle({ type: 'match', remBase: 10, node: { id: '1', name: 'Frame', type: 'FRAME', width: 100, height: 50, warnings: [] } });
    expect(result.matching?.matches.some(match => match.classes.includes('card') && match.matched.length >= 2)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('.card{');
    session.handle({ type: 'import', id: 'main', name: 'main.css', css: '.new{width:10px;height:20px}' });
    expect(session.handle({ type: 'refresh' }).snapshot.classes).toBe(1);
    expect(session.handle({ type: 'remove', id: 'main' }).snapshot.files).toEqual([]);
  });
  it('bounds individual file size and total file count, returning request errors', () => {
    const session = new StylesSession();
    const oversized = respondToStyles(session, { id: 7, command: { type: 'import', id: 'big', name: 'big.css', css: ' '.repeat(CSS_LIMITS.fileBytes + 1) } });
    expect(oversized).toMatchObject({ id: 7, error: expect.stringContaining('limit') });
    for (let index = 0; index < CSS_LIMITS.files; index++) session.handle({ type: 'import', id: String(index), name: `${index}.css`, css: `.a${index}{width:1px}` });
    expect(() => session.handle({ type: 'import', id: 'extra', name: 'extra.css', css: '.extra{}' })).toThrow();
    expect(session.handle({ type: 'refresh' }).snapshot.files).toHaveLength(CSS_LIMITS.files);
  });
  it('validates and strips raw CSS/indexes from persistent profile data', () => {
    const input = { version: 1, name: 'Egispro', remBase: 10, files: [{ id: 'main', name: 'main.css', bytes: 100, importedAt: 1, rules: 2, classes: 3, variables: 1, css: 'secret' }], css: 'secret', index: { large: true } };
    expect(parseStylesProfile(input)).toEqual({ version: 1, name: 'Egispro', remBase: 10, files: [{ id: 'main', name: 'main.css', bytes: 100, importedAt: 1, rules: 2, classes: 3, variables: 1 }] });
    for (const value of [null, {}, { ...input, remBase: 0 }, { ...input, files: [...input.files, ...input.files] }, { ...input, name: 'x'.repeat(81) }]) expect(parseStylesProfile(value)).toBeUndefined();
  });
});
