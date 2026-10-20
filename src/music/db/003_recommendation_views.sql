BEGIN;
CREATE FUNCTION music.recommend_coordinates(
    p_valence_provider text, p_valence_version text,
    p_arousal_provider text, p_arousal_metric text, p_arousal_version text
) RETURNS TABLE (
    song_id bigint, spotify_id text, valence numeric, arousal numeric,
    valence_source_id bigint, arousal_source_id bigint,
    valence_normalization_version text, arousal_normalization_version text,
    valence_source_version text, arousal_source_version text,
    valence_raw_value numeric, arousal_raw_value numeric,
    valence_normalization_config jsonb, arousal_normalization_config jsonb
) LANGUAGE sql STABLE SET search_path = pg_catalog, music AS $$
    SELECT s.id, s.spotify_id, v.normalized_value, a.normalized_value,
           vs.id, ars.id, v.normalization_version, a.normalization_version,
           vs.source_version, ars.source_version, v.raw_value, a.raw_value,
           v.normalization_config, a.normalization_config
    FROM music.songs s
    JOIN music.song_sources vs ON vs.song_id = s.id
         AND vs.provider = p_valence_provider
         AND vs.match_status = 'verified' AND vs.is_recommendation_source
    JOIN music.emotion_scores v ON v.song_source_id = vs.id
         AND v.metric = 'valence' AND v.normalization_version = p_valence_version
    JOIN music.song_sources ars ON ars.song_id = s.id
         AND ars.provider = p_arousal_provider
         AND ars.match_status = 'verified' AND ars.is_recommendation_source
    JOIN music.emotion_scores a ON a.song_source_id = ars.id
         AND a.metric = p_arousal_metric AND a.normalization_version = p_arousal_version;
$$;

CREATE VIEW music.recommend_a AS
    SELECT * FROM music.recommend_coordinates(
        'reccobeats', 'reccobeats-v1', 'reccobeats', 'energy', 'reccobeats-v1');
CREATE VIEW music.recommend_b1 AS
    SELECT * FROM music.recommend_coordinates(
        'muse', 'muse-theoretical-v1', 'muse', 'arousal', 'muse-theoretical-v1');
CREATE VIEW music.recommend_b2 AS
    SELECT * FROM music.recommend_coordinates(
        'muse', 'muse-observed-v1', 'muse', 'arousal', 'muse-observed-v1');
CREATE VIEW music.recommend_c1 AS
    SELECT * FROM music.recommend_coordinates(
        'reccobeats', 'reccobeats-v1', 'muse', 'arousal', 'muse-theoretical-v1');
CREATE VIEW music.recommend_c2 AS
    SELECT * FROM music.recommend_coordinates(
        'reccobeats', 'reccobeats-v1', 'muse', 'arousal', 'muse-observed-v1');
COMMIT;
