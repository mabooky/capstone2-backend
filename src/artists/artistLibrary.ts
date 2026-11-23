import type { Artist } from './artist.js';
import type { ArtistRow } from '../db/artistRepository.js';

/** 전체 아티스트를 메모리에 올려 두고 조회하는 도구입니다. */
export interface ArtistLibrary {
    /** 전체 아티스트 수입니다. */
    readonly size: number;
    get(id: string): Artist | undefined;
}

/** artists_v4의 행으로 메모리 아티스트 라이브러리를 만듭니다. DB에는 접속하지 않습니다. */
export function createArtistLibraryFrom(rows: readonly ArtistRow[]): ArtistLibrary {
    const byId = new Map<string, Artist>(rows.map(row => [row.spotify_id, {
        id: row.spotify_id,
        name: row.name,
        imageUrl640: row.image_url_640,
        imageUrl320: row.image_url_320,
        imageUrl160: row.image_url_160,
        monthlyListeners: row.monthly_listeners === null ? null : Number(row.monthly_listeners),
        topTrackIds: row.top_track_ids,
    }]));

    return {
        size: byId.size,

        get(id: string): Artist | undefined {
            return byId.get(id);
        },
    };
}
