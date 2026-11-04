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
project = json.loads(reader.attachments["weld-project.json"][0])
cases = project["casebook"]["cases"]
assert len(cases) == 2
assert [case["force_n"][2] for case in cases] == [600.0, -600.0]
assert all(case["last_calculation"]["method_id"] == "elastic-line-traction-v1" for case in cases)
assert cases[0]["last_calculation"]["distribution"]["normal_range_mpa"] == [-18.5, 21.5]
assert cases[1]["last_calculation"]["distribution"]["normal_range_mpa"] == [-21.5, 18.5]
assert all(case["last_calculation"]["strength_status"] == "unsupported_calculation" for case in cases)
print(f"PASS: independent PDF parser reads {len(reader.pages)} pages, Cyrillic, mathematical signs and both original case snapshots.")
