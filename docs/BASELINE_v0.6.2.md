# Baseline v0.6.2 — 24 ноября 2026

Checkpoint существующего поведения v0.6.1 перед контрактом Tree MVP A. Исходный HEAD при проверке: ece46e6. Рабочее дерево до начала было чистым. Изменены только документация и правила; src, tests, зависимости, конфигурация и manifest не менялись. Этот отчёт не подтверждает работу реального Figma runtime.

## Gate и политика версии

Критерии v0.6.2 из ROADMAP, раздел 10, выполнены: README/контракты сверены; typecheck/test/build прошли; ручные проверки явно помечены not performed; поведение Copy/Spacing/Styles не изменено. Milestone baseline закрыт, ручные проверки остаются в списке обязательств и не считаются выполненными.

Продуктовая функциональность остаётся v0.6.1; v0.6.2 — checkpoint baseline. Версия private npm-пакета пока 0.1.0. На принятом функциональном релизе integrating owner синхронизирует package.json и package-lock.json с принятой продуктовой версией, обновляет README. Незавершённый этап не становится выпущенной версией. manifest.api=1.0.0 задаёт Figma API, не версию продукта. Эта политика и ownership будущих путей записаны в AGENTS.md.

## Сверка контрактов и реализации

| Область | Сохранённый контракт / поведение | Доказательство baseline |
|---|---|---|
| Inspector | normalizeNode(SceneNode): InspectorNode; optional properties, warnings; empty/multiple/error/ready; обновление selection/page/node | shared/contracts.ts, adapter/normalize.ts, main.ts; adapter/main/ui tests |
| CSS и Copy | generateDeclarations — единый источник property/value/declaration; generateCSS — .inspected-element; неподдерживаемые значения не копируются | css/generate.ts, ui/index.ts; css/ui tests |
| Copy Text | characters только для TEXT, включая пустую строку, переносы/Unicode; textContent без HTML-инъекции | adapter/ui tests |
| Spacing | непосредственный parent, inverse absolute transform, четыре угла и знаковые AABB gaps; восемь значений в модели, шесть в UI | adapter/spacing.ts, geometry/spacing.ts; geometry/spacing-adapter/units/ui tests |
| UI/resize | 320×300…900×1200 с best-effort screen bounds; один/два столбца на 700px; Pointer Events, keyboard, debounce | shared/window-size.ts, ui/resize.ts, ui/style.css; resize/main/ui tests; реальные overflow/focus требуют Figma |
| Секции | properties/spacing/css сохраняются отдельно от размеров, поздний restore не отменяет действие пользователя | shared/sections.ts, ui/sections.ts, main.ts; sections/main tests |
| Styles import | AST-парсер, исходные значения/контекст, ограниченный индекс, атомарная замена одного файла; никакого injected CSS/import URL | styles/parser/index/session; parser/session/bundle tests |
| Styles matching | допуски px/opacity; rem с известной базой; собственный font-size для относительной типографики; честные conditional/low | styles/normalize/numeric/match; normalize/numeric/typography/match tests |
| Действия классов | Copy class для однозначных токенов; Copy matched CSS сохраняет source order/important/context; явный Use for override | shared/project-styles.ts, styles/index/match.ts, ui/project-styles.ts; numeric/project-ui tests |
| Override | только Different, без Missing/Incomparable; Different(0) → No override needed даже для conditional; иначе contextual override блокируется; выбор сбрасывается | styles/match.ts, ui/project-styles.ts; styles-match/project-ui tests |
| Transport/storage | typed PluginMessage/UIMessage, Worker-first и sandbox fallback; профиль — только whitelisted metadata, без полного CSS | shared/contracts.ts, styles/client/profile.ts, main.ts; client/session/main tests |

InspectorNode не содержит children. TreeSnapshot, HTML, layout inference, новые tree-сообщения и самостоятельный экспорт ещё не реализованы. Следующий контракт должен сохранить текущие API и разделить дерево и одиночный inspector-state. Права на будущие tree/structure/layout/export пути назначены в AGENTS.md; их создание не входит в этот checkpoint.

Исправлены только устаревшие формулировки README о Copy class для простого класса внутри media и порядке No override needed/conditional. Границы поведения не расширены. Дополнительный проход статической самопроверки документации выполнен; независимое review другим исполнителем не выполнялось. Runtime-интеграции на этом шаге нет; независимое review реализации остаётся gate соответствующего будущего этапа.

## Выполненные проверки

Среда: Node.js v24.14.0, npm 11.9.0, Vitest 5.1.0. Команды выполнены из корня проекта 24 ноября 2026.

| Проверка | Результат |
|---|---|
| npm run typecheck | PASS, tsc --noEmit |
| npm test | PASS, 210 тестов / 18 файлов |
| npm run build | PASS, esbuild production; embedded Worker 172406 символов |
| manifest.json и артефакты | PASS: существующие main/ui, editorType=figma, dynamic-page, networkAccess.allowedDomains=[none] |
| Автономность UI | PASS: JS/CSS inline, внешних script src и исходной style.css-ссылки нет |
| Размер code.js | 185207 байт |
| Размер ui.html | 225901 байт |

Проверки используют mocks и чистые данные. Browser-only Worker bundle также выполняется в изолированном VM-контексте без Node/Figma/DOM; это не замена CSP/runtime-проверке в Figma. Старый ориентир производительности Egispro не переснимался. Tree performance gate (1000 узлов, cancel, P50/P95) неприменим к текущей реализации и остаётся будущей проверкой.

## Ручная матрица Figma Desktop — not performed

Каждая строка ниже не выполнялась в этом baseline. Для последующей фиксации нужны версия Figma, тема, размеры окна, фактический результат и дата. Предыдущие пользовательские скриншоты не заменяют повторное прохождение матрицы.

| Сценарий | Действие и ожидаемый результат | Статус |
|---|---|---|
| Selection | Frame/Text, пустое/множественное выделение, edit и смена страницы; данные не застревают на старом элементе | not performed |
| Copy | Copy CSS, отдельная декларация, Copy Text с переносами/Unicode/пустой строкой; проверить вставку и clipboard failure | not performed |
| Spacing | Frame 300×200, child 80×50, x20/y30 → top30/right200/bottom120/left20; поворот parent и Group; отрицательные зазоры | not performed |
| Units | Spacing px/rem с базой 10/16 и некорректной базой; размеры модели неизменны | not performed |
| Resize/layout | 320×300, 699/700px, широкое окно; вертикальный/горизонтальный drag, потеря фокуса, отпускание за окном; контент доступен прокруткой | not performed |
| Accessibility | Tab/Enter/Space, видимый focus, длинное имя, tooltip, контраст светлой/тёмной темы и чтение подписей | not performed |
| Restart/storage | размеры и три основные секции восстанавливаются; профиль Styles сохраняет metadata, CSS требует повторного импорта | not performed |
| Import | несколько CSS через Windows/WSL, replace/remove/refresh, ошибка синтаксиса и лимит; исходные файлы неизменны | not performed |
| Matching/actions | 1.6rem/base10, 1.45/145%/1.45em, -.01em с font-size16; близкие px совпадают; исходный matched CSS сохраняет media | not performed |
| Override | до выбора .inspected-element; Different0 → No override needed; low — нейтральная подсказка; conditional с Different блокирует override; смена узла сбрасывает выбор | not performed |
| Host | реальный Worker/CSP fallback, длительный импорт, восстановление после timeout/error, clipboard API | not performed |

Известные границы baseline: Spacing unit/base сохраняются только в живом контроллере до закрытия UI; персистентный Project rem base — другая настройка. Project Styles details не входит в persisted SectionState из трёх основных секций. Нельзя обещать сохранение этих UI-параметров между запусками без отдельной реализации.

Следующая конкретная задача: зафиксировать shared/tree.ts — schema, revision/request/cancel/stale, полноту веток, hidden policy и начальные bounded limits с runtime-validation; затем отдельно реализовывать Tree MVP A по этому контракту. Ручную матрицу выше переносить как открытые проверки, не отмечать пройденной по результатам unit-тестов.
