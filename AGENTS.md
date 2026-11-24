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

## Project Styles v0.5–v0.6

`src/shared/project-styles.ts` defines the serializable contract. `src/styles/parser.ts` uses PostCSS and selector-parser; `normalize.ts` handles safe value/shorthand normalization; `index.ts` owns conservative scope/cascade indexing; `match.ts` is pure and independent of DOM/Figma. `session.ts` holds parsed session data, `worker.ts` and `client.ts` provide Worker-first typed transport with a sandbox fallback in main. `profile.ts` validates metadata-only storage. `src/ui/project-styles.ts` renders data using textContent; never inject imported CSS or fetch @import/URLs. Preserve unknown/contextual effects, bounded input/work/output and atomic per-file replacement. Persist profile metadata only; require reimport across launches. Existing inspector CSS generation remains the source for matching Figma properties.
## Roadmap tracking

`ROADMAP.md`, section «Текущий шаг», is the single source of truth for the current milestone, task, next action, last completed task, and outstanding checks. Read it before starting roadmap work; mark an accepted task as in progress when work starts. The roadmap is not authorization to implement every milestone.

After completing each task, and before handoff, the Tech Lead or integrating owner must update that status block in the same change: record the actual outcome and date, completed and unperformed checks, remaining work, and the next concrete action. Contributors report their outcome to the integrating owner; they do not edit documentation outside their ownership. If work is partial or blocked, record that fact and keep the milestone open. Advance the milestone only when all acceptance criteria are met; never infer completion from code presence or claim tests/Figma validation that were not performed. Keep milestone descriptions and section 14 consistent with the status block when the plan changes; do not duplicate a separate current-step pointer in AGENTS.md. Documentation updates do not authorize commits or pushes.


## Version policy and reserved roadmap ownership

Product milestones are tracked in ROADMAP.md; they are distinct from the private npm package version. v0.6.2 is a baseline checkpoint of the existing v0.6.1 behavior, not a new runtime feature release. Keep package.json/package-lock.json at 0.1.0 for this checkpoint. When a feature milestone is accepted for release, the integrating owner updates both package versions together and records the product release in README; do not change manifest.api as a product version. Experimental or partial stages must not be presented as released features.

Before any future implementation, the Lead fixes the corresponding contract and acceptance scope. The following paths are reserved ownership, not authorization to implement later milestones:

- Tech Lead: src/shared/tree.ts, src/shared/export.ts, src/shared/decisions.ts; src/structure/**, src/layout/**, src/export/** and their future tests (tests/structure*.test.ts, tests/layout*.test.ts, tests/export*.test.ts, tests/decisions*.test.ts); main transport integration and docs. Pure modules must not read Figma or DOM. A later explicit ownership change may delegate these paths.
- Figma API Developer: src/adapter/tree.ts and tests/tree-adapter.test.ts. Reuse normalizeNode; no second definition of inspector dimensions or typography.
- UI Developer: src/ui/tree.ts and tests/tree-ui.test.ts, plus existing UI ownership. Tree selection is local UI state; Figma selection and snapshot root remain distinct.
- Tech Lead for integration/QA: tests/tree-contract.test.ts, tests/tree-main.test.ts, tests/fixtures/tree/**. Shared tree contracts, revision/cancellation and runtime message validation are fixed before traversal/UI code starts. Geometry ownership and existing module ownership remain as defined above.

Tree-ready/children messages must be separate from InspectorState.ready; do not add mandatory children to InspectorNode. No HTML, layout inference, new parser or Project Sync is part of the baseline checkpoint.


## Useful structure export slice (owner request, 24 November 2026)

The owner explicitly prioritized a usable HTML/CSS draft, a manual block class, BEM-like child classes and explicit reuse of a root candidate name over a read-only tree. This changes the order of implementation, not the unperformed acceptance gates. Lead owns src/shared/export.ts, src/structure/plan.ts, src/export/serialize.ts and tests/structure.test.ts/tests/export.test.ts as reserved above. UI owns src/ui/tree-export.ts and tests/tree-export-ui.test.ts plus integration in tree/project-styles/index. Keep pure planning/serialization independent of DOM/Figma. Use the existing generateDeclarations for all node CSS; structural HTML default resets must be explicit. Export is a bounded draft, with source mapping and visible placeholders/exclusions, never an assertion of browser cascade, semantics or pixel equivalence. No automatic heading/interactive inference or unknown assets. Root Styles action reuses a single unambiguous BEM-compatible class name only; child matching and CSS reuse/override resolution remain future work. Existing Tree MVP A review/manual gates stay open.
