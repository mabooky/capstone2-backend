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
