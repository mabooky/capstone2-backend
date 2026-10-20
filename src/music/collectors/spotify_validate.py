"""Prepare 100 MuSe ID checks; explicit --execute and credentials enable live requests.

Spotify responses and credentials stay in memory. Only local MuSe references,
comparison booleans, status codes and aggregate diagnostics are persisted.
"""
import argparse
import base64
import hashlib
import json
import math
import os
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

from clean_muse import LOCAL, SOURCE_DIR, digest

STAGING = LOCAL / 'muse-cleaned/full-90408-v1'
DEFAULT_OUTPUT = LOCAL / 'spotify-validation/sample-100-v1'
SEED = 'muse-spotify-unique-100-v1'
POLICY = 'nfkc-casefold-whitespace-exact-v1'
TOKEN_URL = 'https://accounts.spotify.com/api/token'
TRACK_URL = 'https://api.spotify.com/v1/tracks/'


def canonical(text):
    return ' '.join(unicodedata.normalize('NFKC', text).casefold().split())


def select_ids(ids, seed=SEED, count=100):
    unique = set(ids)
    if not 1 <= count <= len(unique):
        raise ValueError('Invalid sample size')
    return sorted(unique, key=lambda value: (
        hashlib.sha256((seed + '\0' + value).encode()).digest(), value))[:count]


def prepare_sample(staging=STAGING):
    stats = json.loads((staging / 'stats.json').read_text(encoding='utf-8'))
    validation = json.loads((staging / 'validation.json').read_text(encoding='utf-8'))
    if validation['result'] != 'PASS' or digest(staging / 'stats.json') != validation['artifacts_sha256']['stats.json']:
        raise ValueError('Unverified staging metadata')
    source_file = staging / 'song_sources.jsonl'
    source_hash = digest(source_file)
    if source_hash != validation['artifacts_sha256']['song_sources.jsonl']:
        raise ValueError('Staging source checksum mismatch')
    if digest(SOURCE_DIR / 'muse_dataset.csv') != stats['source_sha256']:
        raise ValueError('Original source checksum mismatch')
    grouped = defaultdict(list)
    n = 0
    with source_file.open(encoding='utf-8') as f:
        for line in f:
            src = json.loads(line)
            if src['match_status'] != 'pending' or src['song_id'] is not None or src['is_recommendation_source']:
                raise ValueError('Expected unverified MuSe staging')
            spotify = src['candidate_spotify_id']
            if spotify:
                if not re.fullmatch(r'[0-9A-Za-z]{22}', spotify):
                    raise ValueError('Unexpected candidate format')
                raw = src['raw_payload']
                grouped[spotify].append(dict(external_id=src['external_id'], title=raw['track'], artist=raw['artist']))
            n += 1
    if n != 90408 or len(grouped) != 60741:
        raise ValueError('Unexpected full population size')
    selected = select_ids(grouped)
    sample = dict(selection='lowest SHA256(UTF8(seed + NUL + unique Spotify ID)); ID tie-break',
        seed=SEED, population_rows=n, unique_id_population=len(grouped), selected_ids=100,
        source_sha256=stats['source_sha256'], staging_sources_sha256=source_hash,
        unit='unique Spotify ID; all associated MuSe source rows retained',
        candidates=[dict(spotify_id=sid, muse_external_ids=[r['external_id'] for r in grouped[sid]]) for sid in selected])
    return sample, {sid: grouped[sid] for sid in selected}


def environment(env):
    return dict(python=sys.version.split()[0], credentials_present={key: bool(env.get(key, '').strip())
        for key in ('SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_ACCESS_TOKEN')},
        market_configured=bool(env.get('SPOTIFY_MARKET', '').strip()), dotenv_loaded=False)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward Authorization through a redirect.


def transport(method, url, headers, data):
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                return 200, {}, None
            try:
                payload = json.loads(raw)
            except (ValueError, UnicodeError):
                payload = None
            return response.status, dict(response.headers.items()), payload
    except urllib.error.HTTPError as error:
        # Error bodies may contain sensitive/request data. Never read or log them.
        try:
            return error.code, dict(error.headers.items()), None
        finally:
            error.close()
    except (urllib.error.URLError, OSError, TimeoutError):
        return 0, {}, None


class LookupFailure(Exception):
    def __init__(self, reason, status=None, stop=False):
        super().__init__(reason)  # Static codes only; never include response/exception text.
        self.reason, self.status, self.stop = reason, status, stop


class SpotifyClient:
    def __init__(self, env, market, send=transport, sleep=time.sleep, clock=time.monotonic,
                 wall=time.time, jitter=lambda: random.uniform(0, .5), interval=1.0,
                 max_retries=3, wait_budget=120.0):
        if not re.fullmatch(r'[A-Z]{2}', market or ''):
            raise ValueError('A two-letter Spotify market is required')
        self.env, self.market, self.send = env, market, send
        self.sleep, self.clock, self.wall, self.jitter = sleep, clock, wall, jitter
        self.interval, self.max_retries, self.wait_budget = interval, max_retries, wait_budget
        self.next_request, self.waited, self.requests, self.retries = 0.0, 0.0, 0, 0
        self.token, self.expires = None, 0.0
        self.has_pair = bool(env.get('SPOTIFY_CLIENT_ID') and env.get('SPOTIFY_CLIENT_SECRET'))

    def wait(self, seconds, reason):
        seconds = max(0.0, seconds)
        if seconds > self.wait_budget - self.waited:
            raise LookupFailure(reason, stop=True)
        self.sleep(seconds)
        self.waited += seconds

    def request(self, method, url, headers, data=None):
        for attempt in range(self.max_retries + 1):
            self.wait(self.next_request - self.clock(), 'wait_budget_exhausted')
            self.requests += 1
            status, response_headers, payload = self.send(method, url, headers, data)
            self.next_request = self.clock() + self.interval
            if status not in (0, 429) and not 500 <= status <= 599:
                return status, payload
            reason = 'network_error' if status == 0 else 'rate_limited' if status == 429 else 'server_error'
            delay = min(2 ** attempt, 30) + self.jitter()
            if status == 429:
                header = next((v for k, v in response_headers.items() if k.lower() == 'retry-after'), None)
                if header is not None:
                    try:
                        retry_after = float(header)
                    except (ValueError, TypeError):
                        try:
                            retry_after = parsedate_to_datetime(header).timestamp() - self.wall()
                        except (ValueError, TypeError, OverflowError):
                            retry_after = delay
                    if math.isfinite(retry_after):
                        delay = max(delay, retry_after)
                # Even at retry exhaustion, halt the whole run; do not call the next ID early.
                self.next_request = max(self.next_request, self.clock() + delay)
            if attempt == self.max_retries:
                raise LookupFailure(reason + '_retry_exhausted', status, stop=status == 429)
            self.retries += 1
            self.wait(max(delay, self.next_request - self.clock()), reason + '_wait_budget_exhausted')
        raise AssertionError('Unreachable')

    def access_token(self, force=False):
        if self.token and not force and self.clock() < self.expires:
            return self.token
        if not self.has_pair:
            token = self.env.get('SPOTIFY_ACCESS_TOKEN', '').strip()
            if not token or force:
                raise LookupFailure('missing_or_expired_access_token', 401 if force else None, stop=True)
            self.token, self.expires = token, float('inf')
            return token
        basic = base64.b64encode((self.env['SPOTIFY_CLIENT_ID'] + ':' + self.env['SPOTIFY_CLIENT_SECRET']).encode()).decode()
        try:
            status, payload = self.request('POST', TOKEN_URL,
                {'Authorization': 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded'},
                b'grant_type=client_credentials')
        except LookupFailure as error:
            raise LookupFailure('token_' + error.reason, error.status, stop=True) from None
        if status != 200:
            raise LookupFailure('token_authentication_failed' if status in (400, 401, 403) else 'token_http_error', status, stop=True)
        if (not isinstance(payload, dict) or not isinstance(payload.get('access_token'), str) or
                not payload['access_token'] or str(payload.get('token_type', '')).casefold() != 'bearer' or
                not isinstance(payload.get('expires_in'), (int, float)) or
                not math.isfinite(payload['expires_in']) or payload['expires_in'] <= 0):
            raise LookupFailure('invalid_token_response', status, stop=True)
        self.token = payload['access_token']
        self.expires = self.clock() + max(0, payload['expires_in'] - 30)
        return self.token

    def track(self, spotify_id):
        if not re.fullmatch(r'[0-9A-Za-z]{22}', spotify_id):
            raise ValueError('Invalid Spotify ID')
        token = self.access_token()
        url = TRACK_URL + spotify_id + '?' + urllib.parse.urlencode({'market': self.market})
        status, payload = self.request('GET', url, {'Authorization': 'Bearer ' + token})
        if status == 401:
            token = self.access_token(force=True)  # One refresh/retry per track.
            status, payload = self.request('GET', url, {'Authorization': 'Bearer ' + token})
        if status != 200:
            reasons = {401: 'unauthorized', 403: 'forbidden_app_or_access', 404: 'not_found_in_market_or_access_context'}
            raise LookupFailure(reasons.get(status, 'track_http_error'), status, stop=status in (401, 403))
        return payload


def unconfirmed(candidate, reason, http_status=None):
    return dict(spotify_id=candidate['spotify_id'], outcome='unconfirmed', reason=reason,
        http_status=http_status, id_exists=None,
        sources=[dict(external_id=ref, outcome='unconfirmed', title_match=None, artist_match=None)
                 for ref in candidate['muse_external_ids']])


def compare_track(candidate, originals, payload):
    result = unconfirmed(candidate, 'invalid_track_response', 200)
    if not originals or sorted(r['external_id'] for r in originals) != sorted(candidate['muse_external_ids']):
        result['reason'] = 'source_reference_mismatch'
        return result
    if not isinstance(payload, dict) or payload.get('type') != 'track':
        return result
    if payload.get('id') != candidate['spotify_id']:
        result['reason'] = 'relinked_or_different_id'
        return result
    result['id_exists'] = True
    if payload.get('is_playable') is False or payload.get('restrictions') or payload.get('is_local'):
        result['reason'] = 'restricted_or_unplayable'
        return result
    title, artists = payload.get('name'), payload.get('artists')
    if not isinstance(title, str) or not canonical(title) or not isinstance(artists, list) or not artists:
        return result
    if any(not isinstance(a, dict) or not isinstance(a.get('name'), str) or not canonical(a['name']) for a in artists):
        return result
    artist_names = {canonical(a['name']) for a in artists}
    result['sources'] = []
    for original in originals:
        title_match = canonical(original['title']) == canonical(title)
        artist_match = canonical(original['artist']) in artist_names
        outcome = 'success' if title_match and artist_match else 'mismatch'
        result['sources'].append(dict(external_id=original['external_id'], outcome=outcome,
            title_match=title_match, artist_match=artist_match))
    success = all(row['outcome'] == 'success' for row in result['sources'])
    result['outcome'] = 'success' if success else 'mismatch'
    result['reason'] = 'metadata_exact_match' if success else ('ambiguous_source_group' if len(originals) > 1 else 'title_or_artist_mismatch')
    return result


def evaluate(sample, originals, env, execute=False, market=None, client=None):
    started = time.monotonic()
    pair = bool(env.get('SPOTIFY_CLIENT_ID', '').strip() and env.get('SPOTIFY_CLIENT_SECRET', '').strip())
    credentialed = pair or bool(env.get('SPOTIFY_ACCESS_TOKEN', '').strip())
    market = market or env.get('SPOTIFY_MARKET', '').strip()
    gate = ('missing_credentials' if not credentialed else 'execution_not_requested' if not execute else
            'market_not_configured' if not re.fullmatch(r'[A-Z]{2}', market) else None)
    if not gate and client is None:
        client = SpotifyClient(env, market)
    results, stop_reason, attempted = [], None, 0
    for candidate in sample['candidates']:
        if gate or stop_reason:
            result = unconfirmed(candidate, gate or 'run_halted_' + stop_reason)
        else:
            attempted += 1
            try:
                result = compare_track(candidate, originals[candidate['spotify_id']], client.track(candidate['spotify_id']))
            except LookupFailure as error:
                result = unconfirmed(candidate, error.reason, error.status)
                if error.stop:
                    stop_reason = error.reason
        results.append(result)
    counts = Counter(row['outcome'] for row in results)
    source_counts = Counter(source['outcome'] for row in results for source in row['sources'])
    checked = counts['success'] + counts['mismatch']
    report = dict(run_status='deferred' if gate else 'halted' if stop_reason else 'completed',
        gate_reason=gate, stop_reason=stop_reason, matching_policy=POLICY,
        market=market if re.fullmatch(r'[A-Z]{2}', market) else None,
        selected_ids=len(results), attempted_ids=attempted, success=counts['success'], mismatch=counts['mismatch'],
        unconfirmed=counts['unconfirmed'], metadata_compared_ids=checked,
        selected_source_rows=sum(source_counts.values()), source_outcome_counts=dict(source_counts),
        success_rate_among_compared=counts['success'] / checked if checked else None,
        success_rate_among_attempted=counts['success'] / attempted if attempted else None,
        reason_counts=dict(Counter(row['reason'] for row in results)),
        requests=client.requests if client else 0, retries=client.retries if client else 0,
        waited_seconds=client.waited if client else 0, elapsed_seconds=time.monotonic() - started,
        environment=environment(env), spotify_payload_persisted=False, database_changed=False,
        interpretation='success means strict metadata comparison only; no source is promoted to verified. '
            '404 does not prove global nonexistence; market/token access and relinking need separate review.')
    return results, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--market', help='Explicit ISO two-letter market, e.g. KR')
    parser.add_argument('--execute', action='store_true', help='Enable API requests only when authentication and market are configured')
    args = parser.parse_args()
    output = args.output_dir.resolve()
    try:
        if not output.is_relative_to(LOCAL.resolve()) or output == LOCAL.resolve():
            raise ValueError('Output must be a new music/.local subdirectory')
        if output.exists():
            raise FileExistsError('Output already exists')
        sample, originals = prepare_sample()
        output.mkdir(parents=True, exist_ok=False)
        with (output / 'sample.json').open('x', encoding='utf-8') as f:
            json.dump(sample, f, ensure_ascii=False, indent=2)
        results, report = evaluate(sample, originals, dict(os.environ), args.execute, args.market)
        report.update(generated_at_utc=datetime.now(timezone.utc).isoformat(), sample_sha256=digest(output / 'sample.json'))
        with (output / 'results.jsonl').open('x', encoding='utf-8') as f:
            for result in results:
                f.write(json.dumps(result, ensure_ascii=False) + '\n')
        report['results_sha256'] = digest(output / 'results.jsonl')
        with (output / 'stats.json').open('x', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(json.dumps({k: report[k] for k in ('run_status', 'selected_ids', 'attempted_ids', 'success',
            'mismatch', 'unconfirmed', 'reason_counts', 'requests')}, ensure_ascii=False))
    except (ValueError, KeyError, OSError):
        print('Preparation failed: check staging hashes, settings, and a new .local output directory.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
