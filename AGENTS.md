# Design Inspector

Strict TypeScript, vanilla DOM UI, esbuild, Vitest. No network calls, frameworks, backend, commits or pushes.

## Architecture and ownership

- Tech Lead: shared contract `src/shared/contracts.ts`, build/config, integration entry `src/main.ts`, documentation.
- Figma API Developer: `src/adapter/**` and adapter tests only. Export `normalizeNode(node: SceneNode): InspectorNode` from `src/adapter/normalize.ts`. Adapter is the only module that reads Figma API properties. Main owns events and message transport.
- CSS Engine Developer: `src/css/**` and `tests/css.test.ts` only. Export `generateDeclarations(node: InspectorNode): CSSDeclaration[]` and `generateCSS(node: InspectorNode): string` from `src/css/generate.ts`. Declarations contain `property`, `value`, and complete `declaration` with semicolon. Both full CSS and individual property copying must use this source. No Figma imports or globals.
- UI Developer: `src/ui/**` only. `index.html` references `style.css` and `index.ts`; build inlines both. UI receives `PluginMessage`, sends `UIMessage`, uses DOM textContent for all design data.

Contract is fixed before parallel implementation. Coordinate contract changes with lead; do not edit another owner's files. Missing, mixed, unsupported or unreliable values must be omitted with explanatory warnings. All data must be JSON serializable; never pass Figma nodes or symbols to UI. Colors use 0..1 channels. Radius and padding tuples follow top/right/bottom/left (radius: top-left/top-right/bottom-right/bottom-left).

Run `npm run typecheck`, `npm test`, and `npm run build` before handoff. Do not claim Figma runtime validation unless performed. Independent review after integration; bounded fixes.
