# Design Inspector

Strict TypeScript, vanilla DOM UI, esbuild, Vitest. No network calls, frameworks, backend, commits or pushes.

## Architecture and ownership

- Tech Lead: shared contract `src/shared/contracts.ts`, build/config, integration entry `src/main.ts`, documentation.
- Figma API Developer: `src/adapter/**` and adapter tests only. Export `normalizeNode(node: SceneNode): InspectorNode` from `src/adapter/normalize.ts`. Adapter is the only module that reads Figma API properties. Main owns events and message transport.
- CSS Engine Developer: `src/css/**` and `tests/css.test.ts` only. Export `generateDeclarations(node: InspectorNode): CSSDeclaration[]` and `generateCSS(node: InspectorNode): string` from `src/css/generate.ts`. Declarations contain `property`, `value`, and complete `declaration` with semicolon. Both full CSS and individual property copying must use this source. No Figma imports or globals.
- UI Developer: `src/ui/**` only. `index.html` references `style.css` and `index.ts`; build inlines both. UI receives `PluginMessage`, sends `UIMessage`, uses DOM textContent for all design data.

Presentation preferences use `src/shared/sections.ts` and native details controlled by `src/ui/sections.ts`. The host persists section snapshots in a dedicated clientStorage key, separate from window dimensions. Keep controller nodes alive during selection updates and suppress saves for programmatic restores. Spacing UI shows six geometry values; original dimensions and all calculations remain in the data model and Properties.

## Spacing Inspector ownership and geometry

- Geometry Agent: `src/adapter/spacing.ts` captures Figma transforms/parent geometry; `src/geometry/**` computes distances without Figma API imports.
- UI Agent: `src/ui/**`, `tests/ui.test.ts`, `tests/spacing-ui.test.ts`.
- QA Agent: `tests/geometry.test.ts`, `tests/spacing-adapter.test.ts`, `tests/units.test.ts` and independent review.
- Tech Lead: `src/shared/spacing.ts`, `src/spacing/units.ts`, integration and documentation.

Spacing uses the immediate parent's coordinate system: inverse(parent absolute transform) multiplied by selected absolute transform. Never use relativeTransform for this: Figma skips groups/boolean operations when defining it. Transform all four corners of the selected layout rectangle, then use its parent-axis AABB. X/Y are the AABB minimum, width/height are its projected extents. Distances are signed: top=minY, left=minX, right=parentWidth-maxX, bottom=parentHeight-maxY. They are geometric gaps, not CSS margin/padding. Render effects, strokes and shape contours are excluded; state this in UI/docs. Reject unavailable, singular or unstable geometry. Pass existing normalized node dimensions to the geometry adapter rather than rereading/redefining selected dimensions. px/rem formatting affects display/copy only.

Contract is fixed before parallel implementation. Coordinate contract changes with lead; do not edit another owner's files. Missing, mixed, unsupported or unreliable values must be omitted with explanatory warnings. All data must be JSON serializable; never pass Figma nodes or symbols to UI. Colors use 0..1 channels. Radius and padding tuples follow top/right/bottom/left (radius: top-left/top-right/bottom-right/bottom-left).

Run `npm run typecheck`, `npm test`, and `npm run build` before handoff. Do not claim Figma runtime validation unless performed. Independent review after integration; bounded fixes.
