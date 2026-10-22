"""Freeze Census park context for IL/IN/WI and derive display layers without touching reporting polygons."""
import sys, json, hashlib, urllib.request, zipfile, io, datetime
from pathlib import Path
import shapefile
from pyproj import Transformer
from shapely.geometry import shape, mapping, box
from shapely.ops import transform

display_root, source_root = map(Path, sys.argv[1:3])
reuse = len(sys.argv) > 3 and sys.argv[3] == '--reuse-frozen'
source_root.mkdir(exist_ok=reuse)
frozen_sources = json.loads((source_root / 'sources.json').read_text()) if reuse else []
project = Transformer.from_crs('EPSG:4269', 'EPSG:4326', always_xy=True).transform
parks, sources = [], []
for state in ['17', '18', '55']:
    name = f'tl_2025_{state}_arealm'
    url = f'https://www2.census.gov/geo/tiger/TIGER2025/AREALM/{name}.zip'
    raw = (source_root / (name + '.zip')).read_bytes() if reuse else urllib.request.urlopen(url, timeout=60).read()
    if reuse:
        expected = next(item for item in frozen_sources if item['state'] == state)
        if hashlib.sha256(raw).hexdigest() != expected['sha256']:
            raise ValueError('Frozen park source checksum mismatch: ' + state)
    else:
        (source_root / (name + '.zip')).write_bytes(raw)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        reader = shapefile.Reader(shp=io.BytesIO(archive.read(name + '.shp')), shx=io.BytesIO(archive.read(name + '.shx')), dbf=io.BytesIO(archive.read(name + '.dbf')))
        for record in reader.iterShapeRecords():
            properties = record.record.as_dict()
            if str(properties.get('MTFCC', '')).startswith('K218'):
                parks.append((transform(project, shape(record.shape.__geo_interface__)), properties))
    sources.append(expected if reuse else {'url': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'state': state})
    print('Captured park context', state, flush=True)
if not reuse:
    (source_root / 'sources.json').write_text(json.dumps(sources, indent=2))
manifest_path = display_root / 'display-manifest.json'
manifest = json.loads(manifest_path.read_text())
for directory in sorted(p for p in display_root.iterdir() if p.is_dir()):
    output = directory / 'parks.geojson'
    if output.exists():
        raise RuntimeError('Refusing to replace existing park context: ' + str(output))
    bounds = json.loads((directory / 'boundary.json').read_text())['bounds']
    envelope = box(*bounds)
    features = []
    for geometry, properties in parks:
        if not geometry.envelope.intersects(envelope):
            continue
        display = geometry.intersection(envelope).simplify(0.00001, preserve_topology=True) if geometry.is_valid else geometry
        if not display.is_empty and display.geom_type in ['Polygon', 'MultiPolygon']:
            features.append({'type': 'Feature', 'geometry': mapping(display), 'properties': properties})
    raw = json.dumps({'type': 'FeatureCollection', 'features': features}, separators=(',', ':')).encode()
    output.write_bytes(raw)
    manifest.append({'market': directory.name, 'layer': 'parks', 'displaySha256': hashlib.sha256(raw).hexdigest(), 'displayOnly': True, 'toleranceDegrees': 0.00001, 'sources': sources})
    print(directory.name, len(features), flush=True)
manifest_path.write_text(json.dumps(manifest, indent=2))
