"""Build smaller display-only context layers; never alter boundaries or property coordinates."""
import sys, json, hashlib
from pathlib import Path
from shapely.geometry import shape, mapping, box

source, destination = map(Path, sys.argv[1:3])
destination.mkdir(exist_ok=False)
manifest = []
for directory in sorted(p for p in source.iterdir() if p.is_dir()):
    out = destination / directory.name
    out.mkdir()
    boundary_bytes = (directory / 'boundary.json').read_bytes()
    boundary = json.loads(boundary_bytes)
    (out / 'boundary.json').write_bytes(boundary_bytes)
    manifest.append({'market': directory.name, 'layer': 'boundary',
                     'sourceSha256': hashlib.sha256(boundary_bytes).hexdigest(),
                     'displaySha256': hashlib.sha256(boundary_bytes).hexdigest(), 'displayOnly': False})
    envelope = box(*boundary['bounds'])
    for layer in ['primary', 'secondary', 'local', 'water', 'municipalities']:
        raw = (directory / (layer + '.geojson')).read_bytes()
        collection = json.loads(raw)
        unclipped = 0
        if layer != 'municipalities':
            features = []
            for feature in collection['features']:
                geometry = shape(feature['geometry'])
                # Context layers only. Reporting polygons are copied byte-for-byte above.
                if geometry.is_valid:
                    display = geometry.intersection(envelope).simplify(0.00001, preserve_topology=True)
                else:
                    # Preserve imperfect source topology; SVG viewport clipping handles it.
                    # Strict topology failure alone is not a rendering rejection.
                    display = geometry
                    unclipped += 1
                if display.is_empty:
                    continue
                pieces = list(display.geoms) if display.geom_type == 'GeometryCollection' else [display]
                for piece in pieces:
                    if piece.geom_type not in ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']:
                        continue
                    features.append({**feature, 'geometry': mapping(piece)})
            collection['features'] = features
        compiled = json.dumps(collection, separators=(',', ':')).encode()
        (out / (layer + '.geojson')).write_bytes(compiled)
        manifest.append({'market': directory.name, 'layer': layer, 'sourceSha256': hashlib.sha256(raw).hexdigest(),
                         'displaySha256': hashlib.sha256(compiled).hexdigest(), 'sourceBytes': len(raw), 'displayBytes': len(compiled),
                         'displayOnly': True, 'unchangedTopologyFlaggedFeatures': unclipped,
                         'toleranceDegrees': 0 if layer == 'municipalities' else 0.00001})
    print(directory.name, flush=True)
(destination / 'display-manifest.json').write_text(json.dumps(manifest, indent=2))
