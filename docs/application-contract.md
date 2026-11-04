# Application service contract v1

Crate `weld-application` не зависит от Tauri/React. `calculate` принимает CalculationInput и возвращает CalculationResult либо сериализуемую AppError с code/field. Неизвестные поля входа отклоняются. Единицы закреплены в именах полей: mm, N, N·mm, MPa.

```json
{
  "schema_version": 1,
  "segments": [{"start_mm": [-50, 0], "end_mm": [50, 0], "effective_width_mm": 2}],
  "force_n": [400, -200, 600],
  "couple_n_mm": [0, 0, 0],
  "application": {"kind": "centroid"}
}
```

Это аналитический пример: A=200 mm², номинальные компоненты (2,-1,3) MPa, центр (0,0), момент (0,0,0). Для произвольной точки application принимает `{"kind":"point","point_mm":[100,0,0]}`. Момент переносится по r×F; ненулевой результирующий момент блокирует выдачу F/A.

Успешный математический ответ содержит geometry, input_snapshot, engine_version, method_id=`uniform-direct-traction-v1`, moment_at_centroid_n_mm, traction_mpa и независимые статусы:

- analysis_status: computed либо unsupported_loading;
- strength_status: всегда unsupported_calculation;
- validation_status: всегда not_independently_validated.

Ни computed, ни наличие traction_mpa не означают, что соединение выдерживает нагрузку. Для unsupported_loading поле traction_mpa=null. Ошибки геометрии возвращаются как Err, а не как численный результат с pass.

Tauri commands: calculate_joint(input), save_project(project), list_projects(), open_project(id), import_project(text), export_project(project). Они только адаптируют application service. SQLite недоступен frontend напрямую. Нет HTTP-сервера и публичного сетевого сервиса. Документ api-reference.md пока описывает будущий REST, не существующий endpoint.

Project содержит schema_version, title, input и nullable last_calculation. Если результат есть, его input_snapshot обязан совпадать с input; неподдерживаемая версия, неконечные числа и противоречивые статусы/напряжения отклоняются. Проверка структуры не гарантирует подлинность внешнего результата и не является пересчётом.
