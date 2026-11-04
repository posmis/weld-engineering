# API — проект, не реализован

Будущие versioned маршруты: GET /api/v1/standards, /materials, /joints; POST /api/v1/joints/validate, /calculate, /optimize, /reports. Сервер по умолчанию только loopback, без публичной публикации. Нужны лимиты тела, количества сегментов и времени расчёта; точные лимиты определить при нагрузочной проверке. OpenAPI пока не реализован.

Предлагаемый запрос (не действующий endpoint):
```json
{"schema_version":1,"method_id":"pending-verification","units":{"length":"mm","force":"N","moment":"N_mm"},"segments":[{"start":[0,0],"end":[100,0],"effective_width":2}],"force":[0,10,0],"moment":[0,0,0],"application_point":[100,0,0]}
```
Предлагаемый ответ при отсутствии метода:
```json
{"schema_version":1,"validity":"unsupported_calculation","error":{"code":"method_not_verified","method_id":"pending-verification"},"strength_result":null}
```
Нельзя возвращать passed для геометрии как результат прочности. Stable schemas, serialization и application service предстоит реализовать.
