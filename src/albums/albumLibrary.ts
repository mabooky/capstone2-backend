import type { Album } from './album.js';
import type { AlbumRow } from '../db/albumRepository.js';

/** 전체 앨범을 메모리에 올려 두고 조회하는 도구입니다. */
export interface AlbumLibrary {
    /** 전체 앨범 수입니다. */
    readonly size: number;
    get(id: string): Album | undefined;
}

/** albums_v4의 행으로 메모리 앨범 라이브러리를 만듭니다. DB에는 접속하지 않습니다. */
export function createAlbumLibraryFrom(rows: readonly AlbumRow[]): AlbumLibrary {
    const byId = new Map<string, Album>(rows.map(row => [row.spotify_id, {
        id: row.spotify_id,
        name: row.name,
        type: row.type,
        artist: row.artist,
        artistIds: row.artist_spotify_ids,
        releaseDate: row.release_date,
        coverUrl640: row.cover_url_640,
        coverUrl300: row.cover_url_300,
        coverUrl64: row.cover_url_64,
    }]));

    return {
        size: byId.size,

        get(id: string): Album | undefined {
            return byId.get(id);
        },
    };
}
