"""Default offline batch engine; explicit 100-ID research entry is separately bounded.

SQLite is a local diagnostic checkpoint, never the project/shared music database.
The base mode persists only IDs, booleans and diagnostics; full-population live stays locked.
The research entry alone may retain temporary local scores under its explicit scope.
"""
import argparse
import csv
import hashlib
import json
import math
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

from clean_muse import LOCAL, SOURCE_DIR, digest
from matching_audit import POLICY, assess, candidate_id, duplicate_group
from reccobeats_probe import (BASE, compare_metadata, feature_summary, items,
                             memory_records, powershell_transport, spotify_id)

VERSION = 'reccobeats-batch-offline-v1'
CONFIG = dict(batch_size=10, interval_seconds=2, max_attempts=3, retry_budget_fraction=0.05)
LIVE_COLLECTION_ENABLED = False  # Requires a separately authorized implementation change.


def live_transport(*args, **kwargs):
    # Deliberately no --execute flag or permission string that can unlock this.
    # Future authorized implementation can call the existing PowerShell bridge.
    if not LIVE_COLLECTION_ENABLED:
        raise PermissionError('Live ReccoBeats collection is disabled; provider rights and execution authorization required')
    return powershell_transport(*args, **kwargs)


def population():
    staging = LOCAL / 'muse-cleaned/full-90408-v1'
    stats_path = staging / 'stats.json'
    validation = json.loads((staging / 'validation.json').read_text(encoding='utf-8'))
    stats = json.loads(stats_path.read_text(encoding='utf-8'))
    source = SOURCE_DIR / 'muse_dataset.csv'
    if (validation['result'] != 'PASS' or digest(stats_path) != validation['artifacts_sha256']['stats.json']
            or digest(source) != stats['source_sha256']):
        raise ValueError('Unverified input population')
    groups, raw_groups = {}, {}
    count = 0
    with source.open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream):
            count += 1
            sid = candidate_id(row['spotify_id'])
            if sid:
                groups.setdefault(sid, []).append(dict(external_id=row['id'], title=row['track'], artist=row['artist']))
                raw_groups.setdefault(sid, []).append(row)
    if count != 90408 or len(groups) != 60741:
        raise ValueError('Unexpected population')
    conflicts = {}
    for sid, rows in raw_groups.items():
        if len(rows) > 1:
            group = duplicate_group(sid, rows)
            conflicts[sid] = {key:group[key] for key in ('metadata_class','score_conflict','va_conflict','mbid_conflict')}
    manifest = dict(version=VERSION, policy=POLICY, source_sha256=stats['source_sha256'],
                    config=CONFIG, mode='synthetic-offline', unique_ids=len(groups),
                    duplicate_groups=len(conflicts), source_rows_with_id=sum(map(len, groups.values())))
    return groups, conflicts, manifest


@contextmanager
def exclusive_lock(path):
    """OS lock releases on process death; stale file is not a stale lock."""
    with path.open('a+b') as stream:
        stream.seek(0, os.SEEK_END)
        if stream.tell() == 0:
            stream.write(b'0')
            stream.flush()
        stream.seek(0)
        if os.name == 'nt':
            import msvcrt
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise RuntimeError('Checkpoint already in use') from error
        else:
            import fcntl
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise RuntimeError('Checkpoint already in use') from error
        try:
            yield
        finally:
            if os.name == 'nt':
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


class Checkpoint:
    def __init__(self, directory, groups, conflicts, manifest):
        self.directory = Path(directory).resolve()
        if not self.directory.is_relative_to(LOCAL.resolve()):
            raise ValueError('Checkpoint must be under music/.local')
        self.groups, self.conflicts = groups, conflicts
        self.manifest = dict(manifest, population_fingerprint=hashlib.sha256(
            json.dumps(groups,sort_keys=True).encode()).hexdigest(), engine_config=CONFIG)

    def __enter__(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = exclusive_lock(self.directory / 'collector.lock')
        self.lock.__enter__()
        self.db = None
        try:
            self.db = sqlite3.connect(self.directory / 'checkpoint.sqlite')
            self.db.row_factory = sqlite3.Row
            self.db.execute('PRAGMA journal_mode=WAL')
            self.db.execute('PRAGMA synchronous=FULL')
            self.db.executescript('''
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS candidates (
                    sid TEXT PRIMARY KEY, refs TEXT NOT NULL, conflict TEXT,
                    uuid TEXT, metadata_outcome TEXT, comparisons TEXT,
                    feature_outcome TEXT, collision INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS jobs (
                    key TEXT PRIMARY KEY, stage TEXT NOT NULL, ids TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
                    next_at REAL NOT NULL DEFAULT 0, last_status INTEGER, reason TEXT);
                CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(stage,state,next_at,key);
                CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state);
                CREATE INDEX IF NOT EXISTS candidates_uuid ON candidates(uuid);
                CREATE TABLE IF NOT EXISTS attempts (
                    job_key TEXT NOT NULL, attempt INTEGER NOT NULL, started REAL NOT NULL,
                    status INTEGER, reason TEXT NOT NULL, PRIMARY KEY(job_key,attempt));
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY, job_key TEXT NOT NULL, kind TEXT NOT NULL,
                    detail TEXT NOT NULL);
            ''')
            encoded = json.dumps(self.manifest, sort_keys=True)
            old = self.get('manifest')
            if old is not None and old != encoded:
                raise ValueError('Checkpoint manifest/config/population mismatch')
            if old is None:
                with self.db:
                    self.put('manifest', encoded)
                    self.db.executemany('INSERT INTO candidates(sid,refs,conflict) VALUES(?,?,?)',
                        [(sid, json.dumps(sorted(r['external_id'] for r in rows)), json.dumps(self.conflicts.get(sid)))
                         for sid, rows in sorted(self.groups.items())])
                    ids = sorted(self.groups)
                    self.db.executemany('INSERT INTO jobs(key,stage,ids) VALUES(?,?,?)',
                        [(f'metadata:{i//10:06d}', 'metadata', json.dumps(ids[i:i+10])) for i in range(0,len(ids),10)])
            # An in-flight request may already have reached the provider. Never auto-replay it.
            with self.db:
                self.db.execute("UPDATE attempts SET reason='interrupted_inflight' WHERE job_key IN (SELECT key FROM jobs WHERE state='inflight') AND reason='reserved'")
                self.db.execute("UPDATE jobs SET state='uncertain',reason='interrupted_inflight' WHERE state='inflight'")
            return self
        except BaseException:
            if self.db is not None:
                self.db.close()
            self.lock.__exit__(None, None, None)
            raise

    def __exit__(self, *args):
        self.db.close()
        self.lock.__exit__(*args)

    def get(self, key, default=None):
        row = self.db.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return row[0] if row else default

    def put(self, key, value):
        self.db.execute('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key,str(value)))

    def retry_job(self, key, *, acknowledge_possible_duplicate=False):
        """Explicit operator action; attempts/quota/backoff are never reset."""
        row = self.db.execute('SELECT * FROM jobs WHERE key=?', (key,)).fetchone()
        if row is None or row['state'] not in ('blocked','failed','uncertain'):
            raise ValueError('Job is not eligible for manual retry')
        if row['state'] == 'uncertain' and not acknowledge_possible_duplicate:
            raise ValueError('Uncertain request needs explicit duplicate-risk acknowledgement')
        if row['attempts'] >= CONFIG['max_attempts']:
            raise ValueError('Attempt limit exhausted')
        with self.db:
            self.db.execute('INSERT INTO events(job_key,kind,detail) VALUES(?,?,?)',
                            (key,'manual_retry',json.dumps({'previous_state':row['state'],
                             'acknowledge_possible_duplicate':acknowledge_possible_duplicate})))
            self.db.execute("UPDATE jobs SET state='pending',reason='manual_retry' WHERE key=?", (key,))


def retry_after(headers, now):
    value = next((v for k,v in headers.items() if k.lower() == 'retry-after'), None)
    try:
        seconds = float(value)
        if math.isfinite(seconds) and seconds >= 0:
            return seconds
    except (TypeError, ValueError):
        pass
    try:
        return max(0, parsedate_to_datetime(str(value)).timestamp() - now)
    except (TypeError, ValueError, OverflowError):
        return 60.0


class Engine:
    def __init__(self, checkpoint, send=live_transport, clock=time.time, sleep=time.sleep, interval_seconds=None, stop_requested=None):
        self.cp, self.send, self.clock, self.sleep = checkpoint, send, clock, sleep
        self.db = checkpoint.db
        self.stop_requested = stop_requested
        self.interval_seconds = CONFIG['interval_seconds'] if interval_seconds is None else interval_seconds
        if not math.isfinite(self.interval_seconds) or self.interval_seconds < CONFIG['interval_seconds']:
            raise ValueError('Cannot reduce the minimum request interval')

    def metadata(self, ids, payload):
        tracks = items(payload)
        if tracks is None or any(not isinstance(t, dict) for t in tracks):
            raise ValueError('invalid_metadata_json')
        by_id = {}
        for track in tracks:
            sid = spotify_id(track.get('href'))
            if sid in ids:
                by_id.setdefault(sid, []).append(track)
        for sid in ids:
            matches = by_id.get(sid, [])
            if len(matches) != 1:
                outcome = 'not_returned' if not matches else 'ambiguous_response'
                self.db.execute('UPDATE candidates SET metadata_outcome=? WHERE sid=?', (outcome,sid))
                continue
            track = matches[0]
            try:
                internal = str(uuid.UUID(track['id']))
            except (ValueError, KeyError, TypeError, AttributeError):
                self.db.execute("UPDATE candidates SET metadata_outcome='invalid_uuid' WHERE sid=?", (sid,))
                continue
            comparison = compare_metadata(track, self.cp.groups[sid])
            # Reuse stage-2 source-scoped policy, with no invented independent evidence.
            checks = [dict(**check, decision=assess(sid, check['external_id'], {'id_match':True})['decision'])
                      for check in comparison['sources']]
            held = ('held_duplicate' if sid in self.cp.conflicts else
                    'held_metadata' if not comparison['all_source_metadata_match'] else None)
            others = self.db.execute('SELECT sid FROM candidates WHERE uuid=? AND sid<>?', (internal,sid)).fetchall()
            self.db.execute('UPDATE candidates SET uuid=?,metadata_outcome=?,comparisons=?,feature_outcome=? WHERE sid=?',
                            (internal,'matched_href',json.dumps(checks),held,sid))
            if others:
                self.db.execute("UPDATE candidates SET collision=1,metadata_outcome='uuid_collision',feature_outcome='held_uuid_collision' WHERE uuid=?", (internal,))

    def features(self, sid, payload):
        candidate = self.db.execute('SELECT * FROM candidates WHERE sid=?', (sid,)).fetchone()
        track = {'id':candidate['uuid']}
        try:
            source, scores = memory_records(track, {'spotify_id':sid}, payload, 'synthetic-or-memory-only')
        except (ValueError, TypeError, KeyError, AttributeError):
            raise ValueError('invalid_or_wrong_feature_identity') from None
        summary = feature_summary(payload)
        outcome = 'both_available' if summary['valence_valid'] and summary['energy_valid'] else 'partial_features'
        # Only outcome boolean/category persists, never source/scores/payload values.
        del source, scores
        self.db.execute('UPDATE candidates SET feature_outcome=? WHERE sid=?', (outcome,sid))

    def next_feature_job(self):
        return self.db.execute("SELECT * FROM jobs WHERE stage='features' AND state='pending' ORDER BY next_at,key LIMIT 1").fetchone()

    def request_url(self, job, ids):
        if job['stage'] == 'metadata':
            return BASE + '/track?' + urlencode({'ids':','.join(ids)})
        internal = self.db.execute('SELECT uuid FROM candidates WHERE sid=?', (ids[0],)).fetchone()[0]
        return BASE + '/track/' + internal + '/audio-features'

    def process_features(self, job, ids, payload):
        self.features(ids[0], payload)

    def job_finished(self, job, state):
        pass

    def run(self, max_requests=None):
        if self.send is live_transport:
            raise PermissionError('Live execution is disabled')
        calls = 0
        upper = math.ceil(len(self.cp.groups)/10) + len(self.cp.groups)
        budget = upper + math.ceil(upper * CONFIG['retry_budget_fraction'])
        while True:
            if self.stop_requested is not None and self.stop_requested():
                return 'interrupted_by_user'
            if self.db.execute("SELECT 1 FROM jobs WHERE state IN ('blocked','uncertain') LIMIT 1").fetchone():
                return 'operator_review_required'
            if max_requests is not None and calls >= max_requests:
                return 'interrupted_at_boundary'
            planned = self.cp.get('features_planned') is not None
            job = None if planned else self.db.execute("SELECT * FROM jobs WHERE stage='metadata' AND state='pending' ORDER BY next_at,key LIMIT 1").fetchone()
            if job is None:
                if not planned and self.db.execute("SELECT 1 FROM jobs WHERE stage='metadata' AND state!='done' LIMIT 1").fetchone():
                    return 'metadata_failures_require_review'
                if self.cp.get('features_planned') is None:
                    with self.db:
                        self.db.execute("INSERT OR IGNORE INTO jobs(key,stage,ids) SELECT 'features:'||sid,'features',json_array(sid) FROM candidates WHERE uuid IS NOT NULL AND collision=0 AND metadata_outcome='matched_href' AND feature_outcome IS NULL")
                        self.cp.put('features_planned', 'true')
                job = self.next_feature_job()
                if job is None:
                    return 'completed_with_failures' if self.db.execute("SELECT 1 FROM jobs WHERE state!='done' LIMIT 1").fetchone() else 'completed'
            if self.db.execute('SELECT count(*) FROM attempts').fetchone()[0] >= budget:
                return 'request_budget_exhausted'
            due = max(job['next_at'], float(self.cp.get('not_before', '0')))
            delay = due - self.clock()
            if delay > 0:
                # Small wait chunks; Retry-After is never shortened or forgotten across resume.
                self.sleep(min(delay, 1 if self.stop_requested is not None else 30))
                continue
            ids = json.loads(job['ids'])
            url = self.request_url(job, ids)
            attempt = job['attempts'] + 1
            started = self.clock()
            with self.db:
                self.db.execute("UPDATE jobs SET state='inflight',attempts=? WHERE key=?", (attempt,job['key']))
                self.db.execute('INSERT INTO attempts VALUES(?,?,?,?,?)', (job['key'],attempt,started,None,'reserved'))
                self.cp.put('not_before', started + self.interval_seconds)
                self.cp.put('simulated_now', started)
            # Crash between reservation/send/commit remains uncertain. No automatic duplicate.
            try:
                status, headers, payload = self.send('GET', url, {'Accept':'application/json'}, None)
            except (OSError, TimeoutError):
                status, headers, payload = 0, {}, None
            calls += 1
            reason, state, next_at = 'ok', 'done', 0
            if status == 403:
                reason, state = 'http_403', 'blocked'
            elif status == 404 and job['stage'] == 'features' and not job['key'].startswith('features:batch:'):
                # A valid per-track feature resource may be absent; never retry a 404.
                reason, state = 'feature_not_found', 'done'
            elif status == 429 or status == 0 or 500 <= status <= 599:
                reason = 'http_429' if status == 429 else 'network_failure' if status == 0 else 'http_5xx'
                wait = max(2 ** attempt, retry_after(headers, self.clock()) if status == 429 else 0)
                next_at = self.clock() + wait
                state = 'pending' if attempt < CONFIG['max_attempts'] else 'failed'
            elif status != 200:
                reason, state = 'http_other', 'failed'
            with self.db:
                if reason == 'feature_not_found':
                    self.db.execute("UPDATE candidates SET feature_outcome='not_found' WHERE sid=?",(ids[0],))
                if status == 200:
                    self.db.execute('SAVEPOINT parse_response')
                    try:
                        if job['stage'] == 'metadata':
                            self.metadata(ids, payload)
                        else:
                            self.process_features(job, ids, payload)
                    except (ValueError, TypeError, KeyError, AttributeError):
                        self.db.execute('ROLLBACK TO parse_response')
                        reason, state = 'invalid_response_or_identity', 'failed'
                    finally:
                        self.db.execute('RELEASE parse_response')
                if status == 429:
                    self.cp.put('not_before', next_at)
                self.db.execute('UPDATE jobs SET state=?,next_at=?,last_status=?,reason=? WHERE key=?',
                                (state,next_at,status,reason,job['key']))
                self.db.execute('UPDATE attempts SET status=?,reason=? WHERE job_key=? AND attempt=?',
                                (status,reason,job['key'],attempt))
                self.job_finished(job, state)
                self.cp.put('simulated_now', self.clock())
            del payload

    def summary(self, outcome):
        count = lambda sql: self.db.execute(sql).fetchone()[0]
        return dict(mode='synthetic-offline', outcome=outcome, candidates=len(self.cp.groups),
            source_rows=sum(map(len,self.cp.groups.values())), duplicate_groups=len(self.cp.conflicts),
            metadata_jobs=count("SELECT count(*) FROM jobs WHERE stage='metadata'"),
            feature_jobs=count("SELECT count(*) FROM jobs WHERE stage='features'"),
            completed_jobs=count("SELECT count(*) FROM jobs WHERE state='done'"),
            simulated_requests=count('SELECT count(*) FROM attempts'),
            retry_attempts=count('SELECT count(*) FROM attempts WHERE attempt>1'),
            duplicate_job_keys=count('SELECT count(*) FROM jobs')-count('SELECT count(DISTINCT key) FROM jobs'),
            both_features=count("SELECT count(*) FROM candidates WHERE feature_outcome='both_available'"),
            held_duplicates=count("SELECT count(*) FROM candidates WHERE feature_outcome='held_duplicate'"),
            held_metadata=count("SELECT count(*) FROM candidates WHERE feature_outcome='held_metadata'"),
            held_source_checks=sum(len(json.loads(r[0])) for r in self.db.execute('SELECT comparisons FROM candidates WHERE comparisons IS NOT NULL')),
            actual_api_calls=0, actual_verified=0, persisted_emotion_values=0,
            states=dict(self.db.execute('SELECT state,count(*) FROM jobs GROUP BY state').fetchall()))


class SimulatedClock:
    def __init__(self, now=0):
        self.now = now

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class SyntheticProvider:
    """Explicit fixture; never evidence of real coverage or matching accuracy."""
    def __init__(self, groups):
        self.groups = groups
        self.by_uuid = {str(uuid.uuid5(uuid.NAMESPACE_URL, sid)):sid for sid in groups}

    def __call__(self, method, url, headers, data):
        parsed = urlparse(url)
        if parsed.path == '/v1/audio-features':
            internals = parse_qs(parsed.query)['ids'][0].split(',')
            return 200, {}, dict(content=[dict(id=internal,
                href='https://open.spotify.com/track/'+self.by_uuid[internal],
                valence=0.25, energy=0.75) for internal in reversed(internals)])
        if parsed.path.endswith('/audio-features'):
            internal = parsed.path.split('/')[-2]
            sid = self.by_uuid[internal]
            return 200, {}, dict(id=internal, href='https://open.spotify.com/track/'+sid, valence=0.25, energy=0.75)
        ids = parse_qs(parsed.query)['ids'][0].split(',')
        return 200, {}, dict(content=[dict(id=str(uuid.uuid5(uuid.NAMESPACE_URL,sid)),
            href='https://open.spotify.com/track/'+sid, trackTitle=self.groups[sid][0]['title'],
            artists=[dict(name=self.groups[sid][0]['artist'])]) for sid in ids])


def main():
    # Explicit bounded research mode; the unrestricted/full-population live lock stays closed.
    import sys
    if '--research-live' in sys.argv[1:]:
        from reccobeats_research import main as research_main
        return research_main()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', required=True)
    parser.add_argument('--checkpoint-dir', type=Path, default=LOCAL/'reccobeats-batch/full-dry-run-v1')
    parser.add_argument('--max-requests', type=int)
    args = parser.parse_args()
    if args.max_requests is not None and args.max_requests < 1:
        parser.error('max-requests must be positive')
    groups, conflicts, manifest = population()
    start = time.perf_counter()
    with Checkpoint(args.checkpoint_dir,groups,conflicts,manifest) as checkpoint:
        clock = SimulatedClock(float(checkpoint.get('simulated_now','0')))
        engine = Engine(checkpoint, SyntheticProvider(groups), clock, clock.sleep)
        result = engine.summary(engine.run(args.max_requests))
        result['wall_seconds'] = round(time.perf_counter()-start,3)
        result['simulated_elapsed_seconds'] = clock.now
        encoded = json.dumps(result, indent=2)+'\n'
        temp = checkpoint.directory/'summary.tmp'
        temp.write_text(encoded,encoding='utf-8')
        os.replace(temp,checkpoint.directory/'summary.json')
        print(json.dumps(result))


if __name__ == '__main__':
    main()
