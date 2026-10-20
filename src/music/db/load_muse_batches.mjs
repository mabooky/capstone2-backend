// Bounded JSONL batches for the existing isolated PGlite integration test.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function* entries(path) {
    const input = createReadStream(path, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    try { for await (const line of lines) if (line.trim()) yield JSON.parse(line); }
    finally { lines.close(); input.destroy(); }
}

export async function loadBatches({ db, trial, stats, batchSize, ids, sourceColumns,
    key, eq, ok, exact, close, q, progressFile }) {
    await mkdir(dirname(progressFile), { recursive: true });
    await writeFile(progressFile, '', { flag: 'wx' });
    const scoreIterator = entries(resolve(trial, 'emotion_scores.jsonl'))[Symbol.asyncIterator]();
    let batch = [], sourceCount = 0, scoreCount = 0, batchCount = 0, loadSeconds = 0;
    const began = performance.now();
    const commitBatch = async () => {
        const scores = [];
        for (let i = 0; i < batch.length * 4; i++) {
            const next = await scoreIterator.next();
            ok(!next.done, 'Truncated score input');
            scores.push(next.value);
        }
        const beganLoad = performance.now();
        await db.exec('BEGIN');
        let storedSources;
        try {
            for (const src of batch) {
                eq(Object.keys(src).sort(), [...sourceColumns].sort());
                eq(src.match_status, 'pending'); eq(src.song_id, null); eq(src.is_recommendation_source, false);
                ok(!ids.has(key(src)), 'Repeated natural source key');
            }
            storedSources = await q(db, `INSERT INTO music.song_sources(${sourceColumns.join(',')})
                SELECT ${sourceColumns.join(',')} FROM jsonb_populate_recordset(NULL::music.song_sources,$1::jsonb)
                RETURNING id,provider,external_id,source_version,raw_payload,candidate_spotify_id,song_id,
                    match_status,verified_at,match_evidence,is_recommendation_source`, [JSON.stringify(batch)]);
            eq(storedSources.length, batch.length);
            const batchIds = new Map(storedSources.map(src => [key(src), src.id]));
            const insertScores = scores.map(entry => {
                const id = batchIds.get(key(entry.source_key));
                ok(id !== undefined, 'Score must map to the current source batch');
                return { song_source_id: id, ...entry.insert_values };
            });
            await q(db, `INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
                SELECT song_source_id,metric,raw_value,normalization_version FROM jsonb_to_recordset($1::jsonb)
                AS x(song_source_id bigint,metric text,raw_value numeric,normalization_version text)`,
                [JSON.stringify(insertScores)]);
            await db.exec('COMMIT');
        } catch (error) {
            await db.exec('ROLLBACK');
            await appendFile(progressFile, JSON.stringify({ result: 'FAIL', committed_sources: sourceCount,
                committed_scores: scoreCount, failed_batch: batchCount + 1, sqlstate: error.code,
                error: error.message, memory: process.memoryUsage() }) + '\n');
            throw error;
        }
        loadSeconds += (performance.now() - beganLoad) / 1000;
        const sourceMap = new Map(batch.map(src => [key(src), src]));
        for (const src of storedSources) {
            const original = sourceMap.get(key(src));
            ok(Boolean(original), 'Unexpected returned source');
            eq(src.raw_payload, original.raw_payload); eq(src.candidate_spotify_id, original.candidate_spotify_id);
            eq(src.song_id, null); eq(src.match_status, 'pending'); eq(src.verified_at, null);
            eq(src.match_evidence, null); eq(src.is_recommendation_source, false);
            ids.set(key(src), src.id);
        }
        const stored = await q(db, `SELECT ss.provider,ss.external_id,ss.source_version,e.metric,
            e.raw_value::text,e.normalized_value::text,e.normalization_version,
            e.normalization_config->>'raw_min' AS raw_min,e.normalization_config->>'raw_max' AS raw_max,
            e.normalization_config->>'source_sha256' AS source_sha256
            FROM music.emotion_scores e JOIN music.song_sources ss ON ss.id=e.song_source_id
            WHERE e.song_source_id=ANY($1::bigint[])`, [storedSources.map(src => src.id)]);
        const scoreKey = (src, metric, version) => JSON.stringify([key(src), metric, version]);
        const scoreMap = new Map(stored.map(r => [scoreKey(r, r.metric, r.normalization_version), r]));
        eq(stored.length, scores.length); eq(scoreMap.size, scores.length);
        for (const entry of scores) {
            const s = entry.insert_values, p = entry.preview;
            const r = scoreMap.get(scoreKey(entry.source_key, s.metric, s.normalization_version));
            ok(Boolean(r), 'Score missing from committed batch');
            exact(r.raw_value, s.raw_value); close(r.normalized_value, p.normalized_value);
            exact(r.raw_min, p.raw_min); exact(r.raw_max, p.raw_max);
            eq(r.source_sha256, stats.source_sha256);
        }
        sourceCount += batch.length; scoreCount += scores.length; batchCount++;
        await appendFile(progressFile, JSON.stringify({ batch: batchCount, committed_sources: sourceCount,
            committed_scores: scoreCount, load_seconds: loadSeconds,
            elapsed_seconds: (performance.now() - began) / 1000, memory: process.memoryUsage(),
            peak_rss_bytes: process.resourceUsage().maxRSS * 1024 }) + '\n');
        if (batchCount % 20 === 0) console.log(JSON.stringify({ committed_sources: sourceCount, batches: batchCount }));
        batch = [];
    };
    try {
        for await (const src of entries(resolve(trial, 'song_sources.jsonl'))) {
            batch.push(src);
            if (batch.length === batchSize) await commitBatch();
        }
        if (batch.length) await commitBatch();
        ok((await scoreIterator.next()).done, 'Unexpected trailing score rows');
    } finally { await scoreIterator.return(); }
    eq(sourceCount, stats.counts.selected_rows); eq(scoreCount, sourceCount * 4);
    return { loadSeconds, batchCount, batchSize, verifiedSources: sourceCount, verifiedScores: scoreCount,
        batchLoadAndAuditSeconds: (performance.now() - began) / 1000 };
}
