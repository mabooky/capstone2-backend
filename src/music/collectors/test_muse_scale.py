"""Reproducible 10k offline run and independent persisted-artifact audit."""
import csv
import hashlib
import json
import math
import statistics
import time
from bisect import bisect_right
from collections import Counter
from fractions import Fraction
from pathlib import Path

from clean_muse import LOCAL, SOURCE_DIR, digest, run

TRIAL = LOCAL / 'muse-cleaned/trial-10000-v1'


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]


def distribution(rows):
    n = len(rows)
    ids = Counter(r['spotify_id'] for r in rows if r['spotify_id'])
    result = dict(rows=n, unique_spotify_candidates=len(ids), verified_songs=0,
                  present_id_rows=sum(ids.values()), duplicate_groups_within_sample=sum(v > 1 for v in ids.values()),
                  duplicate_rows_within_sample=sum(v for v in ids.values() if v > 1),
                  excess_id_rows=sum(v - 1 for v in ids.values()),
                  below_one_rows=sum(min(float(r[c]) for c in ('valence_tags', 'arousal_tags')) < 1 for r in rows),
                  missing_rates={c: sum(not r[c].strip() for r in rows) / n for c in rows[0]})
    for metric in ('valence', 'arousal'):
        values = sorted(float(r[metric + '_tags']) for r in rows)
        def quantile(p):
            x = (n - 1) * p
            lo = int(x)
            return values[lo] + (values[min(lo + 1, n - 1)] - values[lo]) * (x - lo)
        result[metric] = dict(min=values[0], max=values[-1], mean=statistics.mean(values),
                              stddev=statistics.pstdev(values),
                              quantiles={str(p): quantile(p) for p in (.01, .25, .5, .75, .99)},
                              unit_bins_0_to_9=[sum(i <= v < i + 1 for v in values) for i in range(9)])
    grid = [[0] * 9 for _ in range(9)]
    for r in rows:
        grid[min(8, int(float(r['valence_tags'])))][min(8, int(float(r['arousal_tags'])))] += 1
    result['va_unit_grid'] = grid
    return result


def compare(sample, population):
    result = {}
    for metric in ('valence', 'arousal'):
        col = metric + '_tags'
        a, b = sorted(float(r[col]) for r in sample), sorted(float(r[col]) for r in population)
        ks = max(abs(bisect_right(a, x) / len(a) - bisect_right(b, x) / len(b)) for x in sorted(set(a + b)))
        std = statistics.pstdev(b)
        delta = statistics.mean(a) - statistics.mean(b)
        result[metric] = dict(ks_distance=ks, mean_delta=delta, standardized_mean_delta=delta / std,
                              mean_delta_standard_errors=delta / (std / math.sqrt(len(a)) *
                                  math.sqrt((len(b) - len(a)) / (len(b) - 1))))
    sa, sb = distribution(sample), distribution(population)
    result['va_grid_total_variation'] = sum(abs(sa['va_unit_grid'][i][j] / len(sample) -
        sb['va_unit_grid'][i][j] / len(population)) for i in range(9) for j in range(9)) / 2
    result['spotify_missing_rate_delta'] = sa['missing_rates']['spotify_id'] - sb['missing_rates']['spotify_id']
    return result


def main():
    started = time.perf_counter()
    stats = run(SOURCE_DIR / 'muse_dataset.csv', TRIAL, 10000, 'sha256-v1')
    cleaning_seconds = time.perf_counter() - started
    with (SOURCE_DIR / 'muse_dataset.csv').open(encoding='utf-8-sig', newline='') as f:
        population = list(csv.DictReader(f))
    by_id = {r['id']: r for r in population}
    sources = read_jsonl(TRIAL / 'song_sources.jsonl')
    scores = read_jsonl(TRIAL / 'emotion_scores.jsonl')
    classes = read_jsonl(TRIAL / 'classifications.jsonl')
    selected = [by_id[s['external_id']] for s in sources]
    expected = sorted(population, key=lambda r: (hashlib.sha256(
        (stats['selection_seed'] + '\0' + r['id']).encode()).digest(), r['id']))[:10000]
    assert {r['id'] for r in expected} == {r['id'] for r in selected}
    assert len(sources) == len({s['external_id'] for s in sources}) == 10000
    assert len(scores) == 40000
    counts = Counter(r['spotify_id'] for r in population if r['spotify_id'])
    for source, classification, original in zip(sources, classes, selected):
        assert source['raw_payload'] == original
        assert source['song_id'] is None and source['match_status'] == 'pending'
        assert source['is_recommendation_source'] is False
        candidate = original['spotify_id'] or None
        assert source['candidate_spotify_id'] == candidate
        category = ('missing_spotify_id' if not candidate else
                    'duplicate_spotify_id' if counts[candidate] > 1 else 'unique_unverified')
        assert classification['category'] == category
        assert classification['below_one'] == any(Fraction(original[m + '_tags']) < 1 for m in ('valence', 'arousal'))
    keys = set()
    for score in scores:
        s, p = score['insert_values'], score['preview']
        external_id = score['source_key']['external_id']
        k = (external_id, s['metric'], s['normalization_version'])
        assert k not in keys
        keys.add(k)
        assert s['raw_value'] == by_id[external_id][s['metric'] + '_tags']
        cfg = next(c for c in stats['configs'] if c['metric'] == s['metric'] and c['version'] == s['normalization_version'])
        assert p['normalization_config'] == cfg
        lo, hi, raw = map(Fraction, (cfg['raw_min'], cfg['raw_max'], s['raw_value']))
        exact = 2 * (raw - lo) / (hi - lo) - 1
        assert abs(Fraction(p['normalized_value']) - exact) < Fraction(1, 10**48)
        assert -1 <= exact <= 1
    assert digest(SOURCE_DIR / 'muse_dataset.csv') == stats['source_sha256']
    baseline = [s['raw_payload'] for s in read_jsonl(LOCAL / 'muse-cleaned/trial-100-v1/song_sources.jsonl')]
    report = dict(result='PASS', persisted_sources=len(sources), persisted_scores=len(scores),
                  cleaning_seconds=cleaning_seconds, audit_seconds=time.perf_counter() - started - cleaning_seconds,
                  selection_reproduced=True, raw_payload_and_score_strings_preserved=True,
                  classification_matches_full_population=True, all_sources_unverified=True,
                  all_normalizations_match_exact_rational_within='1e-48',
                  original_sha256_unchanged=True, database_used=False,
                  artifacts_sha256={p.name: digest(p) for p in TRIAL.iterdir() if p.is_file()},
                  distributions=dict(population=distribution(population), trial_100=distribution(baseline),
                                     trial_10000=distribution(selected)),
                  selection_bias=dict(trial_100=compare(baseline, population), trial_10000=compare(selected, population)),
                  interpretation='Row-level hash sample; no Spotify/score filtering, forced extrema, deletion or merging. '
                  'Candidate IDs are not verified songs. Empirical differences do not prove absence of selection bias.')
    with (TRIAL / 'validation.json').open('x', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps({k: report[k] for k in ('result', 'persisted_sources', 'persisted_scores', 'cleaning_seconds', 'audit_seconds')}))


if __name__ == '__main__':
    main()
