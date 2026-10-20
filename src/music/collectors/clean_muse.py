"""Offline MuSe staging; no network, database connection, merge, or raw rewrite."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal, localcontext
from pathlib import Path

MUSIC = Path(__file__).resolve().parents[1]
LOCAL = MUSIC / '.local'
SOURCE_DIR = LOCAL / 'music-muse/zenodo-4281165-v1.0.0'
VERSION = 'muse-cleaner-v1'
METRICS = {'valence': 'valence_tags', 'arousal': 'arousal_tags'}
COLUMNS = ['id', 'track', 'artist', 'valence_tags', 'arousal_tags',
           'dominance_tags', 'mbid', 'spotify_id']


def digest(path: Path) -> str:
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def number(value: str) -> Decimal:
    result = Decimal(value)
    if not result.is_finite():
        raise ValueError('Non-finite score')
    return result


def normalize(value: Decimal, lower: Decimal, upper: Decimal) -> Decimal:
    if not all(x.is_finite() for x in (value, lower, upper)):
        raise ValueError('Non-finite normalization input')
    if not lower < upper or not lower <= value <= upper:
        raise ValueError('Invalid bounds or score outside configured population range')
    with localcontext() as context:
        context.prec = 50
        return 2 * (value - lower) / (upper - lower) - 1


def load_configs(path: Path) -> dict:
    """Read the four published MuSe VALUES tuples, failing closed on SQL drift.

    This is deliberately a restricted extractor, not a general SQL parser.
    It never executes SQL. A new SQL configuration format requires an update.
    """
    sql = path.read_text(encoding='utf-8')
    numeric = r'([+-]?\d+(?:\.\d+)?)'
    pattern = re.compile(
        r"\(\s*'(muse-(?:theoretical|observed)-v1)'\s*,\s*'muse'\s*,\s*"
        r"'(valence|arousal)'\s*,\s*" + numeric + r'\s*,\s*' + numeric +
        r"\s*,\s*'([^']+)'\s*,\s*'([0-9a-f]{64})'\s*,\s*(\d+)\s*,\s*"
        r"'(theoretical|observed)'\s*\)")
    policy = re.search(r"'policy_date'\s*,\s*'(\d{4}-\d{2}-\d{2})'", sql)
    formula = re.search(r"'formula'\s*,\s*'([^']+)'", sql)
    if not policy or not formula or formula[1] != '2*(x-raw_min)/(raw_max-raw_min)-1':
        raise ValueError('Unsupported SQL normalization formula/metadata')
    configs = {}
    for match in pattern.finditer(sql):
        version, metric, lower, upper, source_version, sha, count, kind = match.groups()
        key = (version, metric)
        if key in configs:
            raise ValueError('Duplicate SQL configuration tuple')
        configs[key] = dict(version=version, provider='muse', metric=metric,
                            raw_min=lower, raw_max=upper, source_version=source_version,
                            source_sha256=sha, population_rows=int(count), kind=kind,
                            formula=formula[1], policy_date=policy[1])
    expected = {(v, m) for v in ('muse-theoretical-v1', 'muse-observed-v1') for m in METRICS}
    if configs.keys() != expected:
        raise ValueError('Expected exactly four supported MuSe SQL configurations')
    for cfg in configs.values():
        if not number(cfg['raw_min']) < number(cfg['raw_max']):
            raise ValueError('Invalid SQL normalization bounds')
    return configs


def classify(row: dict, id_counts: Counter) -> str:
    candidate = row['spotify_id'].strip()
    if not candidate:
        return 'missing_spotify_id'
    if not re.fullmatch(r'[0-9A-Za-z]{22}', candidate):
        return 'invalid_spotify_id'
    return 'duplicate_spotify_id' if id_counts[candidate] > 1 else 'unique_unverified'


def select_trial(rows: list[dict], limit: int) -> list[dict]:
    """Deterministic coverage trial: extrema, low scores, duplicate group, missing ID.

    Classification still uses the WHOLE population, never just selected rows.
    """
    if not 1 <= limit <= len(rows):
        raise ValueError('limit must be between 1 and population row count')
    selected = set()
    for col in METRICS.values():
        selected.add(min(range(len(rows)), key=lambda i: number(rows[i][col])))
        selected.add(max(range(len(rows)), key=lambda i: number(rows[i][col])))
    selected.update(i for i, r in enumerate(rows)
                    if r['id'] in ('73281', '73561'))
    groups = defaultdict(list)
    for i, row in enumerate(rows):
        if row['spotify_id'].strip():
            groups[row['spotify_id'].strip()].append(i)
    first_duplicate = next((group for group in groups.values() if len(group) > 1), [])
    selected.update(first_duplicate)
    missing = next((i for i, r in enumerate(rows) if not r['spotify_id'].strip()), None)
    if missing is not None:
        selected.add(missing)
    if len(selected) > limit:
        raise ValueError('limit too small for coverage trial; use at least 10')
    for i in range(len(rows)):
        if len(selected) == limit:
            break
        selected.add(i)
    return [rows[i] for i in sorted(selected)]


def transform(row: dict, id_counts: Counter, configs: dict, fetched_at: str) -> tuple:
    category = classify(row, id_counts)
    candidate = row['spotify_id'].strip() if category not in (
        'missing_spotify_id', 'invalid_spotify_id') else None
    source_version = configs[('muse-theoretical-v1', 'valence')]['source_version']
    key = dict(provider='muse', external_id=row['id'], source_version=source_version)
    source = dict(**key, song_id=None, fetched_at=fetched_at,
                  source_url='https://zenodo.org/records/4281165',
                  rights_reference='CC BY 4.0; Christopher Akiki and Manuel Burghardt; '
                                   'https://creativecommons.org/licenses/by/4.0/',
                  raw_payload=dict(row), candidate_spotify_id=candidate,
                  match_status='pending', match_evidence=None,
                  verified_at=None, is_recommendation_source=False)
    scores = []
    for (version, metric), cfg in sorted(configs.items()):
        raw = number(row[METRICS[metric]])
        value = normalize(raw, number(cfg['raw_min']), number(cfg['raw_max']))
        scores.append(dict(
            source_key=key,
            # Resolve the real FK from source_key during future authorized loading.
            insert_values=dict(metric=metric, raw_value=row[METRICS[metric]],
                               normalization_version=version),
            preview=dict(raw_min=cfg['raw_min'], raw_max=cfg['raw_max'],
                         normalized_value=str(value), normalization_config=cfg)))
    classification = dict(source_key=key, category=category,
                          raw_spotify_id=row['spotify_id'],
                          population_id_count=id_counts[row['spotify_id'].strip()] if candidate else 0,
                          below_one=any(number(row[c]) < 1 for c in METRICS.values()))
    return source, scores, classification


def write_jsonl(path: Path, values: list) -> None:
    with path.open('x', encoding='utf-8', newline='\n') as output:
        for value in values:
            output.write(json.dumps(value, ensure_ascii=False, allow_nan=False) + '\n')


def select_hash_trial(rows: list[dict], limit: int, seed: str) -> list[dict]:
    """Uniform hash ranking of unique source IDs; no ID/score filtering or forced cases."""
    if not 1 <= limit <= len(rows):
        raise ValueError('limit must be between 1 and population row count')
    ranked = sorted(rows, key=lambda row: (
        hashlib.sha256((seed + '\0' + row['id']).encode('utf-8')).digest(), row['id']))
    selected_ids = {row['id'] for row in ranked[:limit]}
    return [row for row in rows if row['id'] in selected_ids]


def run(input_path: Path, output_dir: Path, limit: int = 100,
        selection: str = 'coverage-v1', seed: str = 'muse-trial-10000-v1') -> dict:
    input_path, output_dir = input_path.resolve(), output_dir.resolve()
    if not output_dir.is_relative_to(LOCAL.resolve()) or output_dir == LOCAL.resolve():
        raise ValueError('Output must be a new subdirectory of src/music/.local')
    if output_dir.exists():
        raise FileExistsError('Refusing to overwrite an existing trial directory')
    config_path = MUSIC / 'db/002_normalization_v1.sql'
    configs = load_configs(config_path)
    raw_hash = digest(input_path)
    if any(c['source_sha256'] != raw_hash for c in configs.values()):
        raise ValueError('Input checksum differs from SQL normalization population')
    with input_path.open(encoding='utf-8-sig', newline='') as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != COLUMNS:
            raise ValueError('Unexpected original CSV columns')
        rows = list(reader)
    if any(None in r or any(v is None for v in r.values()) for r in rows):
        raise ValueError('Malformed CSV record')
    if len({r['id'] for r in rows}) != len(rows) or any(not r['id'] for r in rows):
        raise ValueError('Source row ID must be present and unique; refusing to deduplicate')
    if any(c['population_rows'] != len(rows) for c in configs.values()):
        raise ValueError('Input population row count differs from SQL config')
    baseline = json.loads((SOURCE_DIR / 'analysis.json').read_text(encoding='utf-8'))
    provenance = json.loads((SOURCE_DIR / 'provenance.json').read_text(encoding='utf-8'))
    if baseline['sha256'] != raw_hash or provenance['sha256'] != raw_hash:
        raise ValueError('Existing analysis/provenance does not identify this input')
    fetched_at = provenance['download_verified_at_utc']
    datetime.fromisoformat(fetched_at)  # Validate the recorded download timestamp.
    for metric, col in METRICS.items():
        values = [number(r[col]) for r in rows]
        observed = configs[('muse-observed-v1', metric)]
        if (min(values), max(values)) != (number(observed['raw_min']), number(observed['raw_max'])):
            raise ValueError('Whole-population extrema differ from published SQL config')
    counts = Counter(r['spotify_id'].strip() for r in rows if r['spotify_id'].strip())
    if sum(counts.values()) != baseline['spotify']['present'] or len(counts) != baseline['spotify']['unique_valid_ids']:
        raise ValueError('Population ID counts differ from existing analysis')
    if selection not in ('coverage-v1', 'sha256-v1', 'all-v1'):
        raise ValueError('Unknown selection method')
    if selection == 'all-v1' and limit != len(rows):
        raise ValueError('all-v1 requires limit equal to the full population')
    selected = (rows if selection == 'all-v1' else select_trial(rows, limit)
                if selection == 'coverage-v1' else select_hash_trial(rows, limit, seed))
    # Retain only the population index; emit transformed rows without accumulating scores.
    output_dir.mkdir(parents=True, exist_ok=False)
    categories, below_one = Counter(), 0
    with (output_dir / 'song_sources.jsonl').open('x', encoding='utf-8', newline='\n') as sf, \
         (output_dir / 'emotion_scores.jsonl').open('x', encoding='utf-8', newline='\n') as ef, \
         (output_dir / 'classifications.jsonl').open('x', encoding='utf-8', newline='\n') as cf:
        for row in selected:
            src, entries, classification = transform(row, counts, configs, fetched_at)
            assert src['raw_payload'] == row and len(entries) == 4
            assert all(-1 <= number(e['preview']['normalized_value']) <= 1 for e in entries)
            sf.write(json.dumps(src, ensure_ascii=False, allow_nan=False) + '\n')
            cf.write(json.dumps(classification, ensure_ascii=False, allow_nan=False) + '\n')
            for entry in entries:
                ef.write(json.dumps(entry, ensure_ascii=False, allow_nan=False) + '\n')
            categories[classification['category']] += 1
            below_one += classification['below_one']
    selected_ids = {r['id'] for r in selected}
    duplicate_ids = {r['spotify_id'].strip() for r in selected
                     if classify(r, counts) == 'duplicate_spotify_id'}
    population_groups, selected_groups = defaultdict(list), defaultdict(list)
    for row in rows:
        if row['spotify_id'].strip() in duplicate_ids:
            population_groups[row['spotify_id'].strip()].append(row['id'])
    for row in selected:
        if row['spotify_id'].strip() in duplicate_ids:
            selected_groups[row['spotify_id'].strip()].append(row['id'])
    duplicate_groups = [dict(spotify_id=spotify,
        selected_external_ids=selected_groups[spotify],
        population_external_ids=population_groups[spotify],
        population_count=counts[spotify]) for spotify in sorted(duplicate_ids)]
    assert len(selected_ids) == limit
    if digest(input_path) != raw_hash:
        raise ValueError('Input changed during conversion')
    stats = dict(
        cleaner_version=VERSION, generated_at_utc=datetime.now(timezone.utc).isoformat(),
        source_path=str(input_path), source_sha256=raw_hash,
        source_population_rows=len(rows), dataset_version=provenance['version'],
        source_version=configs[('muse-theoretical-v1', 'valence')]['source_version'],
        sql_config_sha256=digest(config_path), existing_analysis_sha256=digest(SOURCE_DIR / 'analysis.json'),
        selection=('coverage-v1: full-population extrema, low IDs, first duplicate group, first missing ID; fill in source order'
                   if selection == 'coverage-v1' else 'all-v1: full population in source order'
                   if selection == 'all-v1' else 'sha256-v1: lowest SHA256(UTF8(seed + NUL + original id)); ID tie-break; output in source order'),
        selection_seed=seed if selection == 'sha256-v1' else None,
        selected_external_ids=[r['id'] for r in selected],
        normalization_precision=50, decimal_values='JSON strings; convert to PostgreSQL numeric when authorized',
        counts=dict(selected_rows=limit, song_sources=limit, emotion_scores=4 * limit,
                    canonical_songs=0, **dict(categories),
                    below_one_rows=below_one,
                    selected_duplicate_id_groups=len(duplicate_groups)),
        configs=list(configs.values()),
        validation=dict(raw_payload_preserved=True, raw_hash_unchanged=True,
                        all_sources_pending=True, all_scores_in_minus1_plus1=True,
                        whole_population_bounds_verified=True,
                        database_connection=False, foreign_keys_resolved=False))
    (output_dir / 'duplicate_groups.json').write_text(
        json.dumps(duplicate_groups, ensure_ascii=False, indent=2), encoding='utf-8')
    (output_dir / 'stats.json').write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding='utf-8')
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=SOURCE_DIR / 'muse_dataset.csv')
    parser.add_argument('--output-dir', type=Path, default=LOCAL / 'muse-cleaned/trial-100-v1')
    parser.add_argument('--limit', type=int, default=100)
    parser.add_argument('--selection', choices=['coverage-v1', 'sha256-v1', 'all-v1'], default='coverage-v1')
    parser.add_argument('--seed', default='muse-trial-10000-v1')
    args = parser.parse_args()
    result = run(args.input, args.output_dir, args.limit, args.selection, args.seed)
    print(json.dumps(dict(output_dir=str(args.output_dir.resolve()), counts=result['counts'],
                          validation=result['validation']), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
