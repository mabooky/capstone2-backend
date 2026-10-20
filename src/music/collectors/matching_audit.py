"""Offline identity audit. Never fetch, merge, select, or change verification state."""
import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from clean_muse import LOCAL, SOURCE_DIR, digest, number
from spotify_validate import canonical

POLICY = 'source-scoped-review-v1'
PROBE = LOCAL / 'reccobeats-probe/pipeline-stable-10-v1'
OUTPUT = LOCAL / 'matching-audit/stage2-v1'
SCORES = ('valence_tags', 'arousal_tags', 'dominance_tags')
EMPTY = {'', 'nan', 'null', 'none', 'na', 'n/a'}


def candidate_id(value):
    value = value.strip()
    return None if value.casefold() in EMPTY else value


def duplicate_group(sid, rows):
    """Describe independent conflict axes; numeric equality uses exact Decimal."""
    titles = {canonical(r['track']) for r in rows}
    artists = {canonical(r['artist']) for r in rows}
    title_conflict, artist_conflict = len(titles) > 1, len(artists) > 1
    kind = ('title_and_artist_conflict' if title_conflict and artist_conflict else
            'title_conflict' if title_conflict else 'artist_conflict' if artist_conflict else
            'same_metadata')
    score_variants = {tuple(number(r[k]) for k in SCORES) for r in rows}
    va_variants = {tuple(number(r[k]) for k in SCORES[:2]) for r in rows}
    raw_variants = {tuple((k, v) for k, v in sorted(r.items()) if k != 'id') for r in rows}
    mbids = {candidate_id(r['mbid']) for r in rows} - {None}
    return dict(spotify_id=sid, external_ids=sorted((r['id'] for r in rows), key=int),
                rows=len(rows), metadata_class=kind, title_variants=len(titles),
                artist_variants=len(artists), raw_payload_variants_excluding_id=len(raw_variants),
                vad_variants=len(score_variants), va_variants=len(va_variants),
                score_conflict=len(score_variants) > 1, va_conflict=len(va_variants) > 1,
                mbid_nonempty_variants=len(mbids), mbid_conflict=len(mbids) > 1,
                mbid_missing_rows=sum(candidate_id(r['mbid']) is None for r in rows),
                score_ranges={k: [str(min(number(r[k]) for r in rows)),
                                   str(max(number(r[k]) for r in rows))] for k in SCORES},
                decision='hold', match_status='pending', selected=False)


def assess(sid, external_id, comparison, evidence=None):
    """Return a review recommendation, NOT an SQL update or verified source.

    Evidence is reviewer-supplied and must bind both the original row and ID.
    This validates its shape, not its truth; independent evidence must be reviewed.
    """
    def result(decision, reason):
        return dict(decision=decision, reason=reason, match_status='pending',
                    eligible_for_reviewed_transition=decision == 'success', selected=False)
    if sid is None or not isinstance(sid, str) or not re.fullmatch(r'[A-Za-z0-9]{22}', sid):
        return result('hold', 'missing_or_invalid_candidate')
    if not isinstance(comparison, dict):
        return result('hold', 'missing_comparison')
    evidence = evidence if isinstance(evidence, dict) else {}
    bound = (evidence.get('spotify_id') == sid and evidence.get('external_id') == external_id
             and all(isinstance(evidence.get(k), str) and evidence[k].strip()
                     for k in ('method', 'reference', 'reviewer', 'reviewed_at')))
    if bound and evidence.get('same_recording') is False:
        return result('reject', 'reviewed_wrong_recording')
    if comparison.get('id_match') is not True:
        return result('hold', 'provider_identity_unconfirmed')
    if not bound or evidence.get('same_recording') is not True:
        return result('hold', 'independent_source_scoped_review_required')
    # Even text mismatch can be resolved by explicit independent recording evidence.
    return result('success', 'reviewed_same_recording')


def audit(output=OUTPUT):
    source = SOURCE_DIR / 'muse_dataset.csv'
    stats_path = LOCAL / 'muse-cleaned/full-90408-v1/stats.json'
    prior = json.loads(stats_path.read_text(encoding='utf-8'))
    validation = json.loads((stats_path.parent / 'validation.json').read_text(encoding='utf-8'))
    if validation['result'] != 'PASS' or digest(stats_path) != validation['artifacts_sha256']['stats.json']:
        raise ValueError('Staging metadata is not validated')
    original_hash = digest(source)
    if original_hash != prior['source_sha256']:
        raise ValueError('Original checksum mismatch')
    groups, originals = defaultdict(list), {}
    missing = invalid = count = 0
    with source.open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream):
            count += 1
            if row['id'] in originals:
                raise ValueError('Duplicate MuSe external ID')
            originals[row['id']] = row
            sid = candidate_id(row['spotify_id'])
            if sid is None:
                missing += 1
            elif not re.fullmatch(r'[A-Za-z0-9]{22}', sid):
                invalid += 1
            else:
                groups[sid].append(row)
    duplicates = [duplicate_group(sid, rows) for sid, rows in sorted(groups.items()) if len(rows) > 1]
    # Summaries only: no remote metadata or emotion values are copied from responses.
    probe = [json.loads(line) for line in (PROBE / 'results.jsonl').read_text(encoding='utf-8').splitlines()]
    sample = json.loads((PROBE / 'sample.json').read_text(encoding='utf-8'))
    expected = {r['spotify_id']: sorted(r['muse_external_ids']) for r in sample['candidates']}
    if sample['source_sha256'] != original_hash or len(probe) != len(expected) or len(expected) != 10:
        raise ValueError('Probe population mismatch')
    if len({r['spotify_id'] for r in probe}) != len(probe):
        raise ValueError('Duplicate probe candidate')
    reviews = []
    for row in probe:
        sid = row['spotify_id']
        refs = sorted(r['id'] for r in groups.get(sid, []))
        if refs != expected.get(sid) or sorted(row['muse_external_ids']) != refs:
            raise ValueError('Probe source reference mismatch')
        checks = row.get('metadata_check', {}).get('sources', [])
        if checks and sorted(c['external_id'] for c in checks) != refs:
            raise ValueError('Probe metadata reference mismatch')
        reviews.append(dict(spotify_id=sid, external_ids=refs, id_match=row['id_match'],
            lookup_outcome=row['lookup_outcome'], source_checks=checks,
            decisions=[dict(external_id=ref, **assess(sid, ref, row)) for ref in refs],
            mismatch_cause='unconfirmed_remote_text_not_retained' if any(
                c['title_match'] is False or c['artist_match'] is False for c in checks) else None))
    if (count, len(groups), missing, len(duplicates), sum(g['rows'] for g in duplicates)) != (90408, 60741, 28506, 1063, 2224):
        raise ValueError('Unexpected MuSe population')
    if digest(source) != original_hash:
        raise ValueError('Original changed during audit')
    summary = dict(policy=POLICY, source_sha256=original_hash, rows=count, unique_candidates=len(groups),
        missing_id_rows=missing, invalid_id_rows=invalid, duplicate_groups=len(duplicates),
        duplicate_rows=sum(g['rows'] for g in duplicates),
        group_size_histogram=dict(sorted(Counter(g['rows'] for g in duplicates).items())),
        metadata_classes=dict(Counter(g['metadata_class'] for g in duplicates)),
        raw_identical_groups=sum(g['raw_payload_variants_excluding_id'] == 1 for g in duplicates),
        score_conflict_groups=sum(g['score_conflict'] for g in duplicates),
        va_conflict_groups=sum(g['va_conflict'] for g in duplicates),
        mbid_conflict_groups=sum(g['mbid_conflict'] for g in duplicates),
        same_metadata_score_conflict_groups=sum(g['metadata_class'] == 'same_metadata' and g['score_conflict'] for g in duplicates),
        recco_id_matches=sum(r['id_match'] for r in reviews),
        recco_title_mismatch_rows=sum(c['title_match'] is False for r in reviews for c in r['source_checks']),
        recco_artist_mismatch_rows=sum(c['artist_match'] is False for r in reviews for c in r['source_checks']),
        actual_verified=0, api_calls=0, db_changes=0,
        input_sha256={str(p.relative_to(LOCAL)): digest(p) for p in [stats_path, PROBE/'sample.json', PROBE/'results.jsonl']})
    output = Path(output).resolve()
    if not output.is_relative_to(LOCAL.resolve()):
        raise ValueError('Audit outputs must stay in music/.local')
    output.mkdir(parents=True, exist_ok=False)
    for name, data in [('stats.json', summary), ('reccobeats-review.json', reviews)]:
        (output/name).write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    with (output/'duplicate-groups.jsonl').open('x', encoding='utf-8') as stream:
        for group in duplicates:
            stream.write(json.dumps(group, ensure_ascii=False)+'\n')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=OUTPUT)
    args = parser.parse_args()
    print(json.dumps(audit(args.output_dir), ensure_ascii=False))
