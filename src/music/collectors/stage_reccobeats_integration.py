"""Offline, append-only staging for an explicitly authorized isolated local integration."""
import argparse
import json
import socket
import subprocess
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from clean_muse import LOCAL
from reccobeats_full import LIVE_ROOT
from reccobeats_probe import memory_records
from verify_reccobeats_multifeature import readonly, digest


def stage(output):
    output = output.resolve()
    if not output.is_relative_to(LOCAL.resolve()) or output.exists():
        raise ValueError('Output must be a NEW directory under music/.local')
    evidence = LOCAL/'reccobeats-final-verification-20261020-v2/verification.json'
    audit = json.loads(evidence.read_text(encoding='utf-8'))
    assert audit['result']=='PASS' and all(audit['checks'].values())
    assert audit['coordinate_pairs']==27948
    protected = audit['protected_sha256']
    assert all(digest(LOCAL/name)==sha for name,sha in protected.items()), 'Source drift since final audit'
    checkpoint = LIVE_ROOT/'fixed-60741-v1/checkpoint.sqlite'
    db = readonly(checkpoint)
    try:
        rows = db.execute('SELECT f.*,c.uuid,c.metadata_outcome,c.feature_outcome,c.collision,c.conflict,c.refs,c.comparisons '
                          'FROM research_features f JOIN candidates c USING(sid) ORDER BY f.sid').fetchall()
    finally:
        db.close()
    assert len(rows)==27948
    output.mkdir(parents=True,exist_ok=False)
    with (output/'song_sources.jsonl').open('x',encoding='utf-8',newline='\n') as sources, \
         (output/'emotion_scores.jsonl').open('x',encoding='utf-8',newline='\n') as scores:
        for r in rows:
            comparisons=json.loads(r['comparisons'])
            assert r['metadata_outcome']=='matched_href' and r['feature_outcome']=='both_available'
            assert not r['collision'] and json.loads(r['conflict']) is None
            assert sorted(c['external_id'] for c in comparisons)==json.loads(r['refs'])
            assert all(c['title_match'] and c['artist_match'] and c['decision']=='hold' for c in comparisons)
            # Reconstruct only the already-confirmed identity envelope. No original API JSON is claimed.
            source, entries=memory_records({'id':r['uuid']},{'spotify_id':r['sid']},
                dict(id=r['uuid'],href='https://open.spotify.com/track/'+r['sid'],
                     valence=Decimal(r['valence']),energy=Decimal(r['energy'])),r['observed_at'])
            source['rights_reference']='user-authorized-isolated-local-integration; provider_storage_permission_unconfirmed; no_shared_or_operational_use'
            source['raw_payload']=dict(checkpoint_observation=True,original_api_response_retained=False,
                valence=r['valence'],energy=r['energy'],observed_at=r['observed_at'],
                checkpoint_sha256=digest_cache(protected,checkpoint),muse_external_ids=json.loads(r['refs']))
            assert len(entries)==2
            for entry in entries:
                metric=entry['insert_values']['metric']
                norm=r['normalized_valence' if metric=='valence' else 'normalized_arousal']
                assert Decimal(entry['preview']['normalized_value'])==Decimal(norm)
                assert entry['insert_values']['raw_value']==r[metric]
            sources.write(json.dumps(source,ensure_ascii=False)+'\n')
            for entry in entries:
                scores.write(json.dumps(entry,ensure_ascii=False)+'\n')
    assert all(digest(LOCAL/name)==sha for name,sha in protected.items()), 'Protected source changed'
    result=dict(result='PASS',version='integrated-staging-v1',sources=len(rows),scores=2*len(rows),
        source_checkpoint=str(checkpoint.relative_to(LOCAL)),checkpoint_sha256=digest_cache(protected,checkpoint),
        verification_sha256=digest(evidence),protected_sha256=protected,
        artifacts_sha256={n:digest(output/n) for n in ('song_sources.jsonl','emotion_scores.jsonl')},
        external_api_calls=0,real_verified_sources=0)
    (output/'manifest.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    return dict(result='PASS',sources=len(rows),scores=2*len(rows),output=str(output))


def digest_cache(protected,path):
    return protected[str(path.relative_to(LOCAL))]


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,required=True)
    args=parser.parse_args()
    with patch.object(socket,'socket',side_effect=AssertionError('Network forbidden')), \
         patch.object(subprocess,'Popen',side_effect=AssertionError('External process forbidden')):
        print(json.dumps(stage(args.output_dir),ensure_ascii=False))
