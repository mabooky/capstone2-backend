import { findAllArtists } from '../db/artistRepository.js';
import { createArtistLibraryFrom, type ArtistLibrary } from './artistLibrary.js';

/** DB에서 아티스트를 읽어 메모리 아티스트 라이브러리를 만듭니다. 서버를 시작할 때 한 번 호출합니다. */
export async function loadArtistLibrary(): Promise<ArtistLibrary> {
    return createArtistLibraryFrom(await findAllArtists());
}
