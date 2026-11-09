import { findAllTracks } from './db/trackRepository.js';
import { createTrackLibrary } from './trackLibraryData.js';

/**
 * 이 모듈을 처음 불러올 때 DB의 tracks_v3 테이블을 한 번 읽어 trackLibrary를 만듭니다. 이후에는 바뀌지 않습니다.
 * DATABASE_URL이 필요하므로, 환경변수를 읽는 dotenv/config를 이 모듈보다 먼저 불러와야 합니다.
 */
export const trackLibrary = createTrackLibrary(await findAllTracks());
export type { TrackLibrary } from './trackLibraryData.js';
