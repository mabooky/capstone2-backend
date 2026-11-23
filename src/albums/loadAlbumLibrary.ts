import { findAllAlbums } from '../db/albumRepository.js';
import { createAlbumLibraryFrom, type AlbumLibrary } from './albumLibrary.js';

/** DB에서 앨범을 읽어 메모리 앨범 라이브러리를 만듭니다. 서버를 시작할 때 한 번 호출합니다. */
export async function loadAlbumLibrary(): Promise<AlbumLibrary> {
    return createAlbumLibraryFrom(await findAllAlbums());
}
