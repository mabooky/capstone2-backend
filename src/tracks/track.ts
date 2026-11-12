/** 곡 그 자체입니다. 전체 곡을 담은 trackLibrary가 이 형태로 돌려줍니다. */
export type Track = {
    spotifyId: string;
    title: string;
    artist: string;
    duration: number;    // ms
    albumImageUrl: string;
    valence: number;     // [-1, 1]
    arousal: number;     // [-1, 1]
}
