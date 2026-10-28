-- Immutable, versioned configuration. Do not edit an issued version in place.
-- A changed population/bound/formula requires a NEW version and migration.
BEGIN;
CREATE FUNCTION music.normalization_config_v1(
    p_provider text, p_metric text, p_version text
) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, music AS $$
    SELECT jsonb_build_object(
        'version', c.version, 'provider', c.provider, 'metric', c.metric,
        'raw_min', c.raw_min, 'raw_max', c.raw_max,
        'source_version', c.source_version, 'source_sha256', c.source_sha256,
        'population_rows', c.population_rows, 'kind', c.kind,
        'formula', '2*(x-raw_min)/(raw_max-raw_min)-1',
        'policy_date', '2026-10-17'
    )
    FROM (VALUES
        ('reccobeats-v1', 'reccobeats', 'valence', 0::numeric, 1::numeric,
         NULL::text, NULL::text, NULL::integer, 'theoretical'),
        ('reccobeats-v1', 'reccobeats', 'energy', 0, 1, NULL, NULL, NULL, 'theoretical'),
        ('muse-theoretical-v1', 'muse', 'valence', 0, 9,
         'zenodo-4281165-v1.0.0',
         '56be88aea7dfa2c0446e0d7cc033d95c3550a3dc4364ac91c815cf998265fd2b',
         90408, 'theoretical'),
        ('muse-theoretical-v1', 'muse', 'arousal', 0, 9,
         'zenodo-4281165-v1.0.0',
         '56be88aea7dfa2c0446e0d7cc033d95c3550a3dc4364ac91c815cf998265fd2b',
         90408, 'theoretical'),
        ('muse-observed-v1', 'muse', 'valence', 0.23500000000000001, 8.475,
         'zenodo-4281165-v1.0.0',
         '56be88aea7dfa2c0446e0d7cc033d95c3550a3dc4364ac91c815cf998265fd2b',
         90408, 'observed'),
        ('muse-observed-v1', 'muse', 'arousal', 0.1081132075471698, 7.27,
         'zenodo-4281165-v1.0.0',
         '56be88aea7dfa2c0446e0d7cc033d95c3550a3dc4364ac91c815cf998265fd2b',
         90408, 'observed')
    ) AS c(version, provider, metric, raw_min, raw_max,
           source_version, source_sha256, population_rows, kind)
    WHERE (c.provider, c.metric, c.version) = (p_provider, p_metric, p_version);
$$;

CREATE FUNCTION music.prepare_emotion_score() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, music AS $$
DECLARE
    src music.song_sources%ROWTYPE;
    cfg jsonb;
BEGIN
    -- Serialize versions for this source so conflicting raw observations cannot race.
    SELECT * INTO src FROM music.song_sources WHERE id = NEW.song_source_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unknown song_source_id' USING ERRCODE = '23503';
    END IF;
    cfg := music.normalization_config_v1(src.provider, NEW.metric, NEW.normalization_version);
    IF cfg IS NULL THEN
        RAISE EXCEPTION 'unknown normalization version/provider/metric' USING ERRCODE = '23514';
    END IF;
    IF cfg->>'source_version' IS NOT NULL AND cfg->>'source_version' <> src.source_version THEN
        RAISE EXCEPTION 'normalization population differs from source version' USING ERRCODE = '23514';
    END IF;
    cfg := cfg || jsonb_build_object('source_version', src.source_version);
    IF (NEW.raw_min IS NOT NULL AND NEW.raw_min IS DISTINCT FROM (cfg->>'raw_min')::numeric)
       OR (NEW.raw_max IS NOT NULL AND NEW.raw_max IS DISTINCT FROM (cfg->>'raw_max')::numeric)
       OR (NEW.normalization_config IS NOT NULL AND NEW.normalization_config IS DISTINCT FROM cfg) THEN
        RAISE EXCEPTION 'normalization settings do not match versioned config' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM music.emotion_scores e
        WHERE e.song_source_id = NEW.song_source_id AND e.metric = NEW.metric
          AND e.raw_value IS DISTINCT FROM NEW.raw_value
    ) THEN
        RAISE EXCEPTION 'raw value differs across normalization versions' USING ERRCODE = '23514';
    END IF;
    NEW.raw_min := (cfg->>'raw_min')::numeric;
    NEW.raw_max := (cfg->>'raw_max')::numeric;
    NEW.normalization_config := cfg;
    RETURN NEW;
END;
$$;
CREATE TRIGGER emotion_scores_prepare
    BEFORE INSERT ON music.emotion_scores
    FOR EACH ROW EXECUTE FUNCTION music.prepare_emotion_score();
COMMIT;
