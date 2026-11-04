# Weld Engineering

Система проектирования сварных соединений для машиностроения. Целевая платформа: Windows 10/11 x64.

**Состояние:** реализованы исходники Windows-приложения Tauri 2/React, независимый Rust application service и сохранение ревизий проектов в SQLite. Доступны геометрия линейных сечений, перенос нагрузки и номинальное F/A при нулевом моменте. Нормативная проверка прочности, PDF и функциональный прочностной MVP ещё не реализованы.

- [Контекст для продолжения разработки](docs/development-handoff.md)
- [Матрица всего продукта и приёмки](docs/scope-and-acceptance.md)
- [Требования](docs/product-requirements.md)
- [Архитектура](docs/architecture.md)
- [Запуск Windows-приложения и рабочий сценарий](docs/desktop-workflow.md)
- [Контракт application service](docs/application-contract.md)
- [Начало работы](docs/getting-started.md)
- [Исследование стандартов](docs/standards-research.md)
- [Методы](docs/engineering-methods.md)
- [Ограничения](docs/limitations.md)
- [Дорожная карта](docs/roadmap.md)

Windows CI проверяет Rust (fmt/Clippy/tests), frontend-тесты и сборку исполняемого файла. Результат конкретной версии проверяйте в Actions; подробная запись текущей итерации — docs/iteration-01.md. Математическая модель ещё не прошла независимую инженерную валидацию.

[Результаты самостоятельного исследования](docs/research-findings-2026-11-04.md).

[Продолжение исследования и номинальная прямая нагрузка](docs/research-continuation.md).

Полные публикации ГОСТов и книг хранятся только локально вне Git. В репозитории — код, собственная документация и библиографические метаданные.

Для запуска из исходников на Windows: установите необходимые инструменты и запустите **start.bat** в корне проекта. [Подробности](docs/desktop-workflow.md).
