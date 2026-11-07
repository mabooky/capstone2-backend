-- 곡 카탈로그 v3 테이블 정의입니다. 데이터는 포함하지 않으며, 여러 번 실행해도 안전합니다.
-- 적재 스크립트(load-tracks.mjs)가 트랜잭션 안에서 이 파일을 먼저 실행합니다.
--
-- v2(songs → tracks_v2)와 달리 한국(KR)에서 재생할 수 없다고 표시된 곡도 걸러내지 않고 kr_available로 표시만 해 둡니다.
-- 연주곡·MR이나 같은 곡의 여러 버전도 합치거나 걸러내지 않고 모두 올려 둡니다. 서비스에 무엇을 보여줄지는 조회할 때 정합니다.
--
-- 오디오 값은 ReccoBeats 응답 값을 변환하지 않고 그대로 저장합니다. (좌표계로 바꾸는 일은 조회할 때 합니다.)
-- 열 순서는 테이블을 만들 때 정해져서 나중에 바꿀 수 없습니다. 순서를 바꾸려면 테이블을 지우고 다시 만들어야 합니다.

CREATE TABLE IF NOT EXISTS tracks_v3 (
    spotify_id text PRIMARY KEY CHECK (spotify_id ~ '^[0-9A-Za-z]{22}$'),
    reccobeats_id uuid NOT NULL,
    title text NOT NULL CHECK (btrim(title) <> ''),
    artist text NOT NULL CHECK (btrim(artist) <> ''),                      -- 곡에 참여한 아티스트 이름을 ', '로 이은 문자열
    artist_reccobeats_ids uuid[] NOT NULL CHECK (cardinality(artist_reccobeats_ids) > 0),  -- 곡에 참여한 모든 아티스트의 ReccoBeats ID (artist의 이름과 같은 순서)
    duration_ms integer NOT NULL CHECK (duration_ms >= 0),
    popularity integer CHECK (popularity BETWEEN 0 AND 100),                -- ReccoBeats의 전 세계 기준 인기도
    isrc text,
    kr_available boolean NOT NULL,                                          -- availableCountries에 KR이 있는지
    acousticness double precision CHECK (acousticness BETWEEN 0 AND 1),
    danceability double precision CHECK (danceability BETWEEN 0 AND 1),
    energy double precision NOT NULL CHECK (energy BETWEEN 0 AND 1),
    instrumentalness double precision CHECK (instrumentalness BETWEEN 0 AND 1),
    liveness double precision CHECK (liveness BETWEEN 0 AND 1),
    loudness double precision,                                              -- dB
    speechiness double precision CHECK (speechiness BETWEEN 0 AND 1),
    tempo double precision CHECK (tempo >= 0),                              -- BPM
    valence double precision NOT NULL CHECK (valence BETWEEN 0 AND 1),
    musical_key smallint CHECK (musical_key BETWEEN -1 AND 11),            -- 0=C … 11=B, -1=감지 못함
    musical_mode smallint CHECK (musical_mode IN (0, 1))                   -- 0=단조, 1=장조
);

CREATE INDEX IF NOT EXISTS tracks_v3_artists_idx ON tracks_v3 USING gin (artist_reccobeats_ids);
