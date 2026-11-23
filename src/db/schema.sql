-- 서버 DB의 현재 구조입니다. 없는 테이블만 만들며, 서버는 이 파일을 실행하지 않습니다.
--
--   psql "$DATABASE_URL" -f src/db/schema.sql
--
-- 기존 테이블을 바꿀 때는 ALTER를 직접 실행하고 이 파일도 함께 고칩니다.

-- 곡. 연주곡, 같은 곡의 여러 버전도 걸러내지 않고 저장하며
-- 서비스에 노출할 곡은 조회할 때 정합니다. 오디오 값은 ReccoBeats 응답 원본입니다.
CREATE TABLE IF NOT EXISTS tracks_v3 (
    spotify_id text PRIMARY KEY CHECK (spotify_id ~ '^[0-9A-Za-z]{22}$'),
    reccobeats_id uuid NOT NULL,
    title text NOT NULL CHECK (btrim(title) <> ''),
    artist text NOT NULL CHECK (btrim(artist) <> ''), -- 참여 아티스트 이름을 ', '로 이은 문자열
    artist_reccobeats_ids uuid[] NOT NULL CHECK (cardinality(artist_reccobeats_ids) > 0), -- artist와 같은 순서
    duration_ms integer NOT NULL CHECK (duration_ms >= 0),
    popularity integer CHECK (popularity BETWEEN 0 AND 100),
    isrc text,
    acousticness double precision CHECK (acousticness BETWEEN 0 AND 1),
    danceability double precision CHECK (danceability BETWEEN 0 AND 1),
    energy double precision NOT NULL CHECK (energy BETWEEN 0 AND 1),
    instrumentalness double precision CHECK (instrumentalness BETWEEN 0 AND 1),
    liveness double precision CHECK (liveness BETWEEN 0 AND 1),
    loudness double precision, -- dB
    speechiness double precision CHECK (speechiness BETWEEN 0 AND 1),
    tempo double precision CHECK (tempo >= 0), -- BPM
    valence double precision NOT NULL CHECK (valence BETWEEN 0 AND 1),
    musical_key smallint CHECK (musical_key BETWEEN -1 AND 11), -- 0=C, ..., 11=B, -1=감지 실패
    musical_mode smallint CHECK (musical_mode IN (0, 1)) -- 0=단조, 1=장조
);

CREATE INDEX IF NOT EXISTS tracks_v3_artists_idx ON tracks_v3 USING gin (artist_reccobeats_ids);

-- 아래 artists_v4, albums_v4, tracks_v4는 capstone2-data 저장소의 v4/ 스크립트로 올린 새 곡 데이터이며, tracks_v3와는 별개입니다.

-- 아티스트. 곡과 앨범의 artist_spotify_ids가 가리키는 아티스트이며, 블랙리스트 화면에서 이름과 사진을 보여 줄 때 씁니다.
CREATE TABLE IF NOT EXISTS artists_v4 (
    spotify_id text PRIMARY KEY CHECK (spotify_id ~ '^[0-9A-Za-z]{22}$'),
    name text NOT NULL CHECK (btrim(name) <> ''),
    -- 프로필 사진입니다. 사진이 없는 아티스트는 640픽셀만 있고, 그 이미지는 앨범 커버일 수 있습니다.
    image_url_640 text,
    image_url_320 text,
    image_url_160 text,
    monthly_listeners bigint CHECK (monthly_listeners >= 0), -- Spotify 월간 청취자 수. 값이 없으면 NULL
    top_track_ids text[] NOT NULL DEFAULT '{}' -- 인기곡의 Spotify 곡 ID를 인기 순으로 담습니다. tracks_v4에 없는 곡도 있을 수 있습니다.
);

-- 앨범. tracks_v4의 곡이 속한 앨범입니다. 커버 이미지는 가로 640, 300, 64픽셀 크기별 URL입니다.
CREATE TABLE IF NOT EXISTS albums_v4 (
    spotify_id text PRIMARY KEY CHECK (spotify_id ~ '^[0-9A-Za-z]{22}$'),
    name text NOT NULL CHECK (btrim(name) <> ''),
    type text NOT NULL CHECK (type IN ('album', 'single', 'ep', 'compilation')),
    artist text NOT NULL CHECK (btrim(artist) <> ''), -- 앨범 아티스트 이름을 ', '로 이은 표시용 문자열
    artist_spotify_ids text[] NOT NULL CHECK (cardinality(artist_spotify_ids) > 0), -- artist와 같은 순서
    release_date date NOT NULL,
    cover_url_640 text NOT NULL,
    cover_url_300 text NOT NULL,
    cover_url_64 text NOT NULL
);
    
-- 곡. 서비스에서 추천하고 재생하는 단위입니다.
-- valence, arousal은 [-1, 1] 범위로 정규화한 값이며, 값이 없는 곡은 저장하지 않습니다.
CREATE TABLE IF NOT EXISTS tracks_v4 (
    spotify_id text PRIMARY KEY CHECK (spotify_id ~ '^[0-9A-Za-z]{22}$'),
    reccobeats_id uuid NOT NULL,
    title text NOT NULL CHECK (btrim(title) <> ''),
    artist text NOT NULL CHECK (btrim(artist) <> ''), -- 참여 아티스트 이름을 ', '로 이은 표시용 문자열
    artist_spotify_ids text[] NOT NULL CHECK (cardinality(artist_spotify_ids) > 0), -- artist와 같은 순서
    duration_ms integer NOT NULL CHECK (duration_ms >= 0),
    play_count bigint NOT NULL DEFAULT 0 CHECK (play_count >= 0), -- Spotify 누적 재생 수. 값이 없는 곡은 0입니다.
    album_id text NOT NULL REFERENCES albums_v4 (spotify_id),
    album_thumb_url text, -- 목록 화면용 64픽셀 앨범 커버. 조회할 때 앨범 테이블을 조인하지 않도록 곡에 둡니다.
    valence double precision NOT NULL CHECK (valence BETWEEN -1 AND 1),
    arousal double precision NOT NULL CHECK (arousal BETWEEN -1 AND 1)
);

CREATE INDEX IF NOT EXISTS tracks_v4_artist_spotify_ids_idx ON tracks_v4 USING gin (artist_spotify_ids);
CREATE INDEX IF NOT EXISTS tracks_v4_album_id_idx ON tracks_v4 (album_id);

-- 매장. id는 서버가 무작위로 생성하며 고객에게 노출되는 매장 주소에 쓰입니다.
CREATE TABLE IF NOT EXISTS stores (
    id text PRIMARY KEY CHECK (char_length(id) = 8),
    name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 50),
    admin_password_hash text NOT NULL, -- scrypt$N$r$p$salt$hash
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 사용자. 로그인 방식과 무관한 서비스 내부의 계정입니다.
CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nickname text NOT NULL CHECK (btrim(nickname) <> '' AND char_length(nickname) <= 50),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 사용자와 외부 로그인 계정의 연결. 같은 계정으로 다시 로그인하면 이 행으로 사용자를 찾습니다.
CREATE TABLE IF NOT EXISTS auth_identities (
    provider text NOT NULL CHECK (btrim(provider) <> ''), -- 예: kakao
    provider_user_id text NOT NULL CHECK (btrim(provider_user_id) <> ''), -- 제공자가 부여한 회원 번호
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, provider_user_id)
);

-- 로그인 세션. 토큰 원문은 저장하지 않고 SHA-256 해시만 저장합니다.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

-- 곡 신청 이력. 신청이 접수될 때마다 한 행을 남깁니다. 곡의 제목과 아티스트는 저장하지 않습니다.
CREATE TABLE IF NOT EXISTS track_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    store_id text NOT NULL REFERENCES stores (id),
    spotify_id text NOT NULL CHECK (spotify_id ~ '^[0-9A-Za-z]{22}$'),
    requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS track_requests_user_idx ON track_requests (user_id, requested_at DESC);

-- 고객의 곡 평가. 고객이 매장에서 재생된 곡에 남긴 추천(+1)과 비추천(-1)이며, 취소 시에는 행을 삭제하지 않고 0으로 바꿔 평가한 적이 있음을 남깁니다.
CREATE TABLE IF NOT EXISTS track_ratings (
    store_id text NOT NULL REFERENCES stores (id),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    track_spotify_id text NOT NULL CHECK (track_spotify_id ~ '^[0-9A-Za-z]{22}$'),
    rating smallint NOT NULL CHECK (rating IN (-1, 0, 1)),
    rated_at timestamptz NOT NULL DEFAULT now(), -- 현재 평가를 남긴 시각. 평가를 바꿀 때마다 갱신합니다.
    PRIMARY KEY (store_id, user_id, track_spotify_id)
);