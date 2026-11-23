/** 앨범 그 자체입니다. 전체 앨범을 담은 albumLibrary가 이 형태로 돌려줍니다. albums_v4의 한 행에 해당합니다. */
export type Album = {
    id: string; // Spotify 앨범 ID
    name: string;
    type: 'album' | 'single' | 'ep' | 'compilation';
    artist: string; // 앨범 아티스트 이름을 ', '로 이은 표시용 문자열
    artistIds: string[]; // Spotify 아티스트 ID. artist와 같은 순서
    releaseDate: string; // 'YYYY-MM-DD'
    coverUrl640: string; // 가로 640픽셀 앨범 커버
    coverUrl300: string; // 가로 300픽셀 앨범 커버
    coverUrl64: string; // 가로 64픽셀 앨범 커버
}
