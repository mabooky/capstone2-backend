import pg from 'pg';
import { createTrackLibrary, type TrackRow } from './trackLibraryData.js';

/**
 * 이 모듈을 처음 불러올 때 DB의 tracks_v3 테이블을 한 번 읽어 trackLibrary를 만듭니다. 이후에는 바뀌지 않습니다.
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
        // 한국 재생 불가 곡(kr_available = false)도 걸러내지 않고 모두 불러옵니다.
        const result = await client.query('SELECT spotify_id, title, artist, duration_ms, valence, energy FROM tracks_v3');
        return result.rows as TrackRow[];
    } catch (error) {
        throw new Error('곡 데이터를 불러오지 못했습니다.', { cause: error });
    } finally {
        await client.end().catch(() => {});
    }
}

export const trackLibrary = createTrackLibrary(await readRows());
export type { TrackLibrary } from './trackLibraryData.js';
