"""Independent Decimal check of exported, explicitly unverified local model rows."""
import argparse
import json
from pathlib import Path
from decimal import Decimal
from collections import Counter

from clean_muse import LOCAL, load_configs, normalize, number, digest


def verify(root,report_name='decimal-verification.json'):
    root=root.resolve()
    if not root.is_relative_to(LOCAL.resolve()):
        raise ValueError('Only local experiment artifacts are accepted')
    if Path(report_name).name!=report_name or not report_name.endswith('.json'):
        raise ValueError('Report must be a new JSON filename inside the dataset')
    manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['result']=='PASS' and manifest['dataset_kind']=='unverified-local-experiment-v1'
    assert manifest['id_namespace']=='music_experiment.common_songs'
    assert manifest['verified'] is False and manifest['canonical_song_ids'] is False
    for name,sha in manifest['artifacts_sha256'].items():
        assert digest(root/name)==sha
    configs=load_configs(Path(__file__).resolve().parents[1]/'db/002_normalization_v1.sql')
    sets={}; checks=0; results={}
    for model in ('A','B1','B2','C1','C2'):
        ids={}; coords=[]
        with (root/(model+'.jsonl')).open(encoding='utf-8') as stream:
            for line in stream:
                row=json.loads(line)
                assert len(row)==14 and None not in row.values()
                sid=row['song_id']; spotify=row['spotify_id']
                assert sid.isdecimal() and int(sid)>0 and sid not in ids
                ids[sid]=spotify
                for axis in ('valence','arousal'):
                    metric='energy' if axis=='arousal' and model=='A' else axis
                    version=row[axis+'_normalization_version']
                    raw=number(row[axis+'_raw_value']); coordinate=number(row[axis])
                    assert -1<=coordinate<=1
                    if version=='reccobeats-v1':
                        assert 0<=raw<=1 and coordinate==2*raw-1
                    else:
                        cfg=configs[(version,metric)]
                        expected=normalize(raw,number(cfg['raw_min']),number(cfg['raw_max']))
                        assert abs(coordinate-expected)<=Decimal('1e-15')
                    checks+=1
                coords.append((number(row['valence']),number(row['arousal'])))
        assert len(ids)==len(set(ids.values()))==27948
        sets[model]=ids
        ties=Counter(coords)
        results[model]=dict(coordinates=len(ids),v_min=str(min(v for v,a in coords)),v_max=str(max(v for v,a in coords)),
            a_min=str(min(a for v,a in coords)),a_max=str(max(a for v,a in coords)),missing=0,duplicate_ids=0,
            distinct_coordinates=len(ties),duplicate_coordinate_groups=sum(n>1 for n in ties.values()),
            duplicate_coordinate_excess=sum(n-1 for n in ties.values()))
    assert all(ids==sets['A'] for ids in sets.values())
    result=dict(result='PASS',decimal_coordinate_checks=checks,identical_song_sets=True,models=results)
    with (root/report_name).open('x',encoding='utf-8') as output:
        json.dump(result,output,ensure_ascii=False,indent=2); output.write('\n')
    return dict(result='PASS',models=5,common_songs=27948,decimal_coordinate_checks=checks)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root',type=Path)
    parser.add_argument('--report-name',default='decimal-verification.json')
    args=parser.parse_args()
    print(json.dumps(verify(args.root,args.report_name)))
