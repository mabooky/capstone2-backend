import type { Track } from '../tracks/track.js';

export type RequestStatus =
    | 'available'
    | 'out-of-mood'
    | 'already-queued'
    | 'now-playing'
    | 'recently-played';

/** 곡에 매장에서의 신청 상태를 붙인, API 응답으로 나가는 형태입니다. */
export type TrackWithStatus = Track & { requestStatus: RequestStatus };
