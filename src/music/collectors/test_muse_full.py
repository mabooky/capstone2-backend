"""Full population staging and bounded-memory independent audit; offline only."""
import argparse
import csv
import ctypes
import json
import statistics
import time
from collections import Counter
from fractions import Fraction
from itertools import zip_longest
from pathlib import Path

from clean_muse import LOCAL, SOURCE_DIR, digest, run
from test_muse_scale import distribution


def peak_rss_bytes():
    # Windows process lifetime peak working set, includes interpreter and native allocations.
    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in ('PeakWorkingSetSize', 'WorkingSetSize',
            'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
            'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage')]
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    fn = ctypes.WinDLL('psapi', use_last_error=True).GetProcessMemoryInfo
    fn.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    if not fn(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError(ctypes.get_last_error())
    return counters.PeakWorkingSetSize


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=LOCAL / 'muse-cleaned/full-90408-v1')
    args = parser.parse_args()
    trial = args.output_dir
    started = time.perf_counter()
    stats = run(SOURCE_DIR / 'muse_dataset.csv', trial, 90408, 'all-v1')
    cleaned_at = time.perf_counter()
    clean_peak = peak_rss_bytes()
    with (SOURCE_DIR / 'muse_dataset.csv').open(encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    counts = Counter(r['spotify_id'] for r in rows if r['spotify_id'])
    axes = {(c['version'], c['metric']): [] for c in stats['configs']}
    quadrants = {v: [0, 0, 0, 0] for v in ('muse-theoretical-v1', 'muse-observed-v1')}
    checks, sources_count, scores_count = 0, 0, 0
    def check(value):
        nonlocal checks
        assert value
        checks += 1
    with (trial / 'song_sources.jsonl').open(encoding='utf-8') as sf, \
         (trial / 'classifications.jsonl').open(encoding='utf-8') as cf, \
         (trial / 'emotion_scores.jsonl').open(encoding='utf-8') as ef:
        for raw, source_line, class_line in zip_longest(rows, sf, cf):
            check(raw is not None and source_line is not None and class_line is not None)
            src, cl = json.loads(source_line), json.loads(class_line)
            check(src['external_id'] == raw['id'] and src['raw_payload'] == raw)
            check(src['song_id'] is None and src['match_status'] == 'pending' and
                  not src['is_recommendation_source'] and src['verified_at'] is None and src['match_evidence'] is None)
            candidate = raw['spotify_id'] or None
            check(src['candidate_spotify_id'] == candidate)
            category = 'missing_spotify_id' if not candidate else 'duplicate_spotify_id' if counts[candidate] > 1 else 'unique_unverified'
            check(cl['category'] == category and cl['population_id_count'] == (counts[candidate] if candidate else 0))
            check(cl['below_one'] == any(Fraction(raw[m + '_tags']) < 1 for m in ('valence', 'arousal')))
            points = {}
            for cfg in sorted(stats['configs'], key=lambda c: (c['version'], c['metric'])):
                entry = json.loads(next(ef))
                s, p = entry['insert_values'], entry['preview']
                check(entry['source_key'] == {k: src[k] for k in ('provider', 'external_id', 'source_version')})
                check(s == dict(metric=cfg['metric'], raw_value=raw[cfg['metric'] + '_tags'], normalization_version=cfg['version']))
                check(p['normalization_config'] == cfg and p['raw_min'] == cfg['raw_min'] and p['raw_max'] == cfg['raw_max'])
                value, lo, hi = map(Fraction, (s['raw_value'], cfg['raw_min'], cfg['raw_max']))
                exact = 2 * (value - lo) / (hi - lo) - 1
                check(-1 <= exact <= 1 and abs(Fraction(p['normalized_value']) - exact) < Fraction(1, 10**48))
                axes[(cfg['version'], cfg['metric'])].append(float(exact))
                points[(cfg['version'], cfg['metric'])] = exact
                scores_count += 1
            for version in quadrants:
                index = (2 if points[(version, 'valence')] >= 0 else 0) + (1 if points[(version, 'arousal')] >= 0 else 0)
                quadrants[version][index] += 1
            sources_count += 1
        check(next(ef, None) is None)
    check(sources_count == 90408 and scores_count == 361632)
    check(digest(SOURCE_DIR / 'muse_dataset.csv') == stats['source_sha256'])
    audit_seconds = time.perf_counter() - cleaned_at
    normalized = {version: dict(axes={m: dict(min=min(a), max=max(a), mean=statistics.mean(a),
        stddev=statistics.pstdev(a)) for (v, m), a in axes.items() if v == version},
        quadrants_vneg_aneg_vneg_apos_vpos_aneg_vpos_apos=quadrants[version]) for version in quadrants}
    raw_distribution = distribution(rows)
    report = dict(result='PASS', checks=checks, persisted_sources=sources_count, persisted_scores=scores_count,
        cleaning_seconds=cleaned_at - started, audit_seconds=audit_seconds,
        analysis_and_hashing_seconds=None, cleaning_peak_rss_bytes=clean_peak,
        memory_method='Windows GetProcessMemoryInfo PeakWorkingSetSize; lifetime OS process peak',
        distributions=raw_distribution, normalized_distributions=normalized,
        load_policy=dict(source_rows=90408, songs_inserted=0, unique_id_candidates=len(counts),
            singleton_id_candidates=sum(n == 1 for n in counts.values()),
            ambiguous_id_groups=sum(n > 1 for n in counts.values()),
            songs_eligible_under_current_unverified_policy=0,
            explanation='All original IDs key song_sources; candidate Spotify ID is nonunique. '
            'No candidate is inserted into songs before match verification. No representative duplicate row is chosen.'),
        artifacts_sha256={p.name: digest(p) for p in trial.iterdir() if p.is_file()},
        all_sources_unverified=True, original_sha256_unchanged=True,
        all_normalizations_match_exact_rational_within='1e-48', database_used=False)
    report['analysis_and_hashing_seconds'] = time.perf_counter() - cleaned_at - audit_seconds
    report['total_seconds'] = time.perf_counter() - started
    report['peak_rss_bytes'] = peak_rss_bytes()
    with (trial / 'validation.json').open('x', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps({k: report[k] for k in ('result', 'checks', 'persisted_sources', 'persisted_scores',
        'cleaning_seconds', 'audit_seconds', 'total_seconds', 'peak_rss_bytes')}))


if __name__ == '__main__':
    main()
