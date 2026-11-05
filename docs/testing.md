# Выполненные проверки — 2026-11-05

Проверенные исходники: `a757adcdd15b4a27ecad0ffb365677f670365b99`. [Windows run 41988936171 — SUCCESS](https://github.com/posmis/weld-engineering/actions/runs/41988936171). Цель — Windows x64, runner windows-2022. Linux/macOS сборки и испытания приложения не выполнялись.

- Rust fmt/Clippy: пройдены. 51 тест core/application/API, 0 failed; harness с нулём тестов не включены в сумму.
- Frontend: 56 тестов в каждом из трёх свежих процессов. Покрыты карта/знаки/ноль/экстремальный диапазон/устаревший снимок, масштаб, перенос и отмена, casebook, debounce и поздние ответы. IPC в unit-тестах подменяется; это не native integration.
- TypeScript/Vite, Windows dev-check и release EXE: пройдены.
- NSIS current-user installer: построен и установлен в изолированную директорию CI. Hash установленного EXE совпал с исходным после точной штатной замены Tauri bundle marker UNK→NSS; остальные байты проверяются полностью.
- Настоящее установленное окно: дерево/свойства, ввод/перенос/привязки/Undo/zoom/pan, сохранение и перезапуск SQLite, независимые случаи и прерывистые швы. Новый сценарий проверил σz/τy, слой F/M, сохранность проекта при выборе вида и refit после скрытия результатов.
- Нативное сохранение PDF по выбранному пути и независимый pypdf: две страницы, кириллица, математические знаки, оба исходных JSON-снимка и OFL-лицензия шрифта.
- Реальный API-процесс: loopback only, авторизация, аналитический ответ, OpenAPI schemas через Test-Json и настоящий запрос собранного C# client.
- Uninstall: EXE удалён, SQLite-проекты сохранены.

Снимки новой итерации просмотрены визуально: [карта](screenshots/viewport-contour.png), [нагрузка](screenshots/viewport-loads.png). [Артефакт с установщиком/EXE](https://github.com/posmis/weld-engineering/actions/runs/41988936171/artifacts/13397308473), retention 7 дней. Нормативные публикации/книги не использовались в CI и не входят в artifacts.

Не приняты: независимая инженерная валидация, нормативные методы/материалы/подбор, fatigue/pressure/quality/laser, отдельные пользовательские Windows 10/11 машины, подпись и автообновление, все произвольные пользовательские сценарии. Технический успех CI не равен нормативному pass. [Ограничения](limitations.md), [полный план](completion-status.md).

Исторические проверки сохранены в [iteration-01.md](iteration-01.md), [iteration-02.md](iteration-02.md), [iteration-03.md](iteration-03.md) и тематических документах. Команды повторения — [desktop-workflow.md](desktop-workflow.md), workflow .github/workflows/windows.yml. Документальные изменения без изменения исходников не требуют повторной длительной сборки.
