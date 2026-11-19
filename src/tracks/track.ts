/** 곡 그 자체입니다. 전체 곡을 담은 trackLibrary가 이 형태로 돌려줍니다. tracks_v4의 한 행에 해당합니다. */
export type Track = {
    id: string; // Spotify 곡 ID
    title: string;
    artist: string; // 참여 아티스트 이름을 ', '로 이은 표시용 문자열
    artistIds: string[]; // Spotify 아티스트 ID. artist와 같은 순서
    duration: number; // ms
    playCount: number; // Spotify 누적 재생 수. 값이 없는 곡은 0
    albumId: string; // Spotify 앨범 ID
    albumThumbUrl: string | null; // 64픽셀 앨범 커버. 없으면 null
    valence: number; // [-1, 1]
    arousal: number; // [-1, 1]
}
