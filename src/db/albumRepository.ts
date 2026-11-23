import { pool } from './connectionPool.js';

/** albums_v4 테이블에서 읽는 한 줄입니다. 커버는 가로 640, 300, 64픽셀 크기별 URL입니다. */
export interface AlbumRow {
    spotify_id: string;
    name: string;
    type: 'album' | 'single' | 'ep' | 'compilation';
    artist: string; // 앨범 아티스트 이름을 ', '로 이은 표시용 문자열
    artist_spotify_ids: string[]; // artist와 같은 순서
    release_date: string; // 'YYYY-MM-DD'. pg가 date를 로컬 시간대의 Date로 바꾸지 않도록 문자열로 읽습니다.
    cover_url_640: string;
    cover_url_300: string;
    cover_url_64: string;
}

/** albums_v4의 모든 앨범을 읽어옵니다. */
export async function findAllAlbums(): Promise<AlbumRow[]> {
    try {
        const result = await pool.query<AlbumRow>(
            'SELECT spotify_id, name, type, artist, artist_spotify_ids, release_date::text AS release_date, cover_url_640, cover_url_300, cover_url_64 FROM albums_v4',
        );
        return result.rows;
    } catch (error) {
        throw new Error('앨범 데이터를 불러오지 못했습니다.', { cause: error });
    }
}
