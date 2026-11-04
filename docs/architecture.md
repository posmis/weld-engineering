# Архитектура и границы

## Решение
Rust workspace; Tauri 2, React/TypeScript, CSS, SQLite и Serde/JSON сохраняются как выбранный стек. Основная платформа Windows 10/11 x64. На текущем этапе реализован только crate weld-core без внешних зависимостей. Не создавать пустые модули с видимостью готовой функциональности.

План зависимостей: desktop → application service → geometry/mechanics/standards/materials → core. REST и отчёты обращаются к тому же application service. Расчёты не зависят от Tauri, SQLite, React или CAD. Критическая математика выполняется только Rust.

Будущие crate: weld-geometry, weld-mechanics, weld-standards, weld-materials, weld-optimization, weld-quality, weld-fatigue, weld-pressure, weld-reporting, weld-api. Выделять их из core по мере появления проверенной реализации. API core до версии 1.0 экспериментальный, не стабильный публичный контракт.

## Поток
Ввод → проверка конечности/единиц/геометрии → разрешение актуальной методики и источников → проверка области применимости → расчёт → независимые проверки → неизменяемый снимок результата → отображение/отчёт.

Неизвестная нормативная база блокирует расчёт прочности. Исторические редакции хранятся только для аудита исходных результатов и не доступны для нового расчёта. Это разрешает противоречие требований об edition selection: выбор редакции допустим в административном реестре, но не в расчётном GUI.

## Модель хранения (проект)
SQLite: standards, editions, amendments, status_checks, normative_parameters, methods, method_sources, method_validations, materials, material_properties, projects, calculation_snapshots. Каждая величина имеет единицу, применимость и ссылку на источник; NULL обозначает неизвестное, а не ноль. Публикация dataset транзакционная, с неизменяемой версией и хешем. Репозиторий не содержит реализацию SQLite.

CalculationSnapshot: schema_version, engine_version, dataset_version, input, original_result, method_id/version, sources, verification_time, units, assumptions, factor_overrides, warnings, validity. При открытии сохраняется исходный результат; пересчёт создаёт новый снимок с актуальным dataset.

## Риски
Неверная применимость строительных норм; неполнота поправок; лицензионные ограничения нормативных таблиц; неподтверждённые свойства материалов; смешение провара и несущего сечения; численная потеря точности; устаревание реестра. Меры: запрет по умолчанию, прослеживаемость каждого параметра, независимый инженерный обзор, отдельный статус математического и нормативного результата.
