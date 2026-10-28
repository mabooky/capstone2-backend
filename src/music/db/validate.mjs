// Only an isolated in-memory PostgreSQL engine; no URL/credentials/network DB.
// Uses the normal devDependency and synthetic fixtures only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
let checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
const near = (a, b) => { assert.ok(Math.abs(Number(a) - b) < 1e-12, `${a} != ${b}`); checks++; };
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
async function reject(sql, params, code) {
    try { await db.query(sql, params); }
    catch (error) { eq(error.code, code); return; }
    assert.fail(`Expected PostgreSQL ${code}: ${sql}`);
}
let external = 0;
async function song(n) {
    return (await query(`INSERT INTO music.songs(spotify_id,title,artist)
        VALUES ($1,'Fixture','Test artist') RETURNING id,spotify_id`, [String(n).padStart(22, '0')]))[0];
}
async function source(s, provider, { verified = true, selected = true, version } = {}) {
    return (await query(`INSERT INTO music.song_sources
        (song_id,provider,external_id,source_version,source_url,rights_reference,
         candidate_spotify_id,match_status,match_evidence,verified_at,is_recommendation_source)
        VALUES ($1,$2,$3,$4,'https://example.invalid/fixture','synthetic test fixture',
                $5,$6,$7,CASE WHEN $8 THEN CURRENT_TIMESTAMP ELSE NULL END,$9) RETURNING id`,
        [verified ? s.id : null, provider, `fixture-${++external}`,
         version ?? (provider === 'muse' ? 'zenodo-4281165-v1.0.0' : 'fixture-reccobeats-snapshot'),
         s.spotify_id, verified ? 'verified' : 'pending',
         verified ? { method: 'fixture', reference: 'synthetic-only' } : null,
         verified, selected]))[0].id;
}
async function score(src, metric, raw, version) {
    return query(`INSERT INTO music.emotion_scores
        (song_source_id,metric,raw_value,normalization_version) VALUES ($1,$2,$3,$4)
        RETURNING raw_value::text,normalized_value::text,normalization_config`, [src, metric, raw, version]);
}
async function bothMuse(src, v, a) {
    for (const version of ['muse-theoretical-v1', 'muse-observed-v1']) {
        await score(src, 'valence', v, version);
        await score(src, 'arousal', a, version);
    }
}
const views = ['recommend_a', 'recommend_b1', 'recommend_b2', 'recommend_c1', 'recommend_c2'];
try {
    for (const file of ['001_schema.sql', '002_normalization_v1.sql', '003_recommendation_views.sql']) {
        await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
    }
    eq((await query(`SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='music' AND table_type='BASE TABLE'`))[0].n, 3);
    eq((await query(`SELECT table_name FROM information_schema.views
        WHERE table_schema='music' ORDER BY table_name`)).map(r => r.table_name), views);

    const main = await song(1);
    const rb = await source(main, 'reccobeats');
    const mu = await source(main, 'muse');
    await score(rb, 'valence', '0.75', 'reccobeats-v1');
    await score(rb, 'energy', '0.25', 'reccobeats-v1');
    // Includes a below-one MuSe observation; no quality threshold discards it.
    await bothMuse(mu, '0.5', '0.5');
    for (const name of views) eq((await query(`SELECT count(*)::int AS n FROM music.${name}`))[0].n, 1);
    const a = (await query('SELECT valence::text,arousal::text FROM music.recommend_a'))[0];
    near(a.valence, 0.5); near(a.arousal, -0.5);
    const b1 = (await query('SELECT valence::text,arousal::text FROM music.recommend_b1'))[0];
    near(b1.valence, 2 * 0.5 / 9 - 1); near(b1.arousal, 2 * 0.5 / 9 - 1);
    const b2 = (await query('SELECT valence::text,arousal::text FROM music.recommend_b2'))[0];
    near(b2.valence, 2 * (0.5 - 0.23500000000000001) / (8.475 - 0.23500000000000001) - 1);
    near(b2.arousal, 2 * (0.5 - 0.1081132075471698) / (7.27 - 0.1081132075471698) - 1);
    for (const [name, expected] of [['recommend_c1', b1.arousal], ['recommend_c2', b2.arousal]]) {
        const c = (await query(`SELECT valence::text,arousal::text FROM music.${name}`))[0];
        near(c.valence, 0.5); near(c.arousal, Number(expected));
    }
    const snapshot = (await query(`SELECT normalization_config FROM music.emotion_scores
        WHERE song_source_id=$1 AND metric='valence' AND normalization_version='muse-observed-v1'`, [mu]))[0].normalization_config;
    eq(snapshot.population_rows, 90408);
    eq(snapshot.source_sha256, '56be88aea7dfa2c0446e0d7cc033d95c3550a3dc4364ac91c815cf998265fd2b');

    // Pending duplicate IDs remain separate observations, not merged or visible.
    const p1 = await source(main, 'muse', { verified: false, selected: false });
    const p2 = await source(main, 'muse', { verified: false, selected: false });
    await bothMuse(p1, '1', '2'); await bothMuse(p2, '3', '4');
    eq((await query(`SELECT count(*)::int AS n FROM music.song_sources
        WHERE candidate_spotify_id=$1 AND match_status='pending'`, [main.spotify_id]))[0].n, 2);
    eq((await query('SELECT count(*)::int AS n FROM music.recommend_b1'))[0].n, 1);
    const spare = await source(main, 'muse', { selected: false });
    await bothMuse(spare, '4', '4');
    await reject(`UPDATE music.song_sources SET is_recommendation_source=true WHERE id=$1`, [spare], '23505');
    await reject(`UPDATE music.song_sources SET is_recommendation_source=true WHERE id=$1`, [p1], '23514');
    await reject(`UPDATE music.song_sources SET match_status='verified',song_id=$2,verified_at=now()
        WHERE id=$1`, [p1, main.id], '23514');
    const other = await song(2);
    await reject(`UPDATE music.song_sources SET candidate_spotify_id=$2 WHERE id=$1`, [mu, other.spotify_id], '23503');

    const incomplete = await source(other, 'muse');
    await score(incomplete, 'valence', '3', 'muse-theoretical-v1');
    for (const name of views) eq((await query(`SELECT count(*)::int AS n FROM music.${name}`))[0].n, 1);
    const otherRb = await source(other, 'reccobeats');
    await score(otherRb, 'valence', '0.5', 'reccobeats-v1');
    await score(incomplete, 'arousal', '4', 'muse-theoretical-v1');
    // C needs only RB valence + MuSe arousal, while A still needs RB energy.
    for (const [name, expected] of [['recommend_a', 0], ['recommend_b1', 1],
        ['recommend_b2', 0], ['recommend_c1', 1], ['recommend_c2', 0]]) {
        eq((await query(`SELECT count(*)::int AS n FROM music.${name} WHERE song_id=$1`, [other.id]))[0].n, expected);
    }
    // No implicit fallback to another source/version when the selected one is incomplete.
    await query(`UPDATE music.song_sources SET is_recommendation_source=false WHERE id=$1`, [mu]);
    for (const name of views.slice(1)) eq((await query(`SELECT count(*)::int AS n FROM music.${name} WHERE song_id=$1`, [main.id]))[0].n, 0);
    await query(`UPDATE music.song_sources SET is_recommendation_source=true WHERE id=$1`, [mu]);

    const boundarySong = await song(3);
    const boundary = await source(boundarySong, 'muse');
    await bothMuse(boundary, '0.23500000000000001', '7.27');
    const edge = (await query(`SELECT valence::text,arousal::text FROM music.recommend_b2 WHERE song_id=$1`, [boundarySong.id]))[0];
    near(edge.valence, -1); near(edge.arousal, 1);
    const oppositeEdge = await source(boundarySong, 'muse', { selected: false });
    near((await score(oppositeEdge, 'valence', '8.475', 'muse-observed-v1'))[0].normalized_value, 1);
    near((await score(oppositeEdge, 'arousal', '0.1081132075471698', 'muse-observed-v1'))[0].normalized_value, -1);
    const zero = await source(boundarySong, 'muse', { selected: false });
    near((await score(zero, 'valence', '0', 'muse-theoretical-v1'))[0].normalized_value, -1);
    near((await score(zero, 'arousal', '9', 'muse-theoretical-v1'))[0].normalized_value, 1);
    const rbEdge = await source(boundarySong, 'reccobeats');
    near((await score(rbEdge, 'valence', '0', 'reccobeats-v1'))[0].normalized_value, -1);
    near((await score(rbEdge, 'energy', '1', 'reccobeats-v1'))[0].normalized_value, 1);

    const invalid = await source(other, 'reccobeats', { selected: false });
    for (const raw of ['-0.01', '1.01', 'NaN', 'Infinity', '-Infinity']) {
        await reject(`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
            VALUES ($1,'energy',$2,'reccobeats-v1')`, [invalid, raw], '23514');
    }
    await reject(`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
        VALUES ($1,'valence',1,'muse-observed-v1')`, [invalid], '23514');
    await reject(`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
        VALUES ($1,'valence',0.75,'unknown-version')`, [rb], '23514');
    await reject(`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
        VALUES ($1,'valence',0.75,'reccobeats-v1')`, [rb], '23505');
    await reject(`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,raw_min,raw_max,normalization_version)
        VALUES ($1,'energy',0.5,0,0,'reccobeats-v1')`, [invalid], '23514');
    await reject(`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
        VALUES (999999,'valence',0.5,'reccobeats-v1')`, [], '23503');
    await reject(`UPDATE music.emotion_scores SET raw_value=0 WHERE song_source_id=$1`, [rb], '55000');
    await reject(`DELETE FROM music.emotion_scores WHERE song_source_id=$1`, [rb], '55000');
    await reject(`UPDATE music.song_sources SET raw_payload='{"changed":true}' WHERE id=$1`, [mu], '55000');
    await reject(`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
        VALUES ($1,'valence',0.6,'muse-observed-v1')`, [zero], '23514');
    const wrongVersion = await source(other, 'muse', { selected: false, version: 'different-population' });
    await reject(`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
        VALUES ($1,'arousal',2,'muse-theoretical-v1')`, [wrongVersion], '23514');
    await reject(`INSERT INTO music.songs(spotify_id,title,artist) VALUES ($1,'Duplicate','Test')`, [main.spotify_id], '23505');
    await reject(`INSERT INTO music.songs(spotify_id,title,artist) VALUES ('bad-id','Bad','Test')`, [], '23514');
    await reject(`DELETE FROM music.songs WHERE id=$1`, [main.id], '23001');
    await reject(`INSERT INTO music.song_sources(provider,external_id,source_version,source_url,rights_reference)
        SELECT provider,external_id,source_version,source_url,rights_reference
        FROM music.song_sources WHERE id=$1`, [rb], '23505');
    await reject(`INSERT INTO music.emotion_scores
        (song_source_id,metric,raw_value,normalization_version,normalized_value)
        VALUES ($1,'energy',0.5,'reccobeats-v1',0)`, [invalid], '428C9');

    const engine = (await query('SELECT version() AS version'))[0].version;
    console.log(JSON.stringify({ checks, engine, result: 'PASS; synthetic fixtures only; no external DB' }, null, 2));
} finally { await db.close(); }
