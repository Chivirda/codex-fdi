# Style Matching: диагностика Egispro

Диагностика выполнена на локальном fixtures/egispro/main.bundle.css: 559235 байт, 3984 правила, 1708 классов. Production CSS не включён в отчёт и не изменён. Sass-исходник не импортируется: скомпилированный простой селектор найден в CSS.

Воспроизведение использует только предоставленные свойства TEXT: Averta CY, 16px, 400, line-height 145%, letter-spacing -0.01em, opacity 1. Размеры и цвет не указаны; поэтому абсолютные score отличаются от скриншота.

## До исправления

| Candidate | Matched | Different | Missing | Incomparable | Score |
|---|---|---|---|---|---|
| .cookie-banner__text | font-size, font-weight | — | opacity, font-family | line-height, letter-spacing, margin-bottom, margin-left, margin-right, margin-top | 20 |
| .category-form__search--default | opacity, font-size, font-weight | — | font-family | line-height, letter-spacing, font-style, color | 38 |
| .constructor-item--free-subtitle | font-size, font-weight | — | opacity, font-family | line-height, letter-spacing, font-style | 29 |
| .event-modal__description | font-size, font-weight | — | opacity, font-family | line-height, letter-spacing, font-style | 29 |
| .header-modal__profile-text | font-size, font-weight | — | opacity, font-family | line-height, letter-spacing, font-style | 29 |
| .medication-modal__categories-item | font-size, font-weight | — | opacity, font-family | line-height, letter-spacing, font-style | 29 |

cookie-banner__text присутствовал в индексе, но получил 20 и не попал в top-12. Все классы оценивались до отсечения: проблема в нормализации и score, а не в парсере или UI. Число/процент line-height и em letter-spacing не нормализовались. Четыре longhand margin штрафовали результат, а opacity:1 добавляла конкуренту полный балл.

## После исправления

| Candidate | Matched | Different | Missing | Incomparable | Score |
|---|---|---|---|---|---|
| .cookie-banner__text | font-size, font-weight, line-height, letter-spacing | — | opacity, font-family | margin-bottom, margin-left, margin-right, margin-top | 80 |
| .category-form__search--default | opacity, font-size, font-weight, line-height, letter-spacing | — | font-family | font-style, color | 73 |
| .constructor-item--free-subtitle | font-size, font-weight, line-height, letter-spacing | — | opacity, font-family | font-style | 80 |
| .event-modal__description | font-size, font-weight, line-height, letter-spacing | — | opacity, font-family | font-style | 80 |
| .header-modal__profile-text | font-size, font-weight, line-height, letter-spacing | — | opacity, font-family | font-style | 80 |
| .medication-modal__categories-item | font-size, font-weight, line-height, letter-spacing | — | opacity, font-family | font-style | 80 |
| .category-offer__desc | font-size, font-weight, line-height, letter-spacing | — | opacity, font-family | font-style, -ms-grid-row, -ms-grid-row-span, grid-row, grid-column | 80 |
| .desc | font-size, font-weight, line-height, letter-spacing | — | opacity, font-family | font-style, max-height | 80 |

Текущий top-5: .category-offer__desc (80), .constructor-item--free-subtitle (80), .cookie-banner__text (80), .desc (80), .event-modal__description (80).

Относительная типографика вычисляется через собственный известный font-size каждой стороны: 1.45 × 16 = 23.2px; -0.01 × 16 = -0.16px. При неизвестном font-size совпадение не утверждается. Averta CY не приравнивается к Averta; наследование из body не приписывается классу.

Оценка использует вес 2 для типографики и 1 для других сравнимых свойств. opacity:1, box-sizing и свойства вне модели инспектора имеют вес 0; неизвестные декларации остаются в деталях и ограничивают confidence/override. Top-N и лимит пар не увеличены. Несколько классов имеют одинаковые четыре типографических совпадения; сортировка детерминирована, но уникальный правильный класс алгоритм не обещает.

Base .cookie-banner__text содержит все пять деклараций из SCSS. Отдельное правило media(max-width:600px) содержит font-size:14px и margin-bottom:16px; оно сохраняет условность и не заменяет базовые значения. Результат conditional/low, Copy Class/Override остаются ограничены. Глобальные правила анализируются отдельно и не становятся наследуемыми значениями класса.

Один локальный замер Node.js: parse+index 367.0 ms, один поиск по всем классам 35.9 ms. Это ориентир производительности, не замер Figma Desktop; индекс переиспользуется при выделении.

Ручная проверка: пересобрать и перезапустить плагин, импортировать main.bundle.css, база rem=10, выбрать исходный текст cookie-баннера. Проверить четыре matched-свойства, наличие cookie-banner__text среди релевантных, низкую уверенность и условия. Проверить читаемость Project Styles при 320×300 и широком окне, Copy CSS/Properties/Spacing, обновление выделения. Реальное время Worker/fallback и clipboard проверить в Figma Desktop.
