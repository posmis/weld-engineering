"""Generate the project's original W mark as a Windows ICO using Python stdlib.
No reference publications or external artwork are used.
"""
from pathlib import Path
import struct

points = [(0.18, 0.22), (0.32, 0.78), (0.5, 0.49), (0.68, 0.78), (0.82, 0.22)]

def near_stroke(x, y):
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        dx, dy = bx - ax, by - ay
        fraction = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        if (x - ax - fraction * dx) ** 2 + (y - ay - fraction * dy) ** 2 < 0.0016:
            return True
    return False

images = []
for size in (32, 64):
    pixels = bytearray()
    for y in reversed(range(size)):
        for x in range(size):
            color = (240, 245, 250) if near_stroke((x + 0.5) / size, (y + 0.5) / size) else (21, 43, 64)
            pixels.extend((*reversed(color), 255))
    mask = bytes(((size + 31) // 32) * 4 * size)
    header = struct.pack('<IiiHHIIiiII', 40, size, size * 2, 1, 32, 0, len(pixels), 0, 0, 0, 0)
    images.append((size, header + pixels + mask))
offset = 6 + 16 * len(images)
entries = bytearray()
for size, blob in images:
    entries.extend(struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(blob), offset))
    offset += len(blob)
path = Path(__file__).resolve().parents[1] / 'apps/desktop/src-tauri/icons/icon.ico'
path.parent.mkdir(parents=True, exist_ok=True)
path.write_bytes(struct.pack('<HHH', 0, 1, len(images)) + entries + b''.join(blob for _, blob in images))
