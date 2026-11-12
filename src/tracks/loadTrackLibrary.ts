import { findAllTracks } from '../db/trackRepository.js';
import { createTrackLibraryFrom, type TrackLibrary } from './trackLibrary.js';

/** DB에서 곡을 읽어 메모리 곡 라이브러리를 만듭니다. 서버를 시작할 때 한 번 호출합니다. */
export async function loadTrackLibrary(): Promise<TrackLibrary> {
    return createTrackLibraryFrom(await findAllTracks());
}
