-- PostgreSQL 14+. New installation only: fail on existing objects, never drop them.
BEGIN;
CREATE SCHEMA music;

CREATE TABLE music.songs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    spotify_id text NOT NULL UNIQUE CHECK (spotify_id ~ '^[0-9A-Za-z]{22}$'),
    title text NOT NULL CHECK (btrim(title) <> ''),
    artist text NOT NULL CHECK (btrim(artist) <> ''),
    duration_ms integer CHECK (duration_ms >= 0),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, spotify_id)
);

CREATE TABLE music.song_sources (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Pending observations must not be attached to a canonical song yet.
    song_id bigint REFERENCES music.songs(id) ON DELETE RESTRICT,
    provider text NOT NULL CHECK (provider IN ('reccobeats', 'muse')),
    external_id text NOT NULL CHECK (btrim(external_id) <> ''),
    source_version text NOT NULL CHECK (btrim(source_version) <> ''),
    fetched_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_url text NOT NULL CHECK (btrim(source_url) <> ''),
    rights_reference text NOT NULL CHECK (btrim(rights_reference) <> ''),
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    candidate_spotify_id text CHECK (candidate_spotify_id ~ '^[0-9A-Za-z]{22}$'),
    match_status text NOT NULL DEFAULT 'pending'
        CHECK (match_status IN ('pending', 'verified', 'rejected')),
    match_evidence jsonb,
    verified_at timestamptz,
    is_recommendation_source boolean NOT NULL DEFAULT false,
    UNIQUE (provider, external_id, source_version),
    FOREIGN KEY (song_id, candidate_spotify_id)
        REFERENCES music.songs(id, spotify_id) ON DELETE RESTRICT,
    CHECK (jsonb_typeof(raw_payload) = 'object'),
    CHECK (
        (match_status = 'verified'
         AND song_id IS NOT NULL AND candidate_spotify_id IS NOT NULL
         AND verified_at IS NOT NULL AND match_evidence IS NOT NULL
         AND jsonb_typeof(match_evidence) = 'object'
         AND coalesce(btrim(match_evidence->>'method'), '') <> ''
         AND coalesce(btrim(match_evidence->>'reference'), '') <> '')
        OR (match_status <> 'verified' AND song_id IS NULL AND verified_at IS NULL)
    ),
    CHECK (NOT is_recommendation_source OR match_status = 'verified')
);
CREATE INDEX song_sources_song_id_idx ON music.song_sources(song_id);
-- Explicit selection, never implicit latest/first-row selection or averaging.
CREATE UNIQUE INDEX song_sources_one_selected_provider_idx
    ON music.song_sources(song_id, provider) WHERE is_recommendation_source;

CREATE TABLE music.emotion_scores (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    song_source_id bigint NOT NULL REFERENCES music.song_sources(id) ON DELETE RESTRICT,
    metric text NOT NULL CHECK (metric IN ('valence', 'energy', 'arousal')),
    raw_value numeric NOT NULL,
    raw_min numeric NOT NULL,
    raw_max numeric NOT NULL,
    normalized_value numeric GENERATED ALWAYS AS
        (2 * (raw_value - raw_min) / NULLIF(raw_max - raw_min, 0) - 1) STORED NOT NULL,
    normalization_version text NOT NULL CHECK (btrim(normalization_version) <> ''),
    normalization_config jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (song_source_id, metric, normalization_version),
    CHECK (raw_value > '-Infinity'::numeric AND raw_value < 'Infinity'::numeric),
    CHECK (raw_min > '-Infinity'::numeric AND raw_min < 'Infinity'::numeric),
    CHECK (raw_max > '-Infinity'::numeric AND raw_max < 'Infinity'::numeric),
    CHECK (raw_min < raw_max AND raw_value BETWEEN raw_min AND raw_max),
    CHECK (normalized_value BETWEEN -1 AND 1),
    CHECK (jsonb_typeof(normalization_config) = 'object')
);

CREATE FUNCTION music.protect_score_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, music AS $$
BEGIN
    RAISE EXCEPTION 'emotion_scores are append-only; use a new source/config version'
        USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER emotion_scores_append_only
    BEFORE UPDATE OR DELETE ON music.emotion_scores
    FOR EACH ROW EXECUTE FUNCTION music.protect_score_history();

CREATE FUNCTION music.protect_source_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, music AS $$
BEGIN
    IF (NEW.provider, NEW.external_id, NEW.source_version, NEW.raw_payload)
       IS DISTINCT FROM (OLD.provider, OLD.external_id, OLD.source_version, OLD.raw_payload) THEN
        RAISE EXCEPTION 'source identity/payload is immutable; append a new source version'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER song_sources_identity_immutable
    BEFORE UPDATE ON music.song_sources
    FOR EACH ROW EXECUTE FUNCTION music.protect_source_identity();
COMMIT;
