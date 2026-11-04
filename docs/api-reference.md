# Локальный API v1

Отдельный процесс Windows x64: `start-api.bat` из корня либо `weld-api.exe --port 1421` из артефакта. Rust/Cargo нужны только запуску из исходников. Desktop автоматически сервер не запускает. Доступ только по IPv4 loopback, адрес нельзя заменить параметром. Остановка Ctrl+C; после штатной остановки token-файл удаляется. После аварийного завершения он может остаться, следующий запуск на том же порту заменяет его новым токеном.

Токен каждого запуска: `%LOCALAPPDATA%\WeldEngineering\api-1421.token`. Передавайте его в `Authorization: Bearer ...`, не в URL. Не публикуйте файл/токен. Другой локальный процесс того же пользователя может прочитать профиль, это не изоляция от владельца Windows-сеанса. Запросы с Origin отвергаются; браузерный CORS не включён. API не принимает пути к файлам и не открывает SQLite desktop.

[OpenAPI 3.1](openapi.json) и `GET /api/v1/openapi.json` описывают существующие endpoints:

| Метод | Маршрут | Назначение |
|---|---|---|
| GET | /api/v1/capabilities | Методы, ограничения и явно недоступные функции |
| POST | /api/v1/geometry/intermittent | Явные участки прерывистого шва, без нормативных ограничений |
| POST | /api/v1/calculate | CalculationInput → CalculationResult |
| POST | /api/v1/cases/calculate | Project с casebook → BatchResult |
| POST | /api/v1/projects/validate | Проверить проект/снимки без пересчёта, вернуть проект |
| GET | /api/v1/openapi.json | Спецификация |

Пример PowerShell 7:

```powershell
$token = [IO.File]::ReadAllText("$env:LOCALAPPDATA\WeldEngineering\api-1421.token")
$headers = @{ Authorization = "Bearer $token" }
$body = '{"schema_version":1,"segments":[{"start_mm":[-50,0],"end_mm":[50,0],"effective_width_mm":2}],"force_n":[400,-200,600],"couple_n_mm":[0,0,0],"application":{"kind":"centroid"}}'
$r = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:1421/api/v1/calculate -Headers $headers -ContentType application/json -Body $body
$r.traction_mpa # 2, -1, 3 MPa
$r.strength_status # unsupported_calculation
```

Ответ содержит schema_version=1, engine_version, method_id=uniform-direct-traction-v1, исходный input_snapshot, geometry (L=100 mm, A=200 mm², центр [0,0]), moment_at_centroid_n_mm=[0,0,0], traction_mpa=[2,-1,3], analysis_status=computed, strength_status=unsupported_calculation, validation_status=not_independently_validated и warnings. **computed не является проверкой прочности**. Полный воспроизводимый ответ задаётся application service, без альтернативной HTTP-формулы.

Геометрическая ошибка возвращается HTTP 422 с `{"code":"non_positive_dimension","field":null}` (пример: effective_width_mm=0), без напряжений. JSON/типовые ошибки дают 400/415/422, отсутствие токена 401, Origin 403, лимит тела 413, занятые workers 429, тайм-аут 408, внутренний отказ task 500. Неизвестные route/method дают 404/405. Все эти ответы имеют AppError code/field. Числа должны быть конечными, неизвестные поля отклоняются.

Лимиты: тело 1 MiB, 256 участков, 32 случая, два одновременно выполняющихся blocking workers, 15 s ожидания. После timeout/disconnect вычисляющий worker удерживает permit до завершения; новые запросы не создают бесконечные фоновые задачи. Это защита ресурса, не гарантия завершения произвольного расчёта за 15 s.

Нормативная прочность, fatigue, давление, laser, optimization и верифицированный каталог материалов пока недоступны. Endpoint-обёртки для этих функций не объявлены реализованными. PDF создаётся в desktop, не HTTP-сервисом.

Проверки — только Windows CI: HTTP router tests, реальный release-процесс, сокет 127.0.0.1, авторизация, аналитический ответ, OpenAPI и сборка C# примера. Результат текущего CI ещё ожидается.
