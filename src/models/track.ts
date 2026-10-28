export type RequestStatus =
    | 'available'
    | 'out-of-mood'
    | 'already-queued'
    | 'now-playing'
    | 'recently-played';

export type Track = {
    spotifyId: string;
    title: string;
    artist: string;
    duration: number;    // ms
    albumImageUrl: string;
    valence: number;     // [-1, 1]
    arousal: number;     // [-1, 1]
    requestStatus: RequestStatus;
}
