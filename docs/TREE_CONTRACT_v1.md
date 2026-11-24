# Tree MVP A — контракт schemaVersion 1

Дата: 24 ноября 2026. Контракт реализован в src/shared/tree.ts и проверен tests/tree-contract.test.ts с синтетическими fixtures в tests/fixtures/tree/minimal.ts. Это подготовка v0.7.0, не выпущенная runtime-функция. Адаптер обхода реализован в src/adapter/tree.ts, main state machine и host handlers подключены; UI дерева пока отсутствует. PluginMessage/UIMessage включают отдельные tree-unions, а InspectorState.ready и InspectorNode не меняются.

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

Adapter-подшаг завершён 24 ноября 2026: src/adapter/tree.ts и tests/tree-adapter.test.ts — итеративный bounded read-only snapshot с normalizeNode, placeholders, hidden policy, корректной parent-local геометрией, chunk/progress/cancel hooks. Host revision/cancellation integration в main с tests/tree-main.test.ts завершена следующим подшагом 24 ноября 2026; UI дерева остаётся впереди. UI дерева и завершение milestone требуют отдельной интеграции/review/ручной проверки, не следуют из одного наличия этого контракта.


## Реализованный adapter-подшаг — 24 ноября 2026

API: `captureTree(root: SceneNode, options: CaptureTreeOptions): Promise<CaptureTreeResult>`. Options содержит identity/includeHidden, обязательные isStale/isCancelled, необязательные onProgress, yieldControl и now. Результат — ready(snapshot), cancelled, stale или error(message). Это внутренний API адаптера, не transport-сообщение; main теперь вызывает его из отдельного tree lifecycle. Identity проверяется по контракту, rootId должен совпасть с переданным корнем. Invalid/missing root или невозможность сохранить identity — error без выдуманного placeholder id.

Обход итеративный DFS; стек хранит только текущие ancestor frames и индексы следующего ребёнка, не отдельную задачу на каждого ребёнка широкого узла. Не происходит обход всей страницы, чтение mainComponent, detach или изменения макета. normalizeNode переиспользуется для доступных свойств. Скрытая ветка по умолчанию сохраняется только по id/доступным flags; normalizeNode/children getter для неё не вызываются. Unsupported mask/vector сохраняются как terminal placeholders; Group/Boolean/Instance и Component Set сохраняют доступное дерево с предупреждениями о границах семантики. Locked не скрывается.

Chunk — не более 50 узлов либо 8ms между доступными точками yield. Default scheduler — setTimeout(0), возвращающий управление хосту; clock/scheduler инъецируются в тестах. Проверки stale/cancel выполняются между узлами, после yield и перед ready; callbacks main обязаны учитывать события страницы/selection/внешних предков. Adapter дополнительно проверяет removal/reparent текущего корня/обрабатываемых связей; родителей сравнивает по id, а не равенству API-обёрток. Это не заменяет будущую host state machine и не доказывает revision consistency без её isStale hook.

При node/time/string/serialized budget лимите отмечаются ещё не захваченные суффиксы детей у всех открытых ancestors, уже сохранённые дети остаются на месте. Слишком длинные свойства заменяются явным truncated/string-limit placeholder, без обрезки исходного текста и без подстановки имени. JSON-стоимость оценивается только по нормализованным данным, не через перечисление Figma API-объектов; учитываются escaping/UTF-8, aggregate strings и work. Зарезервировано место под terminal diagnostics/envelope. Поэтому при сложном содержимом бюджет может сработать раньше maxNodes; byte-limit включает ограничение работы сериализации. Перед ready весь envelope валидируется контрактом. Если валидный snapshot невозможен, возвращается error, не готовый невалидный результат.

Timeout кооперативен: отдельный синхронный API getter/normalizeNode нельзя прервать посередине. После возобновления применяются проверки бюджета; завершённый snapshot после общего timeout не выдаётся как успешный complete. Реальное время и задержку отмены в Figma необходимо измерить отдельно.

Parent-local математика выделена в переиспользуемую функцию src/geometry/spacing.ts; её использует и прежний calculateSpacing. Матрицы копируются в plain data, исходные normalized width/height не пересчитываются через AABB. При нестабильной geometry сохраняются только достоверные матрицы с GEOMETRY_UNSTABLE, производные координаты не выдумываются.

Уточнение schema v1 до подключения транспорта: inspector может отсутствовать у любой неполной ветки с соответствующей диагностикой; нулевой omittedChildren допустим при byte/string truncation свойств. Полностью прочитанный узел по-прежнему обязан иметь inspector. Добавлен отдельный contract regression case. Это расширение ещё не выпущенного контракта; API одиночного инспектора не менялся.

Проверки этого подшага: PASS — typecheck; 262 теста / 20 файлов (29 adapter cases и 1 contract case добавлены к 232); production build; git diff --check. Проверены очень широкие/глубокие деревья, hidden/locked, Group/Boolean/Instance, mask/vector, unavailable getters, mixed/пустой Unicode text, parent-axis transforms/reflection/skew, singular/nonfinite matrices, все budgets, progress/cancel/stale, scheduler errors и отсутствие мутаций. Это mocks и unit-тесты, не подтверждение реального Figma runtime/performance.

Самопроверка интеграции и регрессий выполнена; независимое review другим исполнителем не выполнялось и остаётся gate перед завершением Tree MVP A. В интерфейсе изменений пока нет. Main host state machine завершена следующим подшагом ниже; следующая ограниченная задача — UI дерева.


## Реализованный host-подшаг — 24 ноября 2026

Main принимает tree-inspect/tree-cancel через parseTreeUIMessage и публикует отдельные TreePluginMessage через runtime-валидатор. Существующие inspector-state/Copy/Spacing/Styles/resize-handlers сохраняются. Адаптер вызывается только по явному валидному запросу для ровно одного выбранного root текущей страницы; поиск по документу не используется. До первой microtask started уже отправлен; немедленная отмена/замена может предотвратить даже первый adapter read.

На запуск main создаётся ephemeral documentSessionId, на принятый новый запрос — новая revision. requestId строго растёт в рамках живого UI/host сеанса: дубликаты и replay игнорируются; malformed input не отзывает текущую работу. Cancel действует только на running-операцию с точным совпадением всех четырёх полей identity. Старые/чужие cancel и cancel после ready не применяются. Session id — корреляционный токен, не security/DOM proof; в storage он не сохраняется.

Операция хранит identity/pageId/phase/progress, не snapshot или дерево API-объектов. Переходы: running → ready/error/cancelled/stale; ранее опубликованный ready → stale при инвалидизации. Selection/page/nodechange/Refresh/new tree-inspect синхронно отзывают актуальность и увеличивают revision. Nodechange текущей страницы, включая изменения внешних предков, консервативно инвалидирует snapshot. Уведомление stale для событий coalesced через один setTimeout(0); отзыв операции происходит сразу, поэтому результат, разрешившийся до timer, не может стать ready. Pending stale уведомление отправляется до нового запроса/cancel/Refresh. Edits не запускают новый обход автоматически; обычный одиночный inspect продолжает обновляться как раньше.

Progress — конечный safe integer 0…1000, строго больше уже опубликованного. Дубликаты, обратный порядок и невалидные значения отбрасываются. После terminal phase progress/ready не отправляются; invalidation готового snapshot является отдельным stale уведомлением, а не повторным ready. Итоговый snapshot проверяется по schema/envelope identity и не может иметь меньше узлов, чем уже опубликованный progress. Invalid/mismatched result или exception/rejection adapter дают tree-error; late completion/rejection от старой операции игнорируется.

Main дополнительно сверяет живую page/selection перед публикацией: даже пропущенное ожидаемое host event не разрешает результат другого root/page. Root edits/removal во время обхода дополнительно отслеживаются adapter hooks. Смена страницы снимает nodechange listener со старой и привязывает к новой; plugin close отзывает работу и очищает pending stale timer. Реальный порядок событий и поведение закрытия хоста ещё требуют Figma runtime-проверки.

Сбои postMessage не создают unhandled rejection tree-операции. Незнакомые/невалидные tree-сообщения не воздействуют на старые inspector paths. Нет сетевых запросов, автоматического subtree capture, сохранения snapshot в clientStorage или изменений макета.

Проверки: 24 ноября 2026 PASS — npm run typecheck; npm test (283 теста, 21 файл; +21 host case к прежним 262); npm run build; git diff --check; manifest по-прежнему запрещает сеть. Размер code.js 200787 байт, ui.html 225901 байт. Host-тесты покрывают start/progress/ready, отмену до/после запуска, replaced/replay/stale identities, document event storm, ready→stale, page listener rebinding, Refresh, selection/page changes без события, malformed/getter payload, adapter errors/invalid snapshots, progress rollback, close и один main→настоящий adapter flow.

Самопроверка выполнена. Независимое review другим исполнителем, Figma Desktop/runtime, performance/latency на реальном документе и ручная baseline-матрица — not performed. UI дерева ещё не добавлен: Inspect subtree/cancel/progress/stale/локальная активная строка — следующий подшаг; старый UI tree-ответы пока не отображает. Этап v0.7.0 остаётся открыт.
