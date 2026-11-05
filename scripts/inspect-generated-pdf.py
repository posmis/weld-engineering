"""Windows CI: inspect the app's own synthetic PDF, never reference publications."""
import json
from pathlib import Path
from pypdf import PdfReader

path = Path(__file__).resolve().parent.parent / "target" / "weld-report-smoke.pdf"
reader = PdfReader(path)
text = "\n".join(page.extract_text() or "" for page in reader.pages)
assert "Новый проект" in text, "Cyrillic project title was lost"
assert "τx=Fx/A-Mz·y/J" in text, "Torsional sign was lost in PDF rendering"
assert "Iy·bx+Ixy·by=-My" in text, "Bending sign was lost in PDF rendering"
assert "?" not in text, "Synthetic engineering report has missing glyphs"
assert "Нагрузочный случай: LC1" in text and "Нагрузочный случай: LC2" in text
assert "Проверка прочности недоступна" in text
assert "Сводка независимых случаев: 2/2" in text
assert b"SIL OPEN FONT LICENSE" in reader.attachments["NotoSans-OFL.txt"][0]
project = json.loads(reader.attachments["weld-project.json"][0])
cases = project["casebook"]["cases"]
assert len(cases) == 2
assert [case["force_n"][2] for case in cases] == [600.0, -600.0]
assert all(case["last_calculation"]["method_id"] == "elastic-line-traction-v1" for case in cases)
assert cases[0]["last_calculation"]["distribution"]["normal_range_mpa"] == [-18.5, 21.5]
assert cases[1]["last_calculation"]["distribution"]["normal_range_mpa"] == [-21.5, 18.5]
assert all(case["last_calculation"]["strength_status"] == "unsupported_calculation" for case in cases)
print(f"PASS: independent PDF parser reads {len(reader.pages)} pages, Cyrillic, mathematical signs and both original case snapshots.")

mass_reader = PdfReader(path.with_name("weld-mass-report-smoke.pdf"))
mass_text = "\n".join(page.extract_text() or "" for page in mass_reader.pages)
assert "Нагрузка от массы m=10 kg" in mass_text
assert "F = m*(g - a)" in mass_text
assert "translating-mass-equivalent-load-v1" in mass_text
assert "right-angle-fillet-altitude-v1" in mass_text
assert "?" not in mass_text, "Mass/section report has missing glyphs"
mass_project = json.loads(mass_reader.attachments["weld-project.json"][0])
source = mass_project["input"]["forces"][0]
assert source["inertia"] == {"mass_kg":10.0,"gravity_m_s2":[0.0,0.0,-10.0],"acceleration_m_s2":[2.0,0.0,0.0]}
assert source["force_n"] == [-20.0,0.0,-100.0]
assert mass_project["input"]["segments"][0]["section"]["leg_1_mm"] == 3.0
assert mass_project["input"]["segments"][0]["section"]["leg_2_mm"] == 4.0
assert mass_project["last_calculation"]["input_snapshot"] == mass_project["input"]
assert mass_project["last_calculation"]["strength_status"] == "unsupported_calculation"
print("PASS: independent PDF parser reads mass/acceleration and fillet section provenance, current result snapshot and unsupported strength status.")

comb_reader = PdfReader(path.with_name("weld-combination-report-smoke.pdf"))
comb_text = "\n".join(page.extract_text() or "" for page in comb_reader.pages)
assert "user-linear-load-combination-v1" in comb_text
assert "коэффициент 1.25" in comb_text and "коэффициент -0.5" in comb_text
assert "коэффициенты не назначены по нормам" in comb_text
assert "?" not in comb_text
comb_project = json.loads(comb_reader.attachments["weld-project.json"][0])
active = next(c for c in comb_project["casebook"]["cases"] if c["id"] == comb_project["casebook"]["active_id"])
assert len(comb_project["casebook"]["cases"]) == 3
assert active["combination"]["method_id"] == "user-linear-load-combination-v1"
sources = active["combination"]["sources"]
assert [s["factor"] for s in sources] == [1.25, -0.5]
assert sources[1]["load"]["forces"][0]["inertia"]["mass_kg"] == 10.0
assert active["forces"][0]["force_n"] == [0.0, 0.0, 750.0]
assert [f["force_n"][2] for f in active["forces"]] == [750.0, 50.0, -150.0]
assert active["last_calculation"]["input_snapshot"] == comb_project["input"]
assert active["last_calculation"]["resultant_force_n"] == [10.0, 0.0, 650.0]
assert active["last_calculation"]["strength_status"] == "unsupported_calculation"
print("PASS: independent PDF parser reads explicit factors, frozen mass source, factored point loads and the actual combination result snapshot.")

edit_reader = PdfReader(path.with_name("weld-combination-edit-report-smoke.pdf"))
edit_text = "\n".join(page.extract_text() or "" for page in edit_reader.pages)
assert "user-linear-load-combination-v1" in edit_text
assert "коэффициент 2" in edit_text and "коэффициент -0.25" in edit_text
assert "?" not in edit_text
edit_project = json.loads(edit_reader.attachments["weld-project.json"][0])
assert len(edit_project["casebook"]["cases"]) == 3
assert edit_project["casebook"]["active_id"] == comb_project["casebook"]["active_id"]
edit_case = next(c for c in edit_project["casebook"]["cases"] if c["id"] == edit_project["casebook"]["active_id"])
edit_sources = edit_case["combination"]["sources"]
assert [s["factor"] for s in edit_sources] == [2.0,-0.25]
assert [s["load"] for s in edit_sources] == [s["load"] for s in sources]
assert [s["case_id"] for s in edit_sources] == [s["case_id"] for s in sources]
assert [f["force_n"][2] for f in edit_case["forces"]] == [1200.0,25.0,-75.0]
assert edit_case["last_calculation"]["resultant_force_n"] == [5.0,0.0,1150.0]
assert edit_case["last_calculation"]["input_snapshot"] == edit_project["input"]
assert edit_case["last_calculation"]["strength_status"] == "unsupported_calculation"
assert edit_project["casebook"]["cases"][:2] == comb_project["casebook"]["cases"][:2]
print("PASS: edited combination keeps its ID/case count/frozen sources and original cases, and PDF contains new factors and the actual 1150 N result.")

material_reader = PdfReader(path.with_name("weld-material-report-smoke.pdf"))
material_text = "\n".join(page.extract_text() or "" for page in material_reader.pages)
assert "Пользовательские материалы" in material_text
assert "не проверенная база ГОСТ" in material_text
assert "Источник свойства: User record M-001" in material_text
assert "Synthetic base" in material_text and "21 mm" in material_text
base_section = material_text.split("Основной металл",1)[1].split("Наплавленный металл",1)[0]
assert "Для контекста Rp0.2: неизвестно" in base_section
assert "?" not in material_text
material_project = json.loads(material_reader.attachments["weld-project.json"][0])
assignment = material_project["materials"]
assert assignment["context"] == {"thickness_mm":21.0,"temperature_c":20.0}
assert assignment["base"]["kind"] == "custom"
assert assignment["base"]["properties"][0] == {"kind":"yield_strength","value":300.0,"thickness_mm":[0.0,20.0],"temperature_c":[20.0,20.0],"source":"User record M-001"}
assert assignment["weld"] is None
assert material_project["casebook"] == edit_project["casebook"]
assert material_project["input"] == edit_project["input"]
assert material_project["last_calculation"] == edit_project["last_calculation"]
assert material_project["last_calculation"]["strength_status"] == "unsupported_calculation"
print("PASS: custom materials, explicit source/ranges and unknown out-of-domain property in PDF; all nominal snapshots preserved and no normative acceptance.")

limit_reader = PdfReader(path.with_name("weld-user-limits-report-smoke.pdf"))
limit_text = "\n".join(page.extract_text() or "" for page in limit_reader.pages)
assert "Контроль пользовательских пределов" in limit_text
assert "В пределах пользовательских значений" in limit_text
assert "Не нормативная прочность" in limit_text
assert "?" not in limit_text
limit_project = json.loads(limit_reader.attachments["weld-project.json"][0])
comparison = json.loads(limit_reader.attachments["user-limit-comparison.json"][0])
assert limit_project["casebook"] == material_project["casebook"]
assert limit_project["last_calculation"] == material_project["last_calculation"]
assert limit_project["input"] == material_project["input"]
assert limit_project["materials"] == material_project["materials"]
assert comparison["limits"] == limit_project["user_limits"]
assert comparison["status"] == "within_user_limits" and comparison["available"] == comparison["total"] == 3
assert comparison["strength_status"] == "unsupported_calculation"
assert comparison["validation_status"] == "not_independently_validated"
import math
ratios=[]
for case in limit_project["casebook"]["cases"]:
    row=next(r for r in comparison["cases"] if r["case_id"]==case["id"])
    result=case["last_calculation"]
    field=[result["traction_mpa"]] if result["traction_mpa"] is not None else [v for segment in result["distribution"]["segments"] for v in [segment["start_mpa"],segment["end_mpa"]]]
    expected={"tension":max(0.0,max(v[2] for v in field)),"compression":max(0.0,-min(v[2] for v in field)),"shear":max(math.hypot(v[0],v[1]) for v in field)}
    for kind,demand in expected.items():
        threshold=limit_project["user_limits"][kind]["value_mpa"]
        assert threshold == 1000000.0
        assert math.isclose(row[kind]["demand_mpa"],demand,rel_tol=1e-12,abs_tol=1e-12)
        assert math.isclose(row[kind]["ratio"],demand/threshold,rel_tol=1e-12,abs_tol=1e-15)
        ratios.append(demand/threshold)
assert math.isclose(comparison["maximum_ratio"],max(ratios),rel_tol=1e-12)
print("PASS: independent PDF parser verifies user threshold ratios against original signed normal/vector shear fields; physics snapshots unchanged and normative strength unsupported.")
