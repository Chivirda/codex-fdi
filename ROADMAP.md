# Design Inspector — ROADMAP v0.6.1 → 1.0+

Статус: проектный план, не описание уже реализованных возможностей. Дата последней сверки: 24 ноября 2026. Базовая продуктовая версия: v0.6.1 по README и заданию владельца. В package.json сейчас 0.1.0; политика версий закреплена в AGENTS.md: baseline не меняет номер пакета, синхронизация package.json/package-lock.json выполняется при принятом функциональном релизе.

## Текущий шаг

Обновлено: 24 ноября 2026. Источник текущего статуса — этот блок; раздел 14 описывает исходную точку плана.

- **Текущая продуктовая версия:** v0.6.1; checkpoint v0.6.2 baseline закрыт без изменения runtime-функциональности и package version.
- **Статус реализации roadmap:** baseline v0.6.2 завершён; v0.7.0 открыт и выполнен частично — завершена задача контракта Tree MVP A, обход/host/UI ещё не реализованы.
- **Текущий этап / следующий к выполнению:** v0.7.0 — Tree MVP A; следующий подшаг — adapter bounded snapshot.
- **Текущая задача:** контракт завершён 24 ноября 2026: src/shared/tree.ts (snapshot/сообщения, hidden/branch policy, budgets, runtime-validation), tests/tree-contract.test.ts и синтетическая fixture. [Контракт и обязательства интеграции](docs/TREE_CONTRACT_v1.md). InspectorNode и активные PluginMessage/UIMessage не изменены.
- **Следующее действие:** реализовать src/adapter/tree.ts и tests/tree-adapter.test.ts по schema v1: итеративный read-only обход, normalizeNode, hidden/unsupported/unavailable placeholders, parent-local geometry, chunk/progress/cancel hooks. Затем main generation/revision/cancel/stale transport и tests/tree-main.test.ts; до UI зафиксировать результаты интеграции.
- **Последняя завершённая задача:** контракт Tree MVP A. PASS: npm run typecheck; npm test — 232 теста в 19 файлах (22 новых contract cases); npm run build; git diff --check. Бюджеты: 1000 узлов, depth64, 2MiB/message, 10s timeout, chunks 50 узлов/8ms; это начальные бюджеты приложения, не замер хоста. Отчёт baseline остаётся исходной регрессионной точкой.
- **Незакрытые проверки:** реальный bounded обход/progress/cancel и stale state machine ещё отсутствуют; тестирование Figma runtime/performance не выполнялось. UI дерева не реализован. Независимое review другим исполнителем не выполнялось; самопроверка контракта выполнена, независимое review остаётся gate интеграции. Ручная baseline-матрица Figma Desktop (Copy/Spacing/resize/темы/clipboard/Worker/storage) остаётся not performed. Номер пакета 0.1.0, продуктовая функциональность v0.6.1; v0.7.0 не объявлена выпущенной.

После каждой завершённой задачи обновлять этот блок: фактический результат, оставшиеся проверки, текущую/следующую задачу и дату. Этап завершать только после выполнения всех его критериев приёмки. Если задача завершена частично, явно указать остаток; не продвигать этап автоматически. Подробное правило — в AGENTS.md, раздел Roadmap tracking.

## 1. Цель и правила выполнения

Развить локальный инспектор Figma в инструмент разбора выбранного блока с потомками и подготовки объяснимого HTML/CSS. Результат — проверяемая заготовка для разработчика с указанием допущений, а не обещание восстановления исходного сайта или адаптивности по одному макету.

Неизменные ограничения: strict TypeScript, vanilla DOM, esbuild, Vitest; никаких сетевых запросов, backend, UI-фреймворков, commits или pushes. Не добавлять облачный анализ, CDN, загрузку шрифтов, fetch URL из импортированного CSS, автоматический @import, телеметрию. Новые функции работают локально и не изменяют документ Figma. Изменение этих ограничений требует отдельного решения владельца и не входит в этот план.

Этот ROADMAP разрешает планирование, но не является командой немедленно реализовать все этапы. Перед реализацией брать один ограниченный этап, проверять действующий AGENTS.md, фиксировать контракт и критерии приёмки. Календарные сроки не назначены: переход определяется прохождением gates.

## 2. Что существует сейчас

Сверены AGENTS.md, README.md, package.json, manifest.json, docs/STYLE_MATCHING_DIAGNOSTICS.md, структура src/tests, src/main.ts, src/shared/contracts.ts, src/adapter/normalize.ts и src/css/generate.ts. Первоначальная сверка плана была статической. 24 ноября 2026 выполнен baseline с typecheck/test/build; текущие доказательства и невыполненные проверки приведены в блоке «Текущий шаг» и отчёте baseline. Проверки Figma Desktop в этом этапе не выполнялись.

| Область | Реальное состояние v0.6.1 | Следствие для плана |
|---|---|---|
| Выделение | main обрабатывает один узел; empty/multiple/error/ready; selectionchange, nodechange, currentpagechange | Режим дерева должен быть отдельным запросом, не заменой текущего инспектора |
| Модель | InspectorNode: размеры, простой Auto Layout, solid-цвета, ограниченный border, radius, opacity, typography, characters, warnings | Нет children, HTML-семантики, плана layout, Hug/Fill и grid |
| CSS | generateDeclarations — единый источник; generateCSS собирает блок .inspected-element | Сохранить публичные функции и одинаковые значения полного/поштучного копирования |
| Spacing | inverse(parent.absoluteTransform) × node.absoluteTransform, четыре угла, parent-axis AABB, знаковые расстояния | Не превращать зазоры в margin/padding; переиспользовать математические примитивы без подмены смысла |
| UI | Properties, Spacing, CSS, Copy Text, resize, сворачиваемые sections | Сохранить состояние контроллеров, клавиатуру, 320×300 и отдельные storage keys |
| Project Styles | PostCSS/selector-parser, чистые normalize/index/match, Worker-first и sandbox fallback, профиль только метаданных | Не строить второй парсер; не утверждать произвольную browser cascade |
| v0.6.1 | Числовые допуски, относительная типографика при известном font-size, Copy matched CSS, явный Use for override | Сохранить сброс выбора, conditional/low ограничения и исходные CSS-фрагменты |
| Сеть | manifest: allowedDomains=[none], dynamic-page, editorType=figma | Дерево ограничить выбранным поддеревом текущей страницы |

Существующие тесты: adapter, css, geometry, spacing-adapter, units, main, ui, resize, sections, project-ui, styles-parser/normalize/match/numeric/typography/session/client/bundle. Наличие файлов не означает подтверждённое прохождение тестов.

Текущие ограничения остаются видимыми до явного расширения: wrap/grid не экспортируются; размеры в px; сложные paints/effects/shape geometry и mixed typography не восстанавливаются; нет HTML, ассетов, дерева и доказанной responsive-модели. Диагностика Style Matching содержит локальный ориентир производительности, не замер Figma runtime.

## 3. Архитектура и ownership

Действующий AGENTS.md имеет приоритет. Названия ролей задают границы ответственности, а не требование запускать параллельных агентов.

| Владелец | Сохраняемая область | Предлагаемое расширение после согласования контракта |
|---|---|---|
| Tech Lead | src/shared/contracts.ts, main.ts, build/config, документация, интеграция | shared/tree.ts, shared/export.ts, shared/decisions.ts; маршрутизация tree-запросов, revision/cancellation |
| Figma API Developer | src/adapter/** и adapter tests; normalizeNode(node): InspectorNode | adapter/tree.ts и сбор новых API-полей; только адаптер читает свойства узлов Figma |
| CSS Engine Developer | src/css/**, tests/css.test.ts; generateDeclarations/generateCSS | CSS дерева, разрешение конфликтов измерений, безопасные селекторы; новые тестовые файлы — после явного назначения Lead |
| Geometry Agent | adapter/spacing.ts, src/geometry/** | Чистые overlap/alignment/track/transform вычисления; доступ к API только в adapter |
| UI Developer / UI Agent | src/ui/**, разрешённые UI tests | Дерево, редактор решений, диагностика, просмотр кода |
| QA Agent | geometry/spacing-adapter/units tests, независимый review | Матрица дерева, golden fixtures, проверки HTML/layout; новые пути предварительно закрепляет Lead |
| Tech Lead по Project Styles | shared/project-styles.ts, интеграция; существующие parser/normalize/index/match/session/worker/client/profile | Связь классов с узлами через существующий движок; расширение ownership фиксировать до кода |

На baseline новые чистые области src/structure/** (HTML/семантика), src/layout/** (решения layout) и src/export/** (сборка результата), будущие tree-пути и тесты закреплены в AGENTS.md. Чистые новые области зарезервированы за Tech Lead; делегирование требует явного изменения ownership. Это назначение не разрешает реализацию всех этапов сразу. Ни UI, ни CSS/geometry/structure/layout не импортируют Figma API и не получают SceneNode.

Поток: Figma → adapter snapshot → JSON-контракт → чистый анализ структуры/layout → пользовательские решения → проверенный export plan → HTML serializer + CSS engine → текст/локальный файл. Main владеет событиями и транспортом. UI отображает данные и отправляет команды, не вычисляет собственные CSS-значения.

InspectorNode сохраняется как контракт одиночного инспектора. TreeSnapshot оборачивает его либо ссылается на нормализованный узел, добавляя отдельные tree/layout поля. Не добавлять обязательные children в существующий ready-state. Новые сообщения — отдельные discriminated unions, с runtime-валидацией входа.

## 4. Инспекция выбранного блока и дерева

### 4.1. Пользовательский сценарий

1. Пользователь выбирает один блок и нажимает «Inspect subtree». Одиночный инспектор продолжает работать независимо.
2. Показываются корень, число узлов, прогресс и ограничения. Результат относится к конкретной revision выбранного поддерева.
3. Дерево показывает реальные узлы Figma, скрытые/неподдерживаемые узлы и предложенную структуру экспорта. Эти две структуры различимы.
4. Нажатие на строку меняет активный узел внутри UI без смены выделения Figma. Явный переход к узлу Figma — отдельная будущая команда main с проверкой принадлежности snapshot.
5. Для узла доступны свойства, причины выбора layout, HTML-тег, исключение, sizing, порядок, классы и предупреждения.
6. После изменения решения обновляются только зависимые части плана. Копирование выдаёт HTML/CSS одной revision; видимые нерешённые блокеры запрещают готовый экспорт.

### 4.2. Snapshot и обход

Предлагаемый TreeSnapshot: schemaVersion, requestId, documentSessionId, revision, rootId, nodes (плоская таблица по id), sourceOrder, completeness, limits, diagnostics. Node содержит parentId, childIds, InspectorNode, локальные transforms/геометрию, видимость, доступные признаки layout/sizing/clipping и provenance. Все числа конечные, символы/mixed/API-объекты отсутствуют.

Обход итеративный, с учётом лимита глубины, количества узлов, объёма строк/сообщений и времени одного участка работы. Не использовать рекурсивный DFS без ограничений. Для каждой ветки сохранять complete/omitted/truncated/unsupported с причиной; пустая ветка и необработанная ветка различаются.

Стартовые инженерные лимиты для MVP: 1000 узлов, глубина 64, общий snapshot 4 MiB, суммарный текст 1 MiB, участок обхода целевым временем до 12 ms, общий timeout 10 s. Это предлагаемые бюджеты, требующие замера в Figma перед релизом. Проверять объём до отправки; превышение возвращает partial с явным количеством пропусков, а не молчаливое обрезание HTML. Экспорт partial по умолчанию заблокирован; отдельный подтверждённый частичный экспорт явно перечисляет исключённые ветки.

Скрытые узлы отмечаются и по умолчанию исключаются из экспорта; скрытая ветка не обходится полностью в MVP, UI показывает «не загружена». Явная опция включения скрытых запускает новый snapshot с теми же лимитами. Locked не означает hidden. Неподдерживаемый видимый узел сохраняется как placeholder, не исчезает.

Instances читаются как доступное дерево экземпляра, без detach, перехода к исходному main component или изменения overrides. Component set не превращать автоматически в HTML-варианты. Groups/boolean/masks не считать обычным Frame: сохранить принадлежность и предупредить о производных границах/композиции.

Main увеличивает generation на selection/page change, Refresh и новой tree-команде; отменяет старую работу логическим token. Ответы с устаревшими requestId/revision отбрасываются и в main, и в UI. Изменение потомка, удаление/перемещение узла и изменение внешнего предка, влияющего на transforms, инвалидируют snapshot. Начать с консервативной инвалидизации nodechange текущей страницы; оптимизацию фильтрации делать позже. События объединяются, не запускают полный обход на каждый drag tick. Ни один snapshot не собирается из нескольких несовместимых revisions: при изменении во время сбора перезапустить или пометить stale и потребовать Refresh.

### 4.3. Геометрия

Хранить исходные размеры и полную affine-матрицу отдельно от AABB. Для parent-local координат использовать inverse(parent absolute) × child absolute, включая Group/Boolean промежуточные уровни; не relativeTransform. Root задаёт экспортную локальную систему: его положение на странице не становится left/top.

AABB годится для оценки расположения, но не заменяет rotation/skew/reflection и не задаёт автоматически CSS width/height. Невырожденность, устойчивость inversion и конечность координат проверяются. Неопределимая геометрия исключается из уверенных эвристик. Strokes, effects и контур не входят в layout rectangle; clipping и visual bounds — отдельные признаки.

## 5. HTML-структура и семантика

Figma-иерархия — свидетельство композиции, не DOM. Строить отдельный StructurePlan с exportId, sourceNodeIds, tag, attrs, text/runs, children, createdWrapper, decisionSource и diagnostics. Один узел может дать wrapper + content, несколько узлов — один семантический элемент; сохранять обратную карту происхождения.

Безопасные defaults: контейнер div, текст p или span по контексту, неизвестная графика — помеченный placeholder. Имена слоёв дают только слабую подсказку. Не назначать h1, nav, main, button, a, input только по размеру/названию/цвету. Вероятное назначение показывать как предложение с объяснением и выбором пользователя.

Правила после подтверждения:

- Заголовки h1–h6 выбираются по структуре документа и контексту вставки; выбранный блок не доказывает наличие единственного h1 на странице.
- Списки ul/ol/li требуют повторяющихся элементов и подтверждённого смысла списка. Внешнее сходство карточек недостаточно для table.
- a требует подтверждённого назначения и безопасного href; button — действия и type=button по умолчанию. Не выдумывать обработчики, маршруты и состояния.
- Form controls требуют явного типа/label/связей id–for; placeholder не заменяет label. Интерактивный элемент не может содержать другой интерактивный элемент.
- img требует локального ассета и выбора alt: содержательное описание либо пустое для декорации. Не генерировать ложный рабочий src. Пока ассетов нет — placeholder с диагностикой.
- section/article/nav/header/footer/main задаются только осмысленно; не превращать каждый Frame в section и не добавлять ARIA там, где достаточно HTML.
- Текст и имена экранируются отдельным HTML serializer; код в UI выводится textContent. Запрещены raw HTML, on*-атрибуты, script, javascript: URL, style injection и неподтверждённые внешние ресурсы.

Валидация content model: p не содержит block containers, ul/ol содержат li, корректны void elements, нет вложенных ссылок/кнопок, дубликатов id и висящих aria/label references. Порядок DOM сохраняет смысл чтения; нельзя молча сортировать по X/Y. Если визуальный порядок противоречит исходному, UI показывает предложение и предупреждение о чтении/Tab.

Удаление wrapper допустимо только после проверки layout, containing block, clipping, opacity, effects, stacking и семантики. display:contents не универсальный способ flatten. Созданные wrappers имеют собственные exportId, понятную причину и обратимую операцию.

## 6. Выбор flex/grid/absolute и смешанные layout

### 6.1. Модель решения

Для каждого контейнера формировать LayoutDecision: mode (block/flex/grid/positioned/unsupported), inFlowChildren, overlays, sizing по осям, alignment, gap/padding, tracks, evidence[], alternatives[], confidence (high/medium/low), warnings, source (explicit/inferred/user). Confidence — объяснимый уровень свидетельств, не вероятность точного HTML.

Приоритет: подтверждённое решение пользователя → достоверные явные свойства Figma → консервативная геометрическая гипотеза → нейтральный fallback с предупреждением. Любое изменение против явных данных показывает конфликт. Разделять режим воспроизведения фиксированного snapshot и режим flow-реконструкции; второй не обещает pixel-perfect.

### 6.2. Алгоритм контейнера

1. Отделить visible/included детей, unsupported placeholders и геометрию с низкой надёжностью.
2. Проверить явный Auto Layout: axis, wrap, spacing, align, child sizing и out-of-flow признаки, если они реально доступны в установленных typings/API.
3. Для ручного Frame вычислить alignment clusters, интервалы проекций, центры, gaps и overlap. Повторяемость проверять по нескольким соседям, а не одной паре.
4. Сравнить block/flex row/flex column/grid и смешанный вариант по объяснимым признакам. Сохранить причины отклонения, не выдавать единственную догадку как факт.
5. Разрешить sizing и зависимые свойства детей; провал проверки по одной оси не портит достоверные сведения по другой.
6. Прогнать модель вперёд на доступной геометрии: остаточное расхождение, потерянные узлы, overflow и противоречия дают предупреждение или снижение confidence.

Для геометрических кластеров предложить начальный допуск max(0.5px, 0.001 × размер оси контейнера) с верхней границей 2px. Отдельно использовать существующие числовые допуски Style Matching: допуск сравнения CSS не равен допуску распознавания layout. Калибровать на fixtures, фиксировать пороги и tie-break детерминированно. При близких кандидатах просить выбор через UI.

### 6.3. Flex и block

Явный HORIZONTAL/VERTICAL Auto Layout даёт сильное основание для flex, но не автоматически все child размеры. Простая одноосевая последовательность без overlap может предложить flex. Обычный вертикальный текстовый поток может остаться block: не добавлять flex лишь из-за одного ребёнка.

Hug не равен безусловному width:max-content, Fill не равен width:100%. Разрешать их с учётом оси родителя, flex-basis/grow/shrink, доступной ширины, min/max, text wrapping и align-self. Fixed хранит измерение; для текста учитывать min-width:0 только при доказанной необходимости. Цикл parent Hug ↔ child Fill даёт конфликт, а не произвольный процент.

space-between нельзя выводить из одинаковых gap одного snapshot: нужны явные данные либо решение пользователя. Не задавать одновременно выведенный фиксированный gap и space-between без основания. Wrap и row/column-gap добавляются отдельным этапом; отрицательное расстояние не становится отрицательным gap — это overlap или отдельная модель.

### 6.4. Grid

Grid предлагать при двухмерной регулярности: устойчивые границы колонок/строк, повторяющиеся tracks, несколько рядов/колонок и объяснимое размещение детей. Layout guides/линии макета не считать доказательством CSS Grid. Не обещать доступность нативного grid API до проверки установленного @figma/plugin-typings и runtime; неизвестный режим сохранять как unsupported.

Сначала экспортировать явные фиксированные tracks и известные gaps для snapshot. repeat(n, 1fr), minmax(), auto-fit и responsive breakpoints требуют дополнительных свидетельств или выбора пользователя. Spans добавлять только при совпадении границ ячеек с несколькими tracks. Неуверенный span — ручное назначение с диагностикой.

Отличать wrap flex от grid: wrap подходит независимым строкам без общей колоночной привязки; grid — общим tracks по двум осям. Для единственной строки grid обычно не выигрывает без явной причины. Masonry, subgrid и сложные dense-reordering остаются за пределами 1.0.

### 6.5. Absolute positioning

Сильное основание — явный out-of-flow child в Auto Layout. Геометрические признаки: badge над углом карточки, плавающая иконка, background/decorative слой, существенное перекрытие. Сам overlap не доказывает absolute: проверить отрицательные интервалы, transforms, текст, masks и обычное наложение.

Выбирать отдельный overlay внутри подходящего контейнера; не превращать весь блок в набор absolute из-за одного badge. Родителю требуется containing block (обычно position:relative); вычислять координаты в его системе с учётом border/padding и box model. По умолчанию фиксировать left/top из snapshot, не задавать одновременно противоречивые width + left + right. Правое/нижнее/центральное anchoring возможно только по явным constraints или пользовательскому решению; Figma constraints всё равно требуют проверки соответствия CSS.

Чистая фиксированная positioned-композиция допустима как явно выбранный режим fidelity, с предупреждениями о тексте/resize/адаптивности. Не использовать её скрытым fallback. position:fixed/sticky не выводятся из положения на холсте или scroll-настроек без подтверждённого контекста страницы.

Rotation/skew/reflection требуют полноценной декомпозиции матрицы, transform-origin и проверки containing block. В MVP таких детей помечать unsupported для flow inference, сохранять placeholder/фиксированную геометрию и предупреждение. Не подменять transform его AABB. z-index не равен индексу узла: учесть stacking contexts от opacity/transform и порядок рисования; неоднозначные случаи требуют review.

### 6.6. Nested и mixed containers

Каждый контейнер решается локально, затем проверяются зависимости sizing между уровнями. Пример: карточка flex-column → header flex-row → badge absolute; список карточек grid → каждая карточка flex-column. Режим предка не наследуется детьми автоматически.

Гипотеза группировки соседей в новый wrapper допустима при устойчивом локальном alignment, но должна показываться в дереве экспорта, сохранять source mapping и требовать подтверждения в MVP. Не менять исходное дерево Figma. Нельзя пересаживать overlay через clipping/stacking boundaries ради красивого DOM.

Пример приёмочного fixture: Frame с header (logo + navigation), grid карточек и badge. Ожидаются независимые решения header/card-list/card-content/overlay, сохранённый смысловой порядок, relative у карточки, единственный absolute badge; отсутствие absolute у обычных текстов и отсутствие координат страницы у root.

## 7. CSS и сборка экспорта

Существующие generateDeclarations(node) и generateCSS(node) сохраняют сигнатуры и одиночный режим. Добавить отдельную генерацию resolved export plan внутри src/css, используя общие валидаторы/форматтеры и тот же CSSDeclaration. Не копировать генератор в UI или HTML serializer. Для режима дерева единственный источник деклараций — resolveTreeDeclarations(plan); полное CSS, строка свойства, diff и copy получают один результат.

CSS разделить по ответственности: визуальные свойства узла из существующей модели; layout контейнера; placement/sizing ребёнка. Перед сборкой resolve конфликтов: fixed width против fill, gap против неподтверждённого distributed spacing, transform против подменённых размеров. Не генерировать два несовместимых свойства и надеяться на порядок cascade.

Стабильные классы генерировать из очищенного имени + короткого exportId, не из сырого node.name. Обеспечить уникальность, CSS escaping, защиту от коллизий и сохранение имени после ручного переименования соседей. Пользовательское имя валидируется; один класс может быть общим только при явной deduplication и эквивалентных declarations.

В MVP локальный namespace корня и фиксированные px без глобального reset. box-sizing:border-box сохраняется там, где нужен; проверять stroke/layout различия. Не подавлять browser defaults глобальным *: reset. Для семантических тегов указывать нужные margin/font defaults локально и предупреждать об окружении вставки. Проценты line-height Figma при необходимости переводить в согласованное значение; не менять одиночный экспорт без отдельной регрессии.

Выход: HTML fragment + scoped CSS + diagnostics + manifest происхождения/версии схемы; сначала Copy HTML, Copy CSS, Copy both. Без JS приложения, backend, JSX и framework components. Bundle/локальный download — позже, с безопасными именами файлов и без записи в чужой проект.

Project Styles подключать после базового tree-export: кандидат на узел остаётся гипотезой, его применение явно выбирает пользователь. Matching score не подтверждает DOM-селектор. Не применять conditional, contextual и unknown cascade как готовый безопасный класс; использование импортированного класса не гарантирует стиль вне исходной среды. Сохранять исходные CSS fragments отдельно от сгенерированных overrides. Переимпорт/параметры/revision инвалидируют устаревшие привязки.

## 8. Редактируемые решения пользователя

DecisionStore отдельно от immutable snapshot: schemaVersion, documentSessionId, rootId, sourceRevision, операции по source/export id, undo/redo history. Редактируемые поля: include/exclude, tag, безопасные attrs, class, layout mode/axis, gap/padding, fixed/hug/fill intent по осям, tracks/spans, in-flow/overlay, anchors, DOM order, wrapper, alt/label и выбор CSS-кандидата. Свободное редактирование JS/raw HTML не входит в 1.0.

Для каждого поля показывать исходное значение, предложение, причину и ручной override. Reset node/subtree/all и Undo/Redo обязательны до широкого набора настроек. Исключение узла с детьми явно предлагает исключить ветку либо перенести детей с повторной проверкой контекста; не делать неявный flatten.

После Refresh переносить override только при совпадении document session/node identity и совместимой структуре/свойствах. Изменение родителя, удаление узла, смена типа/layout или источника класса делает зависимые решения stale. Сохранять их для review, не применять молча. MVP хранит решения только в памяти сеанса; persist/export профиля — после определения приватности, лимитов и миграций. Не писать полный текст дизайна/CSS в clientStorage по аналогии с metadata-only Project Styles.

Tree state/focus/scroll сохраняются при локальных обновлениях. Новые секции используют shared/sections.ts и существующий controller; не пересоздавать details и не сохранять программное восстановление. Активный узел UI, Figma selection и root snapshot — разные понятия.

## 9. Предупреждения и безопасность результата

Структурированная диагностика: code, severity(info/warning/blocker), sourceNodeId/exportId, category, evidence, affectedOutput, action, revision. Старые warnings:string[] продолжают работать в одиночном режиме; новые коды не заменяют контракт без миграции.

Примеры кодов: TREE_TRUNCATED, SNAPSHOT_STALE, GEOMETRY_UNSTABLE, HIDDEN_BRANCH_UNREAD, LAYOUT_AMBIGUOUS, ABSOLUTE_INFERRED, SIZING_CYCLE, TRANSFORM_UNSUPPORTED, MASK_UNSUPPORTED, ASSET_MISSING, TEXT_RUNS_MIXED, SEMANTICS_UNCONFIRMED, DOM_ORDER_CHANGED, STYLE_CONTEXT_UNKNOWN.

Blocker запрещает «готовый экспорт», но позволяет копировать диагностику. Warning допускает draft с видимым перечнем допущений. Подтверждение пользователем скрывает уведомление, но не превращает unsupported в поддерживаемое. Частичный экспорт имеет отдельное название и manifest исключений.

Не монтировать сгенерированный/импортированный HTML или CSS в основной UI. MVP — только текстовый просмотр. Будущий preview требует изолированного sandbox, запрета скриптов/сети/навигации и отдельной проверки; он не входит в первый tree MVP. HTML/CSS escaping, ограничение объёма, прототипных ключей и malformed messages проверяются на границах. Не разрешать URL/атрибуты, способные незаметно инициировать сетевые запросы.

## 10. Этапы и зависимости

Версии ниже — предлагаемые продуктовые milestones; номер можно уточнить, порядок зависимостей сохраняется.

| Этап | Фичи и результат | Зависит от | Критерии приёмки / gate |
|---|---|---|---|
| v0.6.2 — baseline (gate выполнен 24.11.2026) | Зафиксировать поведение v0.6.1, согласовать version policy, regression checklist и ownership новых путей | Текущий код | Сверены README/contracts; typecheck/test/build проходят; ручные проверки помечены performed/not performed; нет изменения поведения Copy/Spacing/Styles |
| v0.7.0 — Tree MVP A | Отдельный bounded snapshot, дерево просмотра, progress/cancel/stale, placeholders и warnings; без HTML | v0.6.2, shared tree contract | Все включённые потомки представлены или имеют явную причину пропуска; смена selection не показывает старый ответ; hidden/limits проверены; UI 320×300 остаётся доступен |
| v0.7.1 — Tree MVP B | StructurePlan, безопасные div/p/span, HTML fragment, явный простой Auto Layout, fixed px, ручные теги | v0.7.0, ownership structure/export | Валидный экранированный HTML и scoped CSS для вложенных Frame/Text/solid Rectangle; никакого автоматического grid/absolute guessing; неподдерживаемое видно |
| v0.8.0 — Flow MVP | Sizing fixed/hug/fill для поддержанных случаев, nested flex, block, ручной overlay, решения пользователя и undo/reset | v0.7.1, resolved plan | Fixtures вложенных flex и mixed flow/overlay воспроизводят поддержанный snapshot; отсутствуют скрытые конфликты размеров и CSS; rebase overrides безопасен |
| v0.8.1 — Explainable inference | Эвристики manual Frame row/column, confidence, alternatives, подтверждаемые wrappers и overlays | v0.8.0, geometry corpus | Неоднозначные случаи не становятся high; каждое inferred решение имеет evidence; ручной выбор детерминированно меняет результат |
| v0.9.0 — Grid + wrap | Flex wrap, row/column gaps, фиксированные grid tracks/spans, смешанные nested layouts | v0.8.1, grid contract | Fixtures grid vs wrap различаются; неизвестные spans не выдуманы; один badge не переводит контейнер целиком в absolute |
| v0.9.1 — Styles integration | Явные привязки импортированных классов к узлам, минимальные проверяемые overrides, invalidation | v0.9.0, существующий Styles engine | Сохранены v0.6.1 допуски/conditional ограничения; смена CSS/revision сбрасывает или помечает stale; score не представлен как DOM-proof |
| v0.9.2 — RC | Семантическая валидация, a11y UI, лимиты/performance, стабильный export manifest и документация | Все предыдущие | Корпус, три обязательные команды, независимый review и ручная матрица Figma закрыты; blockers отсутствуют на supported fixtures |
| v1.0 — stable | Локальный explainable subtree HTML/CSS export в пределах объявленной поддержки | RC gates | Опубликована support matrix, известные ограничения и инструкция review; нет требований сети/Dev Mode/backend; одиночный инспектор не регрессировал |
| 1.0+ | Ассеты, text runs, улучшенные transforms, локальные профили, multi-viewport reconciliation, component patterns | Стабильная 1.0, отдельные контракты | Каждая функция проходит собственный bounded MVP; никакого автоматического расширения promises 1.0 |

Критический путь: baseline → snapshot → structure/resolved plan → explicit nested layout → user decisions → inference → grid/wrap → RC. Project Styles дерева не должен блокировать первый HTML MVP. Ассеты и preview не являются скрытыми prerequisites ранних этапов: используются явные placeholders.

### Граница первого полезного экспорта

Первый HTML MVP поддерживает один выбранный Frame, вложенные прямоугольные Frame, простой горизонтальный/вертикальный Auto Layout без wrap, однородный Text и solid Rectangle. Fixed px; без guessed responsive, grid, сложных transforms, графических ассетов и автоматического semantic inference. Все реальные потомки видны в inspector, даже если конкретный тип пока не экспортируется. Это отличает полноту инспекции от полноты восстановления.

### Граница 1.0

В 1.0 входят bounded subtree inspection, безопасная редактируемая HTML-структура, explicit/inferred flex и ограниченный grid, nested/mixed layouts, подтверждаемые overlays, CSS одного resolved plan, диагностика, reset/undo, явная интеграция Styles и стабильные copy/export действия. Не входят произвольная browser cascade, восстановление поведения сайта, pixel-perfect для всех Figma типов и вывод адаптивности из одного viewport.

## 11. Тестирование и измеримая приёмка

На каждом изменении: npm run typecheck, npm test, npm run build по AGENTS.md. Для изменения только документации достаточно сверки ссылок/контрактов; не заявлять прохождение команд без запуска. Перед интеграционным handoff с реализацией — независимый review после интеграции, затем bounded fixes. Не менять чужие области ownership ради удобства теста.

| Уровень | Проверки |
|---|---|
| Adapter | DFS order, deep/wide trees, hidden/locked/instance/group/boolean, unavailable fields, mixed values, конечность чисел, JSON serialization; API reads остаются только в adapter |
| Main/transport | selection/page change, node удалён во время обхода, stale ответы, отмена, лимиты, progress ordering, malformed requests, недоступный узел, event storm, Worker/fallback при необходимости |
| Geometry/layout | row/column/block, 1 child, unequal gaps, space-between, wrap vs grid, spans, negative coordinates, overlap, nested containers, transformed parents, reflection/skew/singular matrices, padding+stroke и sizing cycles |
| Structure/HTML | content model, headings/list/interactive validation, whitespace/Unicode/empty text, malicious names/text/URLs, escaping, unique ids/classes, wrappers mapping, source vs DOM order |
| CSS | полное/поштучное copy используют одинаковые декларации; resolved conflicts; root без page offsets; fixed/fill/hug, relative+overlay, grid tracks; stable ordering/escaping; одиночный CSS не регрессировал |
| Decisions | apply/reset/undo/redo, nested dependencies, stale/rebase, исключение ветки, удаление родителя, invalid tracks/attrs, один и тот же input даёт одинаковый output |
| Styles | v0.6.1 tolerance, rem/font context, original matched CSS, low/conditional ограничения, class binding invalidation, отсутствие fetch/injected CSS |
| UI | keyboard tree navigation, раскрытие/focus/scroll, diagnostics links, disabled copy объясняет причину, clipboard failures, длинные названия, 320×300/699/700/wide, section persistence без лишних saves |

Golden fixtures хранить как синтетические нормализованные JSON + ожидаемый semantic/layout plan + HTML/CSS. Включить: карточку; header; текстовый блок; список; сетку 2×3; wrap с неодинаковыми строками; badge; overlap без absolute; group в повёрнутом parent; unsupported mask; mixed text; скрытую ветку; дерево за лимитом; быстрое переключение корня. Не сохранять клиентские production-макеты/полный CSS без явного разрешения.

Не ограничиваться snapshot-строками: проверять число и mapping экспортированных узлов, неизменность input, отсутствие NaN/Infinity, одинаковый output при повторном анализе, отсутствие потерянных веток, валидность контекста HTML и конфликтующих CSS-решений. Property-based идеи допустимы без обязательного нового dependency: генерация ограниченных синтетических деревьев и affine transforms в существующем Vitest.

Для поддержанных фиксированных примеров проверять геометрические anchors/размеры с бюджетом 1px или 0.1% размера оси (большее), отдельно документируя browser text rasterization. Бюджет не означает pixel-perfect и не применяется к неподдерживаемым эффектам/шрифтам. Если локального browser harness нет, visual comparison остаётся явной ручной проверкой, а не заявленным автоматическим тестом.

Performance gate на зафиксированной машине/runtime: 1000 простых узлов в пределах 10s timeout, отмена реагирует между участками обхода, UI не зависает на полном синхронном анализе. До RC измерить P50/P95 минимум 20 повторов, размер сообщений, время сбора/анализа/рендера отдельно; записать hardware/Figma version. При провале уменьшить supported budget или оптимизировать, не скрывать timeout. Виртуализация/порционная отрисовка дерева — только по замерам, с сохранением keyboard semantics.

Ручная Figma-матрица перед 1.0: Desktop, светлая/тёмная тема, минимальное/широкое окно, простой/вложенный Auto Layout, Wrap и grid при доступности API, manual Frames, hidden descendants/instances/masks, edits во время анализа, смена страницы, restart, Worker/fallback, clipboard errors. Не утверждать runtime validation до фактического прохождения. Отдельно открыть экспорт локально без сети и проверить DOM order, sizing, overflow, шрифты и отсутствие неожиданных запросов.

## 12. Ограничения Figma и открытые решения

- Макет не содержит достоверной HTML-семантики, бизнес-логики, keyboard interactions и intended reading order. Требуется участие пользователя.
- Один snapshot не доказывает breakpoints, responsive rules, intrinsic content sizing или поведение при другом тексте.
- Доступные API-поля зависят от node type, typings и runtime. Любые новые grid/wrap/constraints/sizing поля проверяются до расширения контракта; mixed/unavailable не превращаются в default.
- Group имеет производные границы; Boolean/mask/clip/blend не равны DOM containers. Flatten может изменить видимый результат.
- Figma и браузер различаются в шрифтах, line metrics, text wrapping, stroke/layout, effects и stacking. Недоступный локальный шрифт даёт warning, а не сетевую загрузку.
- Dynamic-page не даёт повода обходить весь документ. Область операции — выбранное поддерево; межстраничные ресурсы и component metadata не подгружаются автоматически.
- Imported CSS не содержит полный DOM/cascade/environment. Browser-equivalent computed style и гарантированное совпадение класса не входят в 1.0.
- Реальный предел message size/host responsiveness должен быть измерен; предлагаемые бюджеты не объявляются лимитами Figma API.

На baseline Lead закрепил ownership новых путей и политику version metadata в AGENTS.md. 24 ноября 2026 контракт schema v1 и начальные бюджеты зафиксированы в src/shared/tree.ts и docs/TREE_CONTRACT_v1.md. До завершения v0.7 остаются реализация state machine/обхода/UI, замеры и настройка бюджетов, решение о необходимости worker анализа; snapshot partial предназначен для просмотра, не готового экспорта. До v0.8: sizing mapping и конфликтные cases. До v0.9: grid API capability и tracks/spans support matrix. До RC: формат export manifest, правила semantic blockers и документированный support matrix.

## 13. После 1.0: отдельные направления

1. **Локальные ассеты:** явный экспорт растров/SVG через adapter, безопасная сериализация/проверка SVG, имена и ссылки, mask/boolean fallback. Ни внешних URL, ни автоматического скачивания. Gate: воспроизводимые local assets и отсутствие скрытых сетевых ресурсов.
2. **Rich text:** runs с разными шрифтами/стилями/links, корректные span и whitespace, смешанная типографика без потери characters. Gate: исходный текст сохраняется побайтово по строковому содержимому, стили ограничены достоверными полями.
3. **Transforms/effects:** affine export, сложные border/shadow/gradients с отдельной support matrix. Gate: browser/Figma comparisons на corpus, неизвестные blend/masks остаются предупреждениями.
4. **Несколько viewport:** пользователь связывает несколько блоков одного компонента; алгоритм предлагает rules и breakpoints с provenance. Gate: различия content/identity не принимаются за responsive переход.
5. **Component patterns:** выявление повторов и вариантов как локальные HTML/CSS patterns, без framework code generation. Gate: подтверждённая структура/варианты и отсутствие выдуманной интерактивности.
6. **Decision profiles:** явный локальный import/export настроек с schema migration, лимитами и review rebind. Не сохранять документные данные автоматически.
7. **Project Sync:** только отдельный локальный дизайн после решения о допустимом механизме доступа к файлам. Watcher/backend/network не добавляются в рамках действующих ограничений; текущий ручной import остаётся рабочим.

## 14. Порядок следующей задачи

Baseline v0.6.2 закрыт 24 ноября 2026 по gate раздела 10, ручная Figma-матрица явно остаётся not performed. Контракт Tree MVP A (shared/tree.ts, runtime-validation, request/revision/cancel/stale, branch completeness/hidden policy и начальные bounded limits) завершён 24 ноября 2026. Следующая отдельная задача — bounded adapter snapshot в src/adapter/tree.ts и его тесты, затем host state machine/transport, затем UI дерева. Milestone v0.7.0 остаётся открыт. Результат первой будущей реализации — bounded read-only дерево с проверенными revisions/cancel и явными пропусками, без HTML-эвристик. Передавать исполнителю конкретный этап, разрешённые файлы, контракт, fixtures и acceptance gate. После прохождения этапа обновлять этот документ фактическим статусом и доказательствами, не помечать будущие возможности выполненными по одному наличию кода.
