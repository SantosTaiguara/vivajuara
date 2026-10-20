"""Exports LotAnalysisInput (measurements at full precision) for the IntelligenceEngine.

Source: the measurement step of the 2026-10-06 analysis (geo_raw.json: geometry, neighbours and
distances measured on the official plan / KMZ / aerial image; data.txt: official areas) and the
route-flow count (same routine as the analysis: paths of other lots within 9 cells of the lot front).
Nothing here is a score or a judgement: it only copies measurements. Lot facts the analysis kept
as hard-coded lists (projected easement, cul-de-sac) become explicit input fields.
Usage: python3 export_analysis_input.py <geo_raw.json> <data.txt> <lots.json> <out.json>
"""
import json, sys, collections, hashlib
geo_path, data_path, lots_path, out_path = sys.argv[1:5]
G = json.load(open(geo_path)); known = {l.split()[0]: l.split()[1] for l in open(data_path)}
did = {l['id']: l['did'] for l in json.load(open(lots_path))}
cellpaths = collections.defaultdict(set)
for k, g in G.items():
    for p in g['path']: cellpaths[tuple(p)].add(('p', k))
    for p in g['path8']: cellpaths[tuple(p)].add(('c', k))
flow = {}
for k, g in G.items():
    r0, c0 = g['cell']; ids = set()
    for dr in range(-9, 10):
        for dc in range(-9, 10): ids |= cellpaths.get((r0 + dr, c0 + dc), set())
    flow[k] = sum(1 if t == 'p' else 0.5 for t, o in ids if o != k)
EASEMENT = {'N8', 'N11', 'N12', 'B67', 'B68'}
out = []
for lid in sorted(G, key=lambda s: (s[0], int(s[1:]))):
    g = G[lid]; d = g['dac']; q = lid[0]; n = int(lid[1:])
    out.append({
        'lotId': did[lid], 'code': lid, 'blockId': q, 'lotNumber': n,
        'geometry': {'areaM2': None if known[lid] == '?' else float(known[lid]), 'frontWidthM': g['w_front'], 'rearWidthM': g['w_back'], 'depthM': g['depth'],
                     'rectangularity': g['rect'], 'isCorner': bool(g['esquina']), 'hasTwoFronts': bool(g['vazado'])},
        'environmental': {'frontBearingDeg': g['front_bearing']},
        'surroundings': {'rearSequence': g['back'], 'rearVegetationShare': g['veg_back']},
        'location': {'distanceToGateLinearM': d['AC3 Guarita/Portaria'], 'distanceToClubLinearM': d['AC8 Clube'],
                     'distanceToPlaygroundM': min(d['AC11 Playground'], d['AC13 Playground']), 'distanceToSquareM': min(d['AC4 Praça'], d['AC5 Praça'], d['AC7 Praça']),
                     'distanceToTechnicalAreaM': d['AC6 EEEB (estação elevatória de esgoto)'], 'distanceToAdministrationM': d['AC2 Administração'],
                     'distanceToParkingM': d['AC1 Estacionamento'], 'distanceToExternalRoadM': g['d_avenida'],
                     'distanceToGreenAreaM': min(d['AC9 Parque Florestal 1'], d['AC10 Parque Florestal 2'], d['AC12 Parque Florestal 3'])},
        'mobility': {'routeDistanceToGateM': g['rota_portaria'], 'routeDistanceToLeisureM': g['rota_clube'], 'vehiclesPassingEstimate': flow[lid],
                     'isCulDeSac': q == 'Q' and n <= 3},
        'construction': {'adjacentToProjectedEasement': lid in EASEMENT},
    })
body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
doc = {'kind': 'lot-analysis-input', 'schemaVersion': '1.0', 'developmentId': 'viva-juara', 'inputVersion': 'measurements-2026-10-06',
       'sourceIds': ['official-plan-v1', 'kmz-v1', 'aerial-v1', 'routes-v1'], 'sha256': hashlib.sha256(body.encode()).hexdigest()[:16], 'lots': out}
json.dump(doc, open(out_path, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'lots', doc['sha256'])
