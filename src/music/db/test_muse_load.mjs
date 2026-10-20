// Integration test only. PGlite in memory, no connection URL or external DB.
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { entries, loadBatches } from './load_muse_batches.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../.local/sql-validation/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const music = fileURLToPath(new URL('../', import.meta.url));
const startedAt = performance.now();
const batchSize = Number(process.argv[4] ?? 0);
assert.ok(Number.isInteger(batchSize) && batchSize >= 0 && batchSize <= 2000, 'Batch size must be 0..2000');
let batchMetrics;
const trial = resolve(process.argv[3] ?? resolve(music, '.local/muse-cleaned/trial-100-v1'));
const trialRelative = relative(resolve(music, '.local'), trial);
assert.ok(trialRelative && !trialRelative.startsWith('..') && !isAbsolute(trialRelative), 'Trial must be under music/.local');
const reportFile = resolve(process.argv[2] ?? resolve(music, '.local/muse-db-load/trial-100-v1/result.json'));
const localRelative = relative(resolve(music, '.local'), reportFile);
assert.ok(localRelative && !localRelative.startsWith('..') && !isAbsolute(localRelative), 'Report must be under music/.local');
const sqlFiles = ['001_schema.sql', '002_normalization_v1.sql', '003_recommendation_views.sql'];
const views = ['recommend_a', 'recommend_b1', 'recommend_b2', 'recommend_c1', 'recommend_c2'];
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const sha = data => createHash('sha256').update(data).digest('hex');
const json = async name => JSON.parse(await readFile(resolve(trial, name), 'utf8'));
async function jsonl(name, limit = Infinity, filter = () => true) {
    const rows = [];
    for await (const row of entries(resolve(trial, name))) {
        if (filter(row)) rows.push(row);
        if (rows.length >= limit) break;
    }
    return rows;
}
async function shaFile(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
}
const key = row => JSON.stringify([row.provider, row.external_id, row.source_version]);
const q = async (db, sql, args = []) => (await db.query(sql, args)).rows;
async function reject(db, sql, args, code) {
    try { await db.query(sql, args); }
    catch (error) { eq(error.code, code); return; }
    assert.fail(`Expected SQLSTATE ${code}: ${sql}`);
}

// Exact decimal comparisons avoid casting source NUMERIC values to JS Number.
function fraction(text) {
    const match = String(text).match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    assert.ok(match, `Not a decimal: ${text}`);
    const scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
    let numerator = BigInt(match[2] + (match[3] ?? '')) * (match[1] === '-' ? -1n : 1n);
    if (scale < 0) numerator *= 10n ** BigInt(-scale);
    return [numerator, scale > 0 ? 10n ** BigInt(scale) : 1n];
}
function exact(a, b) {
    const [an, ad] = fraction(a), [bn, bd] = fraction(b);
    eq(an * bd, bn * ad);
}
function close(a, b) {
    const [an, ad] = fraction(a), [bn, bd] = fraction(b);
    const difference = an * bd - bn * ad;
    ok((difference < 0n ? -difference : difference) * 10n ** 15n <= ad * bd,
        `Normalization mismatch: ${a} versus ${b}`);
}
async function initialize(db) {
    for (const file of sqlFiles) await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
    eq((await q(db, `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='music' AND table_type='BASE TABLE'`))[0].n, 3);
    eq((await q(db, `SELECT table_name FROM information_schema.views
        WHERE table_schema='music' ORDER BY table_name`)).map(r => r.table_name), views);
}
const sourceColumns = ['song_id', 'provider', 'external_id', 'source_version', 'fetched_at',
    'source_url', 'rights_reference', 'raw_payload', 'candidate_spotify_id', 'match_status',
    'match_evidence', 'verified_at', 'is_recommendation_source'];
async function insertSource(db, source) {
    eq(Object.keys(source).sort(), [...sourceColumns].sort());
    return (await q(db, `INSERT INTO music.song_sources(${sourceColumns.join(',')})
        VALUES (${sourceColumns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
        sourceColumns.map(c => source[c])))[0].id;
}
async function viewCounts(db) {
    const counts = {};
    for (const view of views) counts[view] = (await q(db, `SELECT count(*)::int AS n FROM music.${view}`))[0].n;
    return counts;
}
async function tableCounts(db) {
    const counts = {};
    for (const table of ['songs', 'song_sources', 'emotion_scores']) {
        counts[table] = (await q(db, `SELECT count(*)::int AS n FROM music.${table}`))[0].n;
    }
    return counts;
}

const stats = await json('stats.json');
const validation = await json('validation.json');
eq(validation.result, 'PASS');
for (const [file, hash] of Object.entries(validation.artifacts_sha256)) {
    eq(await shaFile(resolve(trial, file)), hash);
}
eq(sha(await readFile(new URL('002_normalization_v1.sql', import.meta.url))), stats.sql_config_sha256);
eq(sha(await readFile(resolve(music, '.local/music-muse/zenodo-4281165-v1.0.0/muse_dataset.csv'))), stats.source_sha256);
const sources = await jsonl('song_sources.jsonl', batchSize ? 1 : Infinity);
const scores = await jsonl('emotion_scores.jsonl', batchSize ? 1 : Infinity);
const classes = await jsonl('classifications.jsonl', Infinity, c => !batchSize || c.below_one);
const duplicateGroups = await json('duplicate_groups.json');
const expectedRows = stats.counts.selected_rows;
if (!batchSize) { eq(sources.length, expectedRows); eq(scores.length, expectedRows * 4); }
const db = new PGlite();
const fixtureDb = new PGlite();
try {
    await initialize(db);
    const ids = new Map();
    let loadSeconds;
    let actualCounts;
    if (batchSize) {
        batchMetrics = await loadBatches({ db, trial, stats, batchSize, ids, sourceColumns,
            key, eq, ok, exact, close, q, progressFile: resolve(dirname(reportFile), 'batches.jsonl') });
        loadSeconds = batchMetrics.loadSeconds;
        actualCounts = await tableCounts(db);
        eq(actualCounts, { songs: 0, song_sources: expectedRows, emotion_scores: expectedRows * 4 });
    } else {
        const loadStarted = performance.now();
        await db.exec('BEGIN');
        try {
            for (const src of sources) {
                eq(src.match_status, 'pending'); eq(src.song_id, null); eq(src.is_recommendation_source, false);
                ok(!ids.has(key(src)), 'Duplicate natural source key in input');
                ids.set(key(src), await insertSource(db, src));
            }
            for (const score of scores) {
                const id = ids.get(key(score.source_key));
                ok(id !== undefined, 'Missing source FK mapping');
                const s = score.insert_values;
                // Never INSERT the generated normalized_value or fabricate identity IDs.
                await q(db, `INSERT INTO music.emotion_scores
                    (song_source_id,metric,raw_value,normalization_version) VALUES ($1,$2,$3,$4)`,
                    [id, s.metric, s.raw_value, s.normalization_version]);
            }
            await db.exec('COMMIT');
        } catch (error) { await db.exec('ROLLBACK'); throw error; }
        loadSeconds = (performance.now() - loadStarted) / 1000;
        actualCounts = await tableCounts(db);
        eq(actualCounts, { songs: 0, song_sources: expectedRows, emotion_scores: expectedRows * 4 });
        const persisted = await q(db, `SELECT id,provider,external_id,source_version,raw_payload,
            candidate_spotify_id,song_id,match_status,verified_at,match_evidence,is_recommendation_source
            FROM music.song_sources`);
        const sourceMap = new Map(sources.map(s => [key(s), s]));
        for (const src of persisted) {
            const original = sourceMap.get(key(src));
            eq(src.raw_payload, original.raw_payload);
            eq(src.candidate_spotify_id, original.candidate_spotify_id);
            eq(src.song_id, null); eq(src.match_status, 'pending');
            eq(src.verified_at, null); eq(src.match_evidence, null); eq(src.is_recommendation_source, false);
        }
        const storedScores = await q(db, `SELECT ss.provider,ss.external_id,ss.source_version,
            e.metric,e.raw_value::text,e.normalized_value::text,e.normalization_version,
            e.normalization_config->>'raw_min' AS raw_min,
            e.normalization_config->>'raw_max' AS raw_max,e.normalization_config->>'source_sha256' AS source_sha256
            FROM music.emotion_scores e JOIN music.song_sources ss ON ss.id=e.song_source_id`);
        const scoreMap = new Map(storedScores.map(r => [JSON.stringify([key(r), r.metric, r.normalization_version]), r]));
        eq(scoreMap.size, expectedRows * 4);
        for (const entry of scores) {
            const s = entry.insert_values, p = entry.preview;
            const stored = scoreMap.get(JSON.stringify([key(entry.source_key), s.metric, s.normalization_version]));
            ok(Boolean(stored), 'Score not persisted');
            exact(stored.raw_value, s.raw_value); close(stored.normalized_value, p.normalized_value);
            exact(stored.raw_min, p.raw_min); exact(stored.raw_max, p.raw_max);
            eq(stored.source_sha256, stats.source_sha256);
        }
    } // sequential input path; batch path verifies every committed batch above
    eq((await q(db, `SELECT count(*)::int AS n FROM music.song_sources WHERE candidate_spotify_id IS NULL`))[0].n,
        stats.counts.missing_spotify_id ?? 0);
    for (const group of duplicateGroups) {
        const got = await q(db, `SELECT external_id FROM music.song_sources
            WHERE candidate_spotify_id=$1 ORDER BY external_id`, [group.spotify_id]);
        eq(got.map(r => r.external_id), [...group.selected_external_ids].sort());
    }
    for (const entry of classes.filter(c => c.below_one)) {
        eq((await q(db, `SELECT count(*)::int AS n FROM music.emotion_scores
            WHERE song_source_id=$1`, [ids.get(key(entry.source_key))]))[0].n, 4);
    }
    const actualViews = await viewCounts(db);
    eq(actualViews, Object.fromEntries(views.map(name => [name, 0])));

    // Constraint failures must leave the real pending dataset untouched.
    await reject(db, `INSERT INTO music.song_sources(provider,external_id,source_version,source_url,rights_reference)
        SELECT provider,external_id,source_version,source_url,rights_reference
        FROM music.song_sources WHERE id=$1`, [ids.get(key(sources[0]))], '23505');
    await reject(db, `INSERT INTO music.song_sources(id,provider,external_id,source_version,source_url,rights_reference)
        OVERRIDING SYSTEM VALUE SELECT id,provider,'pk-probe',source_version,source_url,rights_reference
        FROM music.song_sources WHERE id=$1`, [ids.get(key(sources[0]))], '23505');
    const first = scores[0].insert_values;
    await reject(db, `INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
        VALUES ($1,$2,$3,$4)`, [ids.get(key(scores[0].source_key)), first.metric, first.raw_value, first.normalization_version], '23505');
    await reject(db, `INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
        VALUES (999999,'valence',1,'muse-theoretical-v1')`, [], '23503');
    await reject(db, `UPDATE music.song_sources SET is_recommendation_source=true WHERE id=$1`,
        [ids.get(key(sources[0]))], '23514');
    eq(await tableCounts(db), actualCounts);
    eq((await q(db, `SELECT count(*)::int AS n FROM music.song_sources
        WHERE match_status='pending' AND song_id IS NULL AND NOT is_recommendation_source`))[0].n, expectedRows);

    // Independent database with ONLY synthetic verified MuSe sources, no real rows.
    await initialize(fixtureDb);
    for (const [index, rawV, rawA] of [[1, '0.5', '0.5'],
        [2, '0.23500000000000001', '0.1081132075471698'], [3, '8.475', '7.27'], [4, '4', null]]) {
        const spotify = String(index).padStart(22, 'T');
        const song = (await q(fixtureDb, `INSERT INTO music.songs(spotify_id,title,artist)
            VALUES ($1,'Synthetic fixture','No real artist') RETURNING id`, [spotify]))[0].id;
        const source = { ...sources[0], external_id: `synthetic-${index}`, song_id: song,
            candidate_spotify_id: spotify, match_status: 'verified', is_recommendation_source: true,
            raw_payload: { synthetic: true }, source_url: 'https://example.invalid/fixture',
            rights_reference: 'Synthetic fixture only', verified_at: '2026-10-17T00:00:00Z',
            match_evidence: { method: 'synthetic-test', reference: 'isolated-fixture-database' } };
        const src = await insertSource(fixtureDb, source);
        for (const cfg of stats.configs) {
            const raw = cfg.metric === 'valence' ? rawV : rawA;
            if (raw === null) continue;
            await q(fixtureDb, `INSERT INTO music.emotion_scores
                (song_source_id,metric,raw_value,normalization_version) VALUES ($1,$2,$3,$4)`,
                [src, cfg.metric, raw, cfg.version]);
        }
        if (rawA !== null) {
            for (const [view, version] of [['recommend_b1', 'muse-theoretical-v1'], ['recommend_b2', 'muse-observed-v1']]) {
                const result = (await q(fixtureDb, `SELECT valence::text,arousal::text,
                    valence_source_id,arousal_source_id FROM music.${view} WHERE song_id=$1`, [song]))[0];
                ok(Boolean(result), 'Verified complete fixture excluded');
                eq(result.valence_source_id, result.arousal_source_id);
                // Independent expected expression from the captured SQL config.
                for (const [metric, raw] of [['valence', rawV], ['arousal', rawA]]) {
                    const cfg = stats.configs.find(c => c.version === version && c.metric === metric);
                    const expected = (await q(fixtureDb,
                        `SELECT (2*($1::numeric-$2::numeric)/($3::numeric-$2::numeric)-1)::text AS value`,
                        [raw, cfg.raw_min, cfg.raw_max]))[0].value;
                    exact(result[metric], expected);
                }
            }
        }
    }
    const fixtureViews = await viewCounts(fixtureDb);
    eq(fixtureViews, { recommend_a: 0, recommend_b1: 3, recommend_b2: 3, recommend_c1: 0, recommend_c2: 0 });
    const edges = await q(fixtureDb, `SELECT spotify_id,valence::text,arousal::text
        FROM music.recommend_b2 ORDER BY spotify_id`);
    exact(edges[1].valence, -1); exact(edges[1].arousal, -1);
    exact(edges[2].valence, 1); exact(edges[2].arousal, 1);
    await reject(fixtureDb, `INSERT INTO music.songs(spotify_id,title,artist)
        SELECT spotify_id,title,artist FROM music.songs LIMIT 1`, [], '23505');
    await reject(fixtureDb, `INSERT INTO music.song_sources
        (song_id,provider,external_id,source_version,source_url,rights_reference,candidate_spotify_id,
         match_status,match_evidence,verified_at)
        VALUES (999999,'muse','orphan','zenodo-4281165-v1.0.0','fixture','fixture',$1,
        'verified','{"method":"fixture","reference":"fixture"}',now())`, ['X'.repeat(22)], '23503');
    eq(await tableCounts(db), actualCounts);
    eq(await viewCounts(db), actualViews);

    const report = {
        result: 'PASS', checks, engine: (await q(db, 'SELECT version() AS version'))[0].version,
        timing: { load_seconds: loadSeconds, test_seconds: (performance.now() - startedAt) / 1000,
            load_method: batchSize ? 'bounded JSONL; multi-row INSERT; one transaction per source batch; PK mapping and checks included; SELECT audit excluded' : 'single transaction; sequential parameterized INSERTs; includes PK mapping and input checks',
            source_rows_per_second: expectedRows / loadSeconds },
        memory: { peak_rss_bytes: process.resourceUsage().maxRSS * 1024, final: process.memoryUsage(),
            method: 'Node process.resourceUsage().maxRSS OS process lifetime peak; includes PGlite WASM and fixtures' },
        batches: batchMetrics,
        errors: { unexpected: 0, expected_constraint_rejections: 7 },
        actual_data: { counts: actualCounts, all_sources_pending: true,
            unique_spotify_candidates: Number((await q(db, 'SELECT count(DISTINCT candidate_spotify_id) AS n FROM music.song_sources'))[0].n),
            preserved_duplicate_rows: stats.counts.duplicate_spotify_id,
            preserved_missing_id_rows: stats.counts.missing_spotify_id,
            preserved_below_one_rows: stats.counts.below_one_rows,
            normalization_comparisons: expectedRows * 4, absolute_tolerance: '1e-15', view_counts: actualViews },
        isolated_synthetic_data: { counts: await tableCounts(fixtureDb), view_counts: fixtureViews,
            missing_coordinate_source_excluded: true, no_reccobeats: true },
        source_sha256: stats.source_sha256,
        input_artifacts_sha256: validation.artifacts_sha256,
        sql_sha256: Object.fromEntries(await Promise.all(sqlFiles.map(async file =>
            [file, sha(await readFile(new URL(file, import.meta.url)))]))),
        memory_only: true, external_database_connection: false,
        lifecycle: 'Both isolated in-memory instances closed in finally; no data directory persisted'
    };
    await mkdir(dirname(reportFile), { recursive: true });
    await writeFile(reportFile, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' });
    console.log(JSON.stringify({ report: reportFile, result: report.result, checks,
        counts: actualCounts, timing: report.timing, memory_peak_rss_bytes: report.memory.peak_rss_bytes, errors: report.errors }, null, 2));
} finally {
    await Promise.all([db.close(), fixtureDb.close()]);
}
