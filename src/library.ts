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

/** query()만 있으면 되는 DB 클라이언트입니다. pg의 Client 등이 이 형태를 만족합니다. */
export interface QueryClient {
    query(sql: string): Promise<{ rows: unknown[] }>;
}

/** DB의 전체 곡을 메모리에 올려 두고 조회하는 도구입니다. 서버가 시작할 때 한 번 만들고 바뀌지 않습니다. */
export interface Library {
    readonly size: number;
    get(spotifyId: string): Track | undefined;
    /** 기준점에서 가까운 순서로 n곡을 돌려줍니다. 이 결과가 매장의 카탈로그가 됩니다. */
    nearest(valence: number, arousal: number, n: number): Track[];
    /** 제목과 아티스트에서 검색어를 찾습니다. 검색어로 시작하는 곡을 먼저 돌려줍니다. */
    search(query: string, limit: number, offset: number): { total: number; tracks: Track[] };
}

/** DB의 songs 테이블을 읽어 Library를 만듭니다. */
export async function loadLibrary(client: QueryClient): Promise<Library> {
    // note: 본래 테이블 이름을 tracks로 해야했으나 songs로 생성함
    const result = await client.query('SELECT spotify_id, title, artist, duration_ms, valence, energy FROM songs');

    // 거리가 같은 곡의 순서를 DB의 문자 정렬 규칙과 무관하게 정하려고, Spotify ID를 단순 비교로 정렬합니다.
    const tracks: Track[] = (result.rows as TrackRow[])
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

    return {
        size: tracks.length,

        get(spotifyId) {
            return byId.get(spotifyId);
        },

        nearest(valence, arousal, n) {
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

        search(query, limit, offset) {
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
}
