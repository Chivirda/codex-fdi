# Tree MVP A — контракт schemaVersion 1

Дата: 24 ноября 2026. Контракт реализован в src/shared/tree.ts и проверен tests/tree-contract.test.ts с синтетическими fixtures в tests/fixtures/tree/minimal.ts. Это подготовка v0.7.0, не выпущенная runtime-функция. Адаптер обхода реализован в src/adapter/tree.ts, main state machine, host handlers и UI дерева подключены; v0.7.0 остаётся preview до review/ручных gates. PluginMessage/UIMessage включают отдельные tree-unions, а InspectorState.ready и InspectorNode не меняются.

## Данные

TreeSnapshot содержит schemaVersion=1, requestId, documentSessionId, revision, rootId, includeHidden, nodes, sourceOrder, completeness, limits и diagnostics. nodes — таблица по id; sourceOrder — точный DFS preorder в исходном порядке детей. Корень имеет parentId=null; остальные узлы доступны ровно одним путём от корня. Дубликаты, циклы, orphans, противоречащие parent/child, несовпадающие id и порядок отклоняются.

TreeNode содержит id/parentId/childIds, branch и доступные исходные поля visible/locked, inspector, geometry. Размеры, текст и типографика переиспользуют InspectorNode, отдельные tree width/height не вводятся. Отсутствующие значения не заполняются догадками. Если узел недоступен, допустим placeholder без inspector/visible/locked с branch omitted/unavailable и диагностикой. Полностью прочитанные узлы имеют inspector. У hidden/unsupported/truncated placeholder inspector может отсутствовать; причина обязательна, исходные данные не подменяются. символы Figma.mixed, SceneNode, функции, NaN/Infinity не допускаются. characters допустим только у TEXT.

Геометрия необязательна: конечная 2×3 absoluteTransform, а для дочернего узла — доступная parentLocalTransform. У корня parentLocalTransform отсутствует. Adapter обязан вычислять parent-local через inverse(parent absolute) × child absolute, не relativeTransform. Контракт проверяет формат/конечность матриц, но не подтверждает правильность их вычисления или устойчивость inversion: это будущие adapter/geometry тесты. Ненадёжную производную геометрию нужно опустить с GEOMETRY_UNSTABLE. Никаких AABB/layout inference/HTML в контракте этого шага нет; положение корня на странице не превращается в CSS offsets.

## Полнота веток

- complete: все непосредственные дети представлены; пустая ветка действительно пуста.
- omitted: hidden или unavailable. childIds пуст, omittedChildren — число пропущенных детей либо null, если неизвестно.
- truncated: node-limit/depth-limit/time-limit/byte-limit/string-limit. childIds — представленный префикс детей в исходном порядке; omittedChildren >0 либо null; для string-limit/byte-limit допустим 0, если усечены свойства листа, а не потомки. Обход не должен скрыто пропускать середину списка.
- unsupported: placeholder с причиной и числом пропущенных детей либо null; childIds пуст. Сам узел виден в snapshot даже при невозможности прочитать его потомков.

includeHidden=false: обнаруженный visible=false сохраняется как omitted/hidden без обхода потомков. Включение hidden — новый запрос с includeHidden=true; скрытые узлы тогда могут быть прочитаны в общих пределах. locked не означает hidden. Скрытое состояние предка учитывает adapter; инспекция не изменяет видимость/locked в документе.

Любая неполная ветка делает весь snapshot partial и требует соответствующей диагностики этого узла: TREE_TRUNCATED, HIDDEN_BRANCH_UNREAD, NODE_UNAVAILABLE или NODE_UNSUPPORTED. diagnostics также могут содержать GEOMETRY_UNSTABLE. Диагностика содержит nodeId, severity, message, revision; узел должен существовать, revision совпадать. Неизвестный omittedChildren — null, не выдуманный 0. Snapshot с omitted/truncated/unsupported не маркируется complete. До HTML-этапа частичный snapshot предназначен только для просмотра и предупреждений, не готового экспорта.

## Сообщения и жизненный цикл

UI → main:

- tree-inspect: requestId (неотрицательный safe integer), rootId (ожидаемое текущее выделение), includeHidden.
- tree-cancel: requestId/documentSessionId/revision/rootId — точная identity операции.

Main → UI: tree-started; tree-progress(processedNodes); tree-ready(snapshot); tree-cancelled; tree-stale(reason: selection/page/document/refresh/replaced); tree-error(message). Все ответы содержат identity из четырёх полей. tree-ready envelope и snapshot должны иметь одинаковую identity. parseTreeUIMessage, parseTreePluginMessage, parseTreeSnapshot возвращают undefined для невалидного входа. sameTreeIdentity сравнивает все четыре поля, не только rootId/requestId.

Обязательства будущей state machine: main создаёт session id на запуск, назначает монотонную revision и не переиспользует requestId в сеансе UI. tree-inspect читает только один выбранный SceneNode текущей страницы при совпадении rootId. Без выделения/при multiple/mismatch — tree-error, не обход документа. Новая tree-команда/Refresh, selection/page/nodechange инвалидируют старую revision, отмена кооперативная между chunks. Консервативно инвалидировать nodechange всей текущей страницы, включая внешних предков; события coalesce. Новая выборка не может смешивать revisions.

Main и UI отбрасывают чужую/устаревшую identity. processedNodes монотонно растёт внутри одной операции; после ready/cancelled/stale/error прогресс и повторный ready не применяются. Эти temporal-инварианты невозможно проверить парсером одного сообщения: их реализация и тесты обязательны в main/UI следующего шага. Подтверждённый новый запрос имеет отдельный started; отмена старого не отменяет новый. Локальная активная строка дерева не меняет Figma selection или root snapshot.

## Начальные бюджеты

| Бюджет | Значение |
|---|---:|
| maxNodes, включая placeholders | 1000 |
| maxDepth, root=0 | 64 |
| maxMessageBytes, JSON UTF-8 включая envelope | 2 MiB |
| maxStringLength, одна строка UTF-16 | 65536 |
| maxStringUnits, все строки и ключи | 512 Ki UTF-16 units |
| maxDiagnostics | 2000 |
| maxWorkItems, preflight JSON | 100000 |
| chunkNodes / chunkMs | 50 / 8 ms |
| timeoutMs | 10000 ms |

limits в snapshot фиксирует точный набор TREE_LIMITS schema v1. UI не может увеличить бюджеты запросом; обновление политики требует новой согласованной версии контракта/миграции, если старые сообщения остаются в обращении. Это бюджеты приложения, не ограничения Figma API. Adapter должен оставлять место для envelope/диагностик и останавливать сбор до превышения лимита; парсер отклонит уже слишком большой snapshot, а не превратит его молча в partial. Слишком длинную исходную строку нельзя тихо обрезать: представить недоступность/усечение с причиной и диагностикой.

JSON preflight итеративен и ограничен работой/строками. Принимает обычные/null-prototype объекты и плотные массивы данных. Отклоняет getters без их вызова, symbol keys/values, prototype keys, циклы, повторные object references, sparse arrays, нечисловые API-объекты и неизвестные schema fields. Передавать именно JSON-дерево, не граф ссылок; structuredClone с aliasing не является этим контрактом. После bounded preflight считается размер сериализованного UTF-8, включая escaping строк. Валидатор проверяет снимок, но не восстанавливает частично невалидный результат.

## Проверки и остаток

24 ноября 2026: PASS — npm run typecheck; npm test (232 теста, 19 файлов); npm run build; git diff --check. Добавлены 22 contract cases, включая hidden/locked/unavailable, пять причин truncation, unsupported, source order и циклы/orphans, 1000 узлов/глубину 64, JSON bytes/strings/getters/symbols, finite geometry, metadata и stale envelope. Существующие 210 тестов прошли.

Проведён отдельный статический проход самопроверки схемы и тестов; независимый review другим исполнителем не выполнялся и остаётся обязательством будущей интеграции. Figma runtime, реальный обход 1000 узлов, responsive UI, отмена/таймауты в хосте и сохранённая baseline-матрица — not performed.

Adapter-подшаг завершён 24 ноября 2026: src/adapter/tree.ts и tests/tree-adapter.test.ts — итеративный bounded read-only snapshot с normalizeNode, placeholders, hidden policy, корректной parent-local геометрией, chunk/progress/cancel hooks. Host revision/cancellation integration в main с tests/tree-main.test.ts завершена следующим подшагом 24 ноября 2026; UI дерева остаётся впереди. UI дерева подключён отдельным подшагом ниже; завершение milestone всё ещё требует независимого review/ручной проверки и не следует из одного наличия кода.


## Реализованный adapter-подшаг — 24 ноября 2026

API: `captureTree(root: SceneNode, options: CaptureTreeOptions): Promise<CaptureTreeResult>`. Options содержит identity/includeHidden, обязательные isStale/isCancelled, необязательные onProgress, yieldControl и now. Результат — ready(snapshot), cancelled, stale или error(message). Это внутренний API адаптера, не transport-сообщение; main теперь вызывает его из отдельного tree lifecycle. Identity проверяется по контракту, rootId должен совпасть с переданным корнем. Invalid/missing root или невозможность сохранить identity — error без выдуманного placeholder id.

Обход итеративный DFS; стек хранит только текущие ancestor frames и индексы следующего ребёнка, не отдельную задачу на каждого ребёнка широкого узла. Не происходит обход всей страницы, чтение mainComponent, detach или изменения макета. normalizeNode переиспользуется для доступных свойств. Скрытая ветка по умолчанию сохраняется только по id/доступным flags; normalizeNode/children getter для неё не вызываются. Unsupported mask/vector сохраняются как terminal placeholders; Group/Boolean/Instance и Component Set сохраняют доступное дерево с предупреждениями о границах семантики. Locked не скрывается.

Chunk — не более 50 узлов либо 8ms между доступными точками yield. Default scheduler — setTimeout(0), возвращающий управление хосту; clock/scheduler инъецируются в тестах. Проверки stale/cancel выполняются между узлами, после yield и перед ready; callbacks main обязаны учитывать события страницы/selection/внешних предков. Adapter дополнительно проверяет removal/reparent текущего корня/обрабатываемых связей; родителей сравнивает по id, а не равенству API-обёрток. Это не заменяет будущую host state machine и не доказывает revision consistency без её isStale hook.

При node/time/string/serialized budget лимите отмечаются ещё не захваченные суффиксы детей у всех открытых ancestors, уже сохранённые дети остаются на месте. Слишком длинные свойства заменяются явным truncated/string-limit placeholder, без обрезки исходного текста и без подстановки имени. JSON-стоимость оценивается только по нормализованным данным, не через перечисление Figma API-объектов; учитываются escaping/UTF-8, aggregate strings и work. Зарезервировано место под terminal diagnostics/envelope. Поэтому при сложном содержимом бюджет может сработать раньше maxNodes; byte-limit включает ограничение работы сериализации. Перед ready весь envelope валидируется контрактом. Если валидный snapshot невозможен, возвращается error, не готовый невалидный результат.

Timeout кооперативен: отдельный синхронный API getter/normalizeNode нельзя прервать посередине. После возобновления применяются проверки бюджета; завершённый snapshot после общего timeout не выдаётся как успешный complete. Реальное время и задержку отмены в Figma необходимо измерить отдельно.

Parent-local математика выделена в переиспользуемую функцию src/geometry/spacing.ts; её использует и прежний calculateSpacing. Матрицы копируются в plain data, исходные normalized width/height не пересчитываются через AABB. При нестабильной geometry сохраняются только достоверные матрицы с GEOMETRY_UNSTABLE, производные координаты не выдумываются.

Уточнение schema v1 до подключения транспорта: inspector может отсутствовать у любой неполной ветки с соответствующей диагностикой; нулевой omittedChildren допустим при byte/string truncation свойств. Полностью прочитанный узел по-прежнему обязан иметь inspector. Добавлен отдельный contract regression case. Это расширение ещё не выпущенного контракта; API одиночного инспектора не менялся.

Проверки этого подшага: PASS — typecheck; 262 теста / 20 файлов (29 adapter cases и 1 contract case добавлены к 232); production build; git diff --check. Проверены очень широкие/глубокие деревья, hidden/locked, Group/Boolean/Instance, mask/vector, unavailable getters, mixed/пустой Unicode text, parent-axis transforms/reflection/skew, singular/nonfinite matrices, все budgets, progress/cancel/stale, scheduler errors и отсутствие мутаций. Это mocks и unit-тесты, не подтверждение реального Figma runtime/performance.

Самопроверка интеграции и регрессий выполнена; независимое review другим исполнителем не выполнялось и остаётся gate перед завершением Tree MVP A. В интерфейсе изменений пока нет. Main host state machine завершена следующим подшагом ниже; UI подключён следующим подшагом ниже; следующий gate — независимый review и ручная матрица.


## Реализованный host-подшаг — 24 ноября 2026

Main принимает tree-inspect/tree-cancel через parseTreeUIMessage и публикует отдельные TreePluginMessage через runtime-валидатор. Существующие inspector-state/Copy/Spacing/Styles/resize-handlers сохраняются. Адаптер вызывается только по явному валидному запросу для ровно одного выбранного root текущей страницы; поиск по документу не используется. До первой microtask started уже отправлен; немедленная отмена/замена может предотвратить даже первый adapter read.

На запуск main создаётся ephemeral documentSessionId, на принятый новый запрос — новая revision. requestId строго растёт в рамках живого UI/host сеанса: дубликаты и replay игнорируются; malformed input не отзывает текущую работу. Cancel действует только на running-операцию с точным совпадением всех четырёх полей identity. Старые/чужие cancel и cancel после ready не применяются. Session id — корреляционный токен, не security/DOM proof; в storage он не сохраняется.

Операция хранит identity/pageId/phase/progress, не snapshot или дерево API-объектов. Переходы: running → ready/error/cancelled/stale; ранее опубликованный ready → stale при инвалидизации. Selection/page/nodechange/Refresh/new tree-inspect синхронно отзывают актуальность и увеличивают revision. Nodechange текущей страницы, включая изменения внешних предков, консервативно инвалидирует snapshot. Уведомление stale для событий coalesced через один setTimeout(0); отзыв операции происходит сразу, поэтому результат, разрешившийся до timer, не может стать ready. Pending stale уведомление отправляется до нового запроса/cancel/Refresh. Edits не запускают новый обход автоматически; обычный одиночный inspect продолжает обновляться как раньше.

Progress — конечный safe integer 0…1000, строго больше уже опубликованного. Дубликаты, обратный порядок и невалидные значения отбрасываются. После terminal phase progress/ready не отправляются; invalidation готового snapshot является отдельным stale уведомлением, а не повторным ready. Итоговый snapshot проверяется по schema/envelope identity и не может иметь меньше узлов, чем уже опубликованный progress. Invalid/mismatched result или exception/rejection adapter дают tree-error; late completion/rejection от старой операции игнорируется.

Main дополнительно сверяет живую page/selection перед публикацией: даже пропущенное ожидаемое host event не разрешает результат другого root/page. Root edits/removal во время обхода дополнительно отслеживаются adapter hooks. Смена страницы снимает nodechange listener со старой и привязывает к новой; plugin close отзывает работу и очищает pending stale timer. Реальный порядок событий и поведение закрытия хоста ещё требуют Figma runtime-проверки.

Сбои postMessage не создают unhandled rejection tree-операции. Незнакомые/невалидные tree-сообщения не воздействуют на старые inspector paths. Нет сетевых запросов, автоматического subtree capture, сохранения snapshot в clientStorage или изменений макета.

Проверки: 24 ноября 2026 PASS — npm run typecheck; npm test (283 теста, 21 файл; +21 host case к прежним 262); npm run build; git diff --check; manifest по-прежнему запрещает сеть. Размер code.js 200787 байт, ui.html 225901 байт. Host-тесты покрывают start/progress/ready, отмену до/после запуска, replaced/replay/stale identities, document event storm, ready→stale, page listener rebinding, Refresh, selection/page changes без события, malformed/getter payload, adapter errors/invalid snapshots, progress rollback, close и один main→настоящий adapter flow.

Самопроверка выполнена. Независимое review другим исполнителем, Figma Desktop/runtime, performance/latency на реальном документе и ручная baseline-матрица — not performed. UI дерева подключён следующим подшагом ниже: Inspect subtree/cancel/progress/stale/локальная активная строка доступны как preview. Этап v0.7.0 остаётся открыт.


## Реализованный UI-подшаг — 24 ноября 2026

src/ui/tree.ts — самостоятельный контроллер секции Tree · preview, устанавливаемый один раз из index.ts. Секция доступна между CSS и Project Styles, включая empty/multiple selection, когда Inspect subtree отключён. Native details не пересоздаётся при обновлениях; дерево/опция Include hidden — session-local и не добавлены в прежний SectionState/clientStorage. Существующие Properties, Spacing, Copy Text/CSS и Project Styles остаются отдельными контроллерами Figma selection.

Inspect subtree отправляет явный запрос с монотонным requestId, rootId и Include hidden. Контроллер валидирует сообщения и schema, связывает request/session/revision/root, принимает progress/ready только после started, отбрасывает старые/чужие/повторные/обратные ответы и неверную hidden policy/финальный count. Некоррелированный ответ не меняет UI. Error до started разрешён только для текущего запроса и новой допустимой identity. Started фиксирует session; смена host session в середине UI-сеанса не принимается за продолжение старой операции.

Cancel завершает локальное ожидание немедленно. Если identity ещё неизвестна, первый поздний started используется только для точного tree-cancel; progress/ready больше не открывают отменённый результат. UI-watchdog равен 15s (= host timeout + 5s запаса) и тоже отзывает операцию/пытается отменить host. Pending операции после смены selection/options становятся локально stale; новый запрос запускается только явно. Inspector-state для того же root не сбрасывает фокус преждевременно: изменение потомка/предка обрабатывается авторитетным tree-stale от main. Смена root, loading/empty/multiple/error, includeHidden или tree-stale очищает snapshot и сведения, чтобы не показывать старое дерево как актуальное.

UI показывает число захваченных узлов, complete/partial, прогресс с явной подписью budget (не обещание общего числа узлов), явные placeholders и diagnostics. Дерево плоское по DOM, с aria-level/posinset/setsize/expanded/selected, roving tabindex и стрелочной навигацией. Глубина визуального отступа ограничена 6 уровнями (54px), настоящая aria-level сохраняется до 65. Длинное имя имеет ellipsis/tooltip; выбранное имя и причины доступны полностью в панели. Ссылка диагностики раскрывает ancestor path и фокусирует соответствующую строку. Мышью стрелка раскрывает ветку; double-click строки также переключает её. Enter/Space выбирают строку без изменения выделения Figma.

Локальная строка показывает доступные InspectorNode поля, branch/visibility/lock/parent/id, warnings, исходный текст и раскрываемый single-node CSS через прежний generateCSS. Это не CSS-экспорт дерева и не замена общего Copy CSS выбранного в Figma узла. Все design data проходят через textContent. HTML/экспорт, семантические/layout решения, новые сетевые вызовы, DOM injection и новые зависимости не добавлялись.

Рендер ограничен валидированными 1000 узлами и 2000 diagnostics; изначально раскрыт только root. Раскрытие не читает Figma API. Virtualization не вводилась без замеров. Блок дерева имеет внутреннюю вертикальную прокрутку, имена/типы могут сокращаться; детали/текст переносятся, CSS имеет собственный горизонтальный scroll. Static CSS-тесты подтверждают ограничения min-width/overflow/ellipsis, но не заменяют реальный layout/contrast/screenreader тест. Локальный Chromium/browser harness недоступен; проверка 320×300 в настоящем браузере/Figma не выполнена.

Проверки: 24 ноября 2026 PASS — typecheck; 303 теста в 22 файлах (+19 tree UI cases и +1 index relay case к 283); production build; git diff --check. Build: code.js 200787 байт, ui.html 244643 байт; Tree controls/JS/CSS inline, manifest networkAccess=[none]. Проверены keyboard/roving focus, раскрытие/diagnostic links, строки/Unicode без HTML, placeholders/partial, default/hidden policy, cancel до/после started, timeout/error, detached handlers, stale/replayed identities, same-root invalidation, лимит DOM, capped indentation и сохранение обычного CSS при relay дерева.

Самопроверка кода и автоматических регрессий выполнена. Независимое review другим исполнителем и ручные Figma/Desktop/performance/a11y проверки не выполнялись. UI-подзадача завершена, milestone v0.7.0 не закрыт. Следующий конкретный шаг — review интеграции и прохождение ручной матрицы ниже с фактическими результатами, а не переход к HTML v0.7.1.

### Ручная приёмка Tree MVP A — not performed

- Перезапустить собранный плагин, выбрать Frame с вложенными Frame/Text/Rectangle, нажать Inspect subtree. Сверить source order/count и данные выбранной локальной строки; canvas selection и Properties/Spacing/Copy CSS должны остаться на исходном root.
- Проверить collapse/expand, Tab, ↑/↓/←/→/Home/End/Enter/Space, ссылку диагностики на глубокий узел, tooltip и длинный/Unicode Text. Проверить фокус и скринридер в реальном Figma.
- Проверить Include hidden выключенный/включённый новым запросом, locked, Group в повёрнутом parent, Boolean/Instance и mask/vector placeholders. Partial не должен выглядеть как полный экспорт.
- На большом root отменить запрос, сразу запустить новый, быстро сменить root/страницу и редактировать потомка/внешний предок. Не должны появляться поздние ready/прогресс и stale данные; автоматического бесконечного recapture нет.
- Проверить 320×300, 699/700 и широкое окно, обе темы/контраст, доступность нижнего контента прокруткой и resize handle, исходные Copy Text/CSS/Properties/Spacing/Styles.
- Измерить реальный capture/render, отмену между chunks и размер сообщения на 1000 простых узлах/глубоких ветках; зафиксировать Figma version/hardware и результат. Отсутствие зависания/10s budget пока не подтверждено в хосте.


## Owner-directed useful structure slice — 24 ноября 2026

После просмотра Tree preview владелец уточнил полезный результат: копируемый HTML, теги, базовый класс и BEM-like children, по возможности использование существующего root CSS-класса. Поэтому отдельным явно запрошенным вертикальным срезом добавлен draft экспорт до завершения ручных Tree gates. Это изменение приоритета, не заявление о закрытии v0.7.0/v0.7.1 или реализации полной v0.9.1 Styles integration. Ownership зафиксирован в AGENTS.md до создания модулей.

src/shared/export.ts задаёт ExportOptions/StructurePlan/ExportDraft. src/structure/plan.ts строит плоский план с source id/parent/children mapping, тегом, className, оригинальным text, placeholders/excludedIds и diagnostics. Snapshot валидируется прежним контрактом; API/DOM недоступны чистому планировщику/serializer. Решения тегов/элементов ограничены текущими node IDs и сбрасываются на новом snapshot; введённые данные не меняют исходный snapshot.

Tag defaults: контейнер div, TEXT p; внутри явно выбранного phrasing-контекста — span. Heading/interactive semantics не выводятся из имени, размера или цвета. Ручные теги ограничены div/span/p/section/article/header/footer/nav/main/h1…h6/button. Button получает type=button, вложенные button и block children в phrasing-контексте блокируют вывод. Других атрибутов/URL/событий нет.

Root class — один ASCII CSS identifier без точки, до 80 символов. Children используют один namespace block__element, не накопление __ по глубине; element name по нормализованному латинскому имени слоя или type fallback, с ручной заменой до 48 символов и детерминированным suffix для коллизий. Нелатинские имена не переводятся эвристикой. Stable mapping гарантирован для одинакового snapshot/options, а не при произвольной вставке новых братьев между разными revisions.

src/export/serialize.ts выдаёт только строки HTML/CSS. HTML экранирует source text, сохраняет пробелы/Unicode/переносы без синтетического indentation внутри TEXT; непредставимый Unicode/NUL блокирует HTML. CSS использует generateDeclarations для каждого отображаемого узла, scoped selectors .block .block__element и явные structural resets (margin0, pre-wrap, inline-block для span, browser defaults для manual button). Flex берётся только из известного нормализованного Auto Layout; parent-relative transforms/позиции не превращаются в угаданный absolute CSS. Масштаб/поворот/скошенность отмечаются как unsupported для экспорта, не применяются скрытно.

Masks/vectors/unavailable/hidden превращаются в явные static comments, excluded source IDs учитываются отдельно; descendant subtree исключённого узла не теряется молча. Truncated captured prefix сохраняет явный marker. Это partial/draft с предупреждениями, не готовое восстановление дизайна. Структурированные diagnostics включают source warnings/layout uncertainty/exclusions. HTML/CSS после escaping ограничены 2 MiB суммарно; при превышении output очищается целиком и copy отключается.

src/ui/tree-export.ts — persistent controller внутри Tree, с Block class, выбранными Tag/BEM element, preview, Copy HTML draft / Copy CSS draft и clipboard fallback/errors. Изменение input немедленно отключает старые copy, пересчёт debounced 120ms. Copy привязан к версии draft; stale clipboard completion не сообщает успех для новых данных. Нет inject HTML/CSS, backend, сетевых запросов, авторизации, file writes или новых dependencies.

Project Styles получил optional callback/action Use as block class. Доступен только один copyable BEM-compatible root token; сложные селекторы/комбинации/utility punctuation не подставляются как блок. Корреляция по generation и выбранному root защищает от stale callbacks. Для conditional простого кандидата разрешён явный выбор **имени**, с предупреждением, что DOM/cascade не подтверждены. Назначение классов всем детям, подавление generated declarations, resolved imported CSS или минимальные subtree overrides не реализованы. Старое Use for override/Copy CSS не менялось.

Проверки: PASS typecheck, 332 теста в 25 файлах (+13 structure, +8 export, +7 export UI, +1 Project Styles root action к предыдущим 303), production build, git diff --check. code.js 200787 байт; ui.html 257328 байт; manifest networkAccess=[none]. Самопроверка и регрессии выполнены. Figma runtime/clipboard, реальная browser rendering с проектными шрифтами, min-size/focus/contrast, performance на реальном документе и независимое review другим исполнителем — not performed. Исходные UI gates Tree MVP A не закрыты, functional release version не повышена.

Следующий конкретный шаг — ручная оценка полезности на блоке Egispro и review serializer/content model/границ CSS draft. После подтверждения можно отдельно согласовать per-node class matching/bindings с известным контекстом; текущее root name действие не является реализацией этой будущей функции.
