-- Apply ONLY to a new local experiment snapshot, never to the service database.
BEGIN;
CREATE SCHEMA music_experiment;
CREATE TABLE music_experiment.common_songs (
    experiment_song_id bigint PRIMARY KEY CHECK (experiment_song_id>0),
    spotify_id text NOT NULL UNIQUE CHECK (spotify_id ~ '^[0-9A-Za-z]{22}$'),
    muse_source_id bigint NOT NULL UNIQUE REFERENCES music.song_sources(id),
    reccobeats_source_id bigint NOT NULL UNIQUE REFERENCES music.song_sources(id),
    CHECK (muse_source_id<>reccobeats_source_id)
);
COMMENT ON TABLE music_experiment.common_songs IS
    'Unverified local experiment mapping. IDs are not music.songs IDs. No canonical merge or promotion.';

-- The runner inserts a deterministic, singleton-only source mapping in one transaction,
-- then verifies all six source scores and all five complete model projections.

CREATE FUNCTION music_experiment.coordinates(
    vp text,vv text,ap text,am text,av text
) RETURNS TABLE (
    song_id bigint,spotify_id text,valence numeric,arousal numeric,
    valence_source_id bigint,arousal_source_id bigint,
    valence_normalization_version text,arousal_normalization_version text,
    valence_source_version text,arousal_source_version text,
    valence_raw_value numeric,arousal_raw_value numeric,
    valence_normalization_config jsonb,arousal_normalization_config jsonb
) LANGUAGE sql STABLE SET search_path=pg_catalog,music_experiment,music AS $$
    SELECT c.experiment_song_id,c.spotify_id,v.normalized_value,a.normalized_value,vs.id,ars.id,
        v.normalization_version,a.normalization_version,vs.source_version,ars.source_version,
        v.raw_value,a.raw_value,v.normalization_config,a.normalization_config
    FROM music_experiment.common_songs c
    JOIN music.song_sources vs ON vs.id=CASE vp WHEN 'muse' THEN c.muse_source_id
        WHEN 'reccobeats' THEN c.reccobeats_source_id END AND vs.provider=vp
    JOIN music.song_sources ars ON ars.id=CASE ap WHEN 'muse' THEN c.muse_source_id
        WHEN 'reccobeats' THEN c.reccobeats_source_id END AND ars.provider=ap
    JOIN music.emotion_scores v ON v.song_source_id=vs.id AND v.metric='valence' AND v.normalization_version=vv
    JOIN music.emotion_scores a ON a.song_source_id=ars.id AND a.metric=am AND a.normalization_version=av;
$$;
CREATE VIEW music_experiment.model_a AS SELECT * FROM music_experiment.coordinates(
    'reccobeats','reccobeats-v1','reccobeats','energy','reccobeats-v1');
CREATE VIEW music_experiment.model_b1 AS SELECT * FROM music_experiment.coordinates(
    'muse','muse-theoretical-v1','muse','arousal','muse-theoretical-v1');
CREATE VIEW music_experiment.model_b2 AS SELECT * FROM music_experiment.coordinates(
    'muse','muse-observed-v1','muse','arousal','muse-observed-v1');
CREATE VIEW music_experiment.model_c1 AS SELECT * FROM music_experiment.coordinates(
    'reccobeats','reccobeats-v1','muse','arousal','muse-theoretical-v1');
CREATE VIEW music_experiment.model_c2 AS SELECT * FROM music_experiment.coordinates(
    'reccobeats','reccobeats-v1','muse','arousal','muse-observed-v1');
COMMIT;
