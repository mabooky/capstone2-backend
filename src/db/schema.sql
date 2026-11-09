-- 서버 DB의 현재 구조입니다. 없는 테이블만 만들며, 서버는 이 파일을 실행하지 않습니다.
--
--   psql "$DATABASE_URL" -f src/db/schema.sql
--
-- 기존 테이블을 바꿀 때는 ALTER를 직접 실행하고 이 파일도 함께 고칩니다.

-- 곡. 한국 재생 불가 곡, 연주곡, 같은 곡의 여러 버전도 걸러내지 않고 저장하며
-- 서비스에 노출할 곡은 조회할 때 정합니다. 오디오 값은 ReccoBeats 응답 원본입니다.
CREATE TABLE IF NOT EXISTS tracks_v3 (
    spotify_id text PRIMARY KEY CHECK (spotify_id ~ '^[0-9A-Za-z]{22}$'),
    reccobeats_id uuid NOT NULL,
    title text NOT NULL CHECK (btrim(title) <> ''),
    artist text NOT NULL CHECK (btrim(artist) <> ''),                       -- 참여 아티스트 이름을 ', '로 이은 문자열
    artist_reccobeats_ids uuid[] NOT NULL CHECK (cardinality(artist_reccobeats_ids) > 0),  -- artist와 같은 순서
    duration_ms integer NOT NULL CHECK (duration_ms >= 0),
    popularity integer CHECK (popularity BETWEEN 0 AND 100),
    isrc text,
    kr_available boolean NOT NULL,                                          -- availableCountries에 KR 포함 여부
    acousticness double precision CHECK (acousticness BETWEEN 0 AND 1),
    danceability double precision CHECK (danceability BETWEEN 0 AND 1),
    energy double precision NOT NULL CHECK (energy BETWEEN 0 AND 1),
    instrumentalness double precision CHECK (instrumentalness BETWEEN 0 AND 1),
    liveness double precision CHECK (liveness BETWEEN 0 AND 1),
    loudness double precision,                                              -- dB
    speechiness double precision CHECK (speechiness BETWEEN 0 AND 1),
    tempo double precision CHECK (tempo >= 0),                              -- BPM
    valence double precision NOT NULL CHECK (valence BETWEEN 0 AND 1),
    musical_key smallint CHECK (musical_key BETWEEN -1 AND 11),             -- 0=C, ..., 11=B, -1=감지 실패
    musical_mode smallint CHECK (musical_mode IN (0, 1))                    -- 0=단조, 1=장조
);

CREATE INDEX IF NOT EXISTS tracks_v3_artists_idx ON tracks_v3 USING gin (artist_reccobeats_ids);
