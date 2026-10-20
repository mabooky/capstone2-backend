"""Bounded live capability probe. Never persist metadata or emotion values."""
import argparse
import json
import subprocess
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, localcontext
from pathlib import Path
from urllib.parse import urlencode, urlparse

from clean_muse import LOCAL, digest
from spotify_validate import canonical, prepare_sample, transport

BASE = 'https://api.reccobeats.com/v1'


def powershell_transport(method, url, headers, data):
    """Native Windows HTTP client -> memory pipe -> existing Python comparison.

    No raw response files, shell interpolation, auth, proxy or TLS overrides.
    """
    parsed = urlparse(url)
    if method != 'GET' or data is not None or parsed.scheme != 'https' or parsed.netloc != 'api.reccobeats.com':
        raise ValueError('Only unauthenticated ReccoBeats HTTPS GET is allowed')
    script = r'''
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
try {
    $response=Invoke-WebRequest -Uri $request.url -Headers @{Accept='application/json'} -UseBasicParsing -TimeoutSec 20
    $safeHeaders=@{}
    if ($response.Headers['Retry-After']) { $safeHeaders['Retry-After']=[string]$response.Headers['Retry-After'] }
    $result=@{status=[int]$response.StatusCode; headers=$safeHeaders; payload_json=[string]$response.Content}
} catch {
    $http=$_.Exception.Response
    $code=0
    if ($null -ne $http) { $code=[int]$http.StatusCode }
    $safeHeaders=@{}
    if ($null -ne $http -and $http.Headers['Retry-After']) { $safeHeaders['Retry-After']=[string]$http.Headers['Retry-After'] }
    $result=@{status=$code; headers=$safeHeaders; payload=$null}
}
[Console]::Out.Write(($result | ConvertTo-Json -Depth 40 -Compress))
'''
    try:
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
            input=json.dumps({'url': url}), capture_output=True, text=True, encoding='utf-8',
            timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            return 0, {}, None
        response = json.loads(result.stdout.lstrip('\ufeff'))
        status, response_headers = int(response['status']), response['headers']
        if not isinstance(response_headers, dict) or not 0 <= status <= 599:
            return 0, {}, None
        if 'payload_json' in response:
            # Keep source decimal precision; never round-trip feature numbers through PowerShell double.
            try:
                payload = json.loads(response['payload_json'], parse_float=Decimal)
            except (ValueError, TypeError):
                payload = None  # Preserve HTTP 200 for a malformed JSON body.
        else:
            payload = response['payload']
        return status, response_headers, payload
    except (OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired):
        return 0, {}, None


def items(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ('content', 'tracks', 'data'):
            if isinstance(payload.get(key), list):
                return payload[key]
    return None


def spotify_id(href):
    if not isinstance(href, str):
        return None
    parsed = urlparse(href)
    parts = parsed.path.strip('/').split('/')
    if parsed.scheme == 'https' and parsed.netloc == 'open.spotify.com' and len(parts) == 2 and parts[0] == 'track':
        return parts[1]
    return None


def compare_metadata(track, originals):
    title, artists = track.get('trackTitle'), track.get('artists')
    complete = (isinstance(title, str) and bool(canonical(title)) and isinstance(artists, list) and bool(artists)
        and all(isinstance(a, dict) and isinstance(a.get('name'), str) and canonical(a['name']) for a in artists))
    result = []
    for src in originals:
        tm = canonical(src['title']) == canonical(title) if complete else None
        am = canonical(src['artist']) in {canonical(a['name']) for a in artists} if complete else None
        result.append(dict(external_id=src['external_id'], title_match=tm, artist_match=am))
    return dict(complete=bool(complete), all_source_metadata_match=bool(complete and result and
        all(r['title_match'] and r['artist_match'] for r in result)), sources=result)


def feature_object(payload):
    return payload['content'] if isinstance(payload, dict) and isinstance(payload.get('content'), dict) else payload


def score_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    raw = Decimal(str(value))
    return raw if raw.is_finite() and 0 <= raw <= 1 else None


def memory_records(track, candidate, payload, observed_at):
    """SQL-compatible staging contract ONLY in memory; no persistence/verification authority."""
    payload = feature_object(payload)
    internal = str(uuid.UUID(track['id']))
    if (not isinstance(payload, dict) or payload.get('id') != internal or
            spotify_id(payload.get('href')) != candidate['spotify_id']):
        raise ValueError('Unconfirmed feature identity')
    values = {metric: score_number(payload.get(metric)) for metric in ('valence', 'energy')}
    if all(raw is None for raw in values.values()):
        raise ValueError('No valid coordinate')
    version = 'reccobeats-api-observation-' + observed_at
    source = dict(song_id=None, provider='reccobeats', external_id=internal, source_version=version,
        fetched_at=observed_at, source_url=BASE + '/track/' + internal + '/audio-features',
        rights_reference='storage_permission_unconfirmed; diagnostic-memory-only',
        raw_payload={'diagnostic_only': True}, candidate_spotify_id=candidate['spotify_id'],
        match_status='pending', match_evidence=None, verified_at=None, is_recommendation_source=False)
    source_key = {k: source[k] for k in ('provider', 'external_id', 'source_version')}
    scores = []
    for metric, raw in values.items():
        if raw is None:
            continue  # No zero filling or fallback between Energy and MuSe Arousal.
        with localcontext() as context:
            context.prec = 50
            normalized = 2 * raw - 1
        scores.append(dict(source_key=source_key, insert_values=dict(metric=metric,
            raw_value=str(raw), normalization_version='reccobeats-v1'),
            preview=dict(raw_min='0', raw_max='1', normalized_value=str(normalized))))
    return source, scores


def feature_summary(payload):
    # Keep key names and validity booleans; values never leave this function.
    payload = feature_object(payload)
    if not isinstance(payload, dict):
        return dict(response_valid=False, field_names=[], valence_valid=False, energy_valid=False)
    valid = lambda value: score_number(value) is not None
    return dict(response_valid=True, field_names=sorted(payload),
        valence_present='valence' in payload, energy_present='energy' in payload,
        valence_valid=valid(payload.get('valence')), energy_valid=valid(payload.get('energy')))


def probe(sample, originals, execute=False, send=transport, sleep=time.sleep, clock=time.monotonic,
          lookup_only=False, feature_limit=None):
    candidates = sample['candidates']
    if not 1 <= len(candidates) <= 10:
        raise ValueError('Probe must contain 1..10 unique MuSe candidates')
    allowed = {c['spotify_id'] for c in candidates}
    if len(allowed) != len(candidates):
        raise ValueError('Duplicate probe ID')
    if feature_limit is None:
        feature_limit = len(candidates)
    if not 0 <= feature_limit <= 10:
        raise ValueError('Feature limit must be 0..10')
    rows = [dict(spotify_id=c['spotify_id'], muse_external_ids=c['muse_external_ids'],
        id_match=False, lookup_outcome='not_attempted', feature_outcome='not_attempted') for c in candidates]
    requests, stopped, last = [], None, None
    lookup_observed = False
    returned_count = None
    features_attempted = 0
    observed_at = datetime.now(timezone.utc).isoformat()
    began = clock()
    def get(path):
        nonlocal last
        if last is not None:
            sleep(max(0, 2 - (clock() - last)))
        status, headers, payload = send('GET', BASE + path, {'Accept': 'application/json'}, None)
        last = clock()
        requests.append(dict(endpoint='track_lookup' if path.startswith('/track?') else 'track_features',
            http_status=status, retry_after_present=any(k.lower() == 'retry-after' for k in headers)))
        return status, payload
    if execute:
        status, payload = get('/track?' + urlencode({'ids': ','.join(c['spotify_id'] for c in candidates)}))
        found = items(payload) if status == 200 else None
        lookup_observed = found is not None
        returned_count = len(found) if found is not None else None
        envelope_keys = sorted(payload) if isinstance(payload, dict) else []
        track_keys = sorted({key for t in found or [] if isinstance(t, dict) for key in t})
        if found is None:
            stopped = 'lookup_http_' + str(status) if status != 200 else 'unknown_lookup_schema'
        grouped = {sid: [] for sid in allowed}
        for track in found or []:
            if isinstance(track, dict) and spotify_id(track.get('href')) in allowed:
                grouped[spotify_id(track['href'])].append(track)
        for row in rows:
            matches = grouped[row['spotify_id']]
            if found is None:
                row['lookup_outcome'] = stopped
                continue
            if len(matches) != 1:
                row['lookup_outcome'] = 'not_returned' if not matches else 'ambiguous_response'
                continue
            track = matches[0]
            row['id_match'] = True
            row['lookup_outcome'] = 'matched_spotify_href'
            row['metadata_check'] = compare_metadata(track, originals[row['spotify_id']])
            if lookup_only:
                row['feature_outcome'] = 'skipped_lookup_only'
                continue
            if features_attempted >= feature_limit:
                row['feature_outcome'] = 'skipped_feature_limit'
                continue
            try:
                internal = str(uuid.UUID(track.get('id', '')))
            except (ValueError, TypeError, AttributeError):
                row['feature_outcome'] = 'invalid_internal_uuid'
                continue
            if stopped:
                row['feature_outcome'] = 'run_halted'
                continue
            fstatus, features = get('/track/' + internal + '/audio-features')
            features_attempted += 1
            row['feature_http_status'] = fstatus
            if fstatus == 200:
                row['features'] = feature_summary(features)
                obj = feature_object(features)
                identity = (isinstance(obj, dict) and obj.get('id') == internal and
                    spotify_id(obj.get('href')) == row['spotify_id'])
                row['feature_identity_confirmed'] = identity
                row['feature_outcome'] = ('feature_identity_unconfirmed' if not identity else
                    'both_available' if row['features']['valence_valid'] and row['features']['energy_valid'] else
                    'missing_or_invalid_va_fields')
                if identity and (row['features']['valence_valid'] or row['features']['energy_valid']):
                    source, score_rows = memory_records(track, row, features, observed_at)
                    row['sql_contract'] = dict(valid=True, score_rows=len(score_rows),
                        metrics=[s['insert_values']['metric'] for s in score_rows],
                        source_pending=source['match_status'] == 'pending' and source['song_id'] is None,
                        decimal_strings=True, database_inserted=False)
                    del source, score_rows  # Real coordinates are not serialized to diagnostic reports.
            else:
                row['feature_outcome'] = 'features_http_' + str(fstatus)
                if fstatus in (0, 400, 401, 403, 429) or fstatus >= 500:
                    stopped = row['feature_outcome']  # No retry or subsequent request after 429.
    else:
        envelope_keys, track_keys = [], []
    assert len(requests) <= 1 + len(candidates)
    matched = sum(r['id_match'] for r in rows)
    strict = sum(r.get('metadata_check', {}).get('all_source_metadata_match', False) for r in rows)
    both = sum(r['feature_outcome'] == 'both_available' for r in rows)
    a_candidates = sum(r.get('metadata_check', {}).get('all_source_metadata_match', False) and
        r['feature_outcome'] == 'both_available' for r in rows)
    c_candidates = sum(r.get('metadata_check', {}).get('all_source_metadata_match', False) and
        r.get('feature_identity_confirmed', False) and r.get('features', {}).get('valence_valid', False) for r in rows)
    stats = dict(run_status='prepared' if not execute else 'halted' if stopped else 'completed', stop_reason=stopped,
        selected_ids=len(candidates), metadata_http_status=requests[0]['http_status'] if requests else None,
        catalog_lookup_observed=lookup_observed,
        returned_track_count=returned_count, lookup_only=lookup_only,
        feature_limit=feature_limit,
        requested_unique_songs=len(candidates) if execute else 0, id_matches=matched,
        id_match_rate=matched / len(candidates) if lookup_observed else None,
        all_source_metadata_matches=strict, strict_match_rate=strict / len(candidates) if lookup_observed else None,
        features_attempted=sum(r['endpoint'] == 'track_features' for r in requests),
        both_va_features_available=both, eligible_a_candidates=a_candidates, eligible_c_candidates=c_candidates,
        actual_verified_or_db_loaded=0, lookup_outcomes=dict(Counter(r['lookup_outcome'] for r in rows)),
        sql_contract_sources=sum(r.get('sql_contract', {}).get('valid', False) for r in rows),
        sql_contract_scores=sum(r.get('sql_contract', {}).get('score_rows', 0) for r in rows),
        feature_outcomes=dict(Counter(r['feature_outcome'] for r in rows)),
        envelope_fields_observed=envelope_keys, track_fields_observed=track_keys,
        feature_fields_observed=sorted({key for r in rows for key in r.get('features', {}).get('field_names', [])}),
        requests=requests, request_count=len(requests), elapsed_seconds=clock() - began,
        request_interval_seconds=2, retries=0, spotify_auth_used=False,
        emotion_values_persisted=False, remote_metadata_persisted=False, database_changed=False,
        rights_status='Bulk collection, permanent storage, redistribution and third-party permissions remain unconfirmed',
        interpretation='Href match identifies provider mapping only; strict metadata is conservative text comparison, '
            'not recording verification. Ten IDs cannot establish full MuSe coverage. No source promoted to verified.')
    return rows, stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--lookup-only', action='store_true', help='Only one metadata request; no emotion feature calls')
    parser.add_argument('--transport', choices=['urllib', 'powershell'], default='urllib')
    parser.add_argument('--feature-limit', type=int, choices=range(0, 11), default=10)
    parser.add_argument('--execution-environment', choices=['unspecified', 'codex', 'pc-powershell'],
        default='unspecified', help='Caller-declared environment label, not automatically detected')
    parser.add_argument('--output-dir', type=Path, default=LOCAL / 'reccobeats-probe/trial-10-v1')
    args = parser.parse_args()
    output = args.output_dir.resolve()
    if not output.is_relative_to(LOCAL.resolve()) or output == LOCAL.resolve() or output.exists():
        parser.error('Use a new music/.local subdirectory')
    sample, originals = prepare_sample()
    sample = dict(sample, selected_ids=10, candidates=sample['candidates'][:10],
        subset='First 10 IDs of existing deterministic Spotify 100-ID sample; no popularity filtering')
    output.mkdir(parents=True, exist_ok=False)
    with (output / 'sample.json').open('x', encoding='utf-8') as f:
        json.dump(sample, f, ensure_ascii=False, indent=2)
    rows, stats = probe(sample, originals, args.execute, lookup_only=args.lookup_only,
        feature_limit=args.feature_limit, send=powershell_transport if args.transport == 'powershell' else transport)
    with (output / 'results.jsonl').open('x', encoding='utf-8') as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
    stats.update(execution_environment=args.execution_environment, environment_label_source='caller_declared',
        http_transport=args.transport,
        generated_at_utc=datetime.now(timezone.utc).isoformat(),
        sample_sha256=digest(output / 'sample.json'), results_sha256=digest(output / 'results.jsonl'))
    with (output / 'stats.json').open('x', encoding='utf-8') as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    print(json.dumps({k: stats[k] for k in ('execution_environment', 'run_status', 'selected_ids',
        'metadata_http_status', 'returned_track_count', 'id_matches', 'id_match_rate', 'request_count')}))


if __name__ == '__main__':
    main()
