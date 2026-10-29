import pg from 'pg';
import type { Track } from './models/track.js';

/** tracks가 아니라 songs 테이블에서 읽는 한 줄입니다. */
interface TrackRow {
    spotify_id: string;
    title: string;
    artist: string;
    duration_ms: number;
    valence: number;
    energy: number;
}

/**
 * 이 모듈을 처음 불러올 때 DB의 songs 테이블을 한 번 읽어 trackLibrary를 만듭니다. 이후에는 바뀌지 않습니다.
 * DATABASE_URL이 필요하므로, 환경변수를 읽는 dotenv/config를 이 모듈보다 먼저 불러와야 합니다.
 */
async function readRows(): Promise<TrackRow[]> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL 환경변수가 필요합니다.');

    const client = new pg.Client({
        connectionString: databaseUrl,
        // 로컬 DB가 아니면 SSL로 접속합니다. 인증서 검증이 필요 없는 환경은 DATABASE_SSL=false로 끌 수 있습니다.
        ssl: ['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname) || process.env.DATABASE_SSL === 'false'
            ? false
            : { rejectUnauthorized: false },
    });
    try {
        await client.connect();
        // note: 본래 테이블 이름을 tracks로 해야했으나 songs로 생성함
        const result = await client.query('SELECT spotify_id, title, artist, duration_ms, valence, energy FROM songs');
        return result.rows as TrackRow[];
    } catch (error) {
        throw new Error('곡 데이터를 불러오지 못했습니다.', { cause: error });
    } finally {
        await client.end().catch(() => {});
    }
}

// 거리가 같은 곡의 순서를 DB의 문자 정렬 규칙과 무관하게 정하려고, Spotify ID를 단순 비교로 정렬합니다.
const tracks: Track[] = (await readRows())
    .sort((a, b) => (a.spotify_id < b.spotify_id ? -1 : a.spotify_id > b.spotify_id ? 1 : 0))
    .map(row => ({
        spotifyId: row.spotify_id,
        title: row.title,
        artist: row.artist,
        duration: row.duration_ms,
        albumImageUrl: '',
        valence: Number(row.valence),
        arousal: Number(row.energy),
    }));
const byId = new Map(tracks.map(track => [track.spotifyId, track]));
const valences = Float64Array.from(tracks, track => track.valence);
const arousals = Float64Array.from(tracks, track => track.arousal);
const searchTexts = tracks.map(track => `${track.title}\n${track.artist}`.toLowerCase());

/** 전체 곡을 메모리에 올려 두고 조회하는 도구입니다. */
export const trackLibrary = {
    size: tracks.length,

    get(spotifyId: string): Track | undefined {
        return byId.get(spotifyId);
    },

    /** 기준점에서 가까운 순서로 n곡을 돌려줍니다. 이 결과가 매장의 카탈로그가 됩니다. */
    nearest(valence: number, arousal: number, n: number): Track[] {
        const distances = new Float64Array(tracks.length);
        for (let i = 0; i < tracks.length; i++) {
            const dv = valences[i] - valence;
            const da = arousals[i] - arousal;
            distances[i] = dv * dv + da * da;
        }
        // 정렬은 안정 정렬이므로, 거리가 같으면 위에서 정렬해 둔 Spotify ID 순서가 유지됩니다.
        const order = Array.from(tracks.keys()).sort((a, b) => distances[a] - distances[b]);
        return order.slice(0, Math.max(0, n)).map(index => tracks[index]);
    },

    /** 제목과 아티스트에서 검색어를 찾습니다. 검색어로 시작하는 곡을 먼저 돌려줍니다. */
    search(query: string, limit: number, offset: number): { total: number; tracks: Track[] } {
        const needle = query.trim().toLowerCase();
        if (needle === '') return { total: 0, tracks: [] };
        const startsWithNeedle: Track[] = [];
        const containsNeedle: Track[] = [];
        for (let i = 0; i < tracks.length; i++) {
            if (!searchTexts[i].includes(needle)) continue;
            const track = tracks[i];
            const isPrefix = track.title.toLowerCase().startsWith(needle) || track.artist.toLowerCase().startsWith(needle);
            (isPrefix ? startsWithNeedle : containsNeedle).push(track);
        }
        const matches = startsWithNeedle.concat(containsNeedle);
        return { total: matches.length, tracks: matches.slice(offset, offset + limit) };
    },
};

export type TrackLibrary = typeof trackLibrary;
