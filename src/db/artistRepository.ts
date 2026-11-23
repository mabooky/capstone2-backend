import { pool } from './connectionPool.js';

/** artists_v4 테이블에서 읽는 한 줄입니다. 프로필 사진은 가로 640, 320, 160픽셀 크기별 URL이며, 해당 크기가 없으면 null입니다. */
export interface ArtistRow {
    spotify_id: string;
    name: string;
    image_url_640: string | null; // 프로필 사진이 없는 아티스트는 640픽셀만 있고, 그 이미지는 앨범 커버일 수 있습니다.
    image_url_320: string | null;
    image_url_160: string | null;
    monthly_listeners: string | null; // Spotify 월간 청취자 수. pg는 bigint를 문자열로 돌려줍니다.
    top_track_ids: string[]; // 인기곡의 Spotify 곡 ID를 인기 순으로 담습니다. tracks_v4에 없는 곡도 있을 수 있습니다.
}

/** artists_v4의 모든 아티스트를 읽어옵니다. */
export async function findAllArtists(): Promise<ArtistRow[]> {
    try {
        const result = await pool.query<ArtistRow>(
            'SELECT spotify_id, name, image_url_640, image_url_320, image_url_160, monthly_listeners, top_track_ids FROM artists_v4',
        );
        return result.rows;
    } catch (error) {
        throw new Error('아티스트 데이터를 불러오지 못했습니다.', { cause: error });
    }
}
