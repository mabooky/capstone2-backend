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

/** 전체 곡을 메모리에 올려 두고 조회하는 도구입니다. 서버가 시작할 때 한 번 만들고 바뀌지 않습니다. */
export class Library {
    readonly size: number;
    private readonly tracks: Track[];
    private readonly byId: Map<string, Track>;
    private readonly valences: Float64Array;
    private readonly arousals: Float64Array;
    private readonly searchTexts: string[];

    constructor(tracks: readonly Track[]) {
        // 거리가 같은 곡의 순서를 DB의 문자 정렬 규칙과 무관하게 정하려고, Spotify ID를 단순 비교로 정렬합니다.
        this.tracks = [...tracks].sort((a, b) => (a.spotifyId < b.spotifyId ? -1 : a.spotifyId > b.spotifyId ? 1 : 0));
        this.size = this.tracks.length;
        this.byId = new Map(this.tracks.map(track => [track.spotifyId, track]));
        this.valences = Float64Array.from(this.tracks, track => track.valence);
        this.arousals = Float64Array.from(this.tracks, track => track.arousal);
        this.searchTexts = this.tracks.map(track => `${track.title}\n${track.artist}`.toLowerCase());
    }

    /** DB의 songs 테이블을 읽어 Library를 만듭니다. */
    static async fromDatabase(client: QueryClient): Promise<Library> {
        // note: 본래 테이블 이름을 tracks로 해야했으나 songs로 생성함
        const result = await client.query('SELECT spotify_id, title, artist, duration_ms, valence, energy FROM songs');
        return new Library(
            (result.rows as TrackRow[]).map(row => ({
                spotifyId: row.spotify_id,
                title: row.title,
                artist: row.artist,
                duration: row.duration_ms,
                albumImageUrl: '',
                valence: Number(row.valence),
                arousal: Number(row.energy),
            })),
        );
    }

    get(spotifyId: string): Track | undefined {
        return this.byId.get(spotifyId);
    }

    /** 기준점에서 가까운 순서로 n곡을 돌려줍니다. 이 결과가 매장의 카탈로그가 됩니다. */
    nearest(valence: number, arousal: number, n: number): Track[] {
        const distances = new Float64Array(this.size);
        for (let i = 0; i < this.size; i++) {
            const dv = this.valences[i] - valence;
            const da = this.arousals[i] - arousal;
            distances[i] = dv * dv + da * da;
        }
        // 정렬은 안정 정렬이므로, 거리가 같으면 생성자에서 정렬해 둔 Spotify ID 순서가 유지됩니다.
        const order = Array.from(this.tracks.keys()).sort((a, b) => distances[a] - distances[b]);
        return order.slice(0, Math.max(0, n)).map(index => this.tracks[index]);
    }

    /** 제목과 아티스트에서 검색어를 찾습니다. 검색어로 시작하는 곡을 먼저 돌려줍니다. */
    search(query: string, limit: number, offset: number): { total: number; tracks: Track[] } {
        const needle = query.trim().toLowerCase();
        if (needle === '') return { total: 0, tracks: [] };
        const startsWithNeedle: Track[] = [];
        const containsNeedle: Track[] = [];
        for (let i = 0; i < this.size; i++) {
            if (!this.searchTexts[i].includes(needle)) continue;
            const track = this.tracks[i];
            const isPrefix = track.title.toLowerCase().startsWith(needle) || track.artist.toLowerCase().startsWith(needle);
            (isPrefix ? startsWithNeedle : containsNeedle).push(track);
        }
        const matches = startsWithNeedle.concat(containsNeedle);
        return { total: matches.length, tracks: matches.slice(offset, offset + limit) };
    }
}
