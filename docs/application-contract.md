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

### Editor settings v1

`get_editor_settings()` и `save_editor_settings(settings)` работают с отдельной строкой `editor_v1` в таблице `application_settings`. Поля: `schema_version=1`, положительные конечные `movement_step_mm`, `grid_step_mm`, `snap_tolerance_px` в диапазоне 1–64, булевы `snap_grid`, `snap_endpoints`, `snap_midpoints`, `snap_axes`. Неверные значения возвращают `invalid_settings`, неизвестные поля отклоняются. Отсутствующая строка даёт значения по умолчанию; повреждённая строка не перезаписывается автоматически.

SQLite `user_version=2`: миграция с v1 добавляет только таблицу настроек, сохраняя исходные документы ревизий. JSON schema проектов остаётся v1. Настройки редактора не входят в расчётный снимок.

### Номинальные моменты

Актуальное расширение CalculationResult: [nominal-bending-torsion.md](nominal-bending-torsion.md). Ненулевые моменты теперь могут возвращать computed с `method_id=elastic-line-traction-v1`, `traction_mpa=null` и опциональным `distribution`. Старый uniform computed остаётся прежним. UnsupportedLoading никогда не содержит ни uniform traction, ни distribution. Ill-conditioned изгиб помечается предупреждением ill_conditioned_section; численный отказ — AppError numerical_range. Исторические результаты без поля distribution открываются без пересчёта.


Новая итерация: [независимые нагрузочные случаи](load-cases.md), пакетный расчёт и сводка компонентов с определяющими случаями. Нормативная прочность не включена. Windows CI 41899254686 для 4a3d3b6: success. Нативная команда save_pdf_report(bytes) описана в [pdf-reports.md](pdf-reports.md).
