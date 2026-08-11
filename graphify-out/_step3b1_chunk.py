import json
from pathlib import Path
from collections import OrderedDict

CHUNK_SIZE = 22

detect = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding='utf-8'))
uncached = [line for line in Path('graphify-out/.graphify_uncached.txt').read_text(encoding='utf-8').splitlines() if line]
uncached_set = set(uncached)

images = [f for f in detect['files'].get('image', []) if f in uncached_set]
docs = [f for f in uncached if f not in set(images)]

# Group remaining (non-image) files by parent directory, preserving order of first appearance
by_dir = OrderedDict()
for f in docs:
    parent = str(Path(f).parent)
    by_dir.setdefault(parent, []).append(f)

chunks = []
current = []
for parent, files in by_dir.items():
    if current and len(current) + len(files) > CHUNK_SIZE:
        chunks.append(current)
        current = []
    current.extend(files)
    if len(current) >= CHUNK_SIZE:
        chunks.append(current)
        current = []
if current:
    chunks.append(current)

# Each image is its own chunk, appended after the doc chunks
for img in images:
    chunks.append([img])

manifest = {f'chunk_{i+1:02d}': files for i, files in enumerate(chunks)}
Path('graphify-out/.graphify_chunk_manifest.json').write_text(
    json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8'
)

print(f'{len(chunks)} chunks total ({len(docs)} docs + {len(images)} images)')
for name, files in manifest.items():
    print(f'  {name}: {len(files)} files')
