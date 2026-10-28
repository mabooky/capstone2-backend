export type RequestStatus =
    | 'available'
    | 'out-of-mood'
    | 'already-queued'
    | 'now-playing'
    | 'recently-played';

/** 곡 그 자체입니다. 전체 곡을 담은 Library가 이 형태로 돌려줍니다. */
export type Track = {
    spotifyId: string;
    title: string;
    artist: string;
    duration: number;    // ms
    albumImageUrl: string;
    valence: number;     // [-1, 1]
    arousal: number;     // [-1, 1]
}

// API 명세의 Track은 이 타입(TrackWithStatus)에 해당합니다.
/** 곡에 매장에서의 신청 상태를 붙인, API 응답으로 나가는 형태입니다. */
export type TrackWithStatus = Track & { requestStatus: RequestStatus };
