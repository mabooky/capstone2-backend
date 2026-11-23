/** 아티스트 그 자체입니다. 전체 아티스트를 담은 artistLibrary가 이 형태로 돌려줍니다. artists_v4의 한 행에 해당합니다. */
export type Artist = {
    id: string; // Spotify 아티스트 ID
    name: string;
    imageUrl640: string | null; // 가로 640픽셀 프로필 사진. 프로필 사진이 없는 아티스트는 이 크기만 있고, 앨범 커버일 수 있습니다.
    imageUrl320: string | null; // 가로 320픽셀 프로필 사진. 없으면 null
    imageUrl160: string | null; // 가로 160픽셀 프로필 사진. 없으면 null
    monthlyListeners: number | null; // Spotify 월간 청취자 수. 없으면 null
    topTrackIds: string[]; // 인기곡의 Spotify 곡 ID를 인기 순으로 담습니다. 곡 라이브러리에 없는 곡도 있을 수 있습니다.
}
