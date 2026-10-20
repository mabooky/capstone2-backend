"""Independent audit of saved rankings, overlaps and summaries; never opens a DB."""
import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import mean
from clean_muse import LOCAL, digest


def verify(root):
    root=root.resolve()
    assert root.is_relative_to(LOCAL.resolve())
    read=lambda name: json.loads((root/name).read_text(encoding='utf-8'))
    lines=lambda name: [json.loads(line) for line in (root/name).read_text(encoding='utf-8').splitlines() if line]
    result=read('result.json'); protocol=read('protocol.json')
    assert result['result']=='PASS' and result['common_songs']==27948
    searches=lines('searches.jsonl'); ranks=lines('rankings.jsonl'); pairs=lines('overlaps.jsonl')
    assert len(searches)==250 and len(pairs)==500
    grouped=defaultdict(list)
    for r in ranks:
        grouped[(r['scenario'],r['target_id'],r['model'])].append(r)
    search_keys=set()
    for s in searches:
        key=(s['scenario'],s['target']['id'],s['model']); assert key not in search_keys; search_keys.add(key)
        rows=grouped[key]
        assert len(rows)==s['returned'] and s['shortfall']==20-len(rows)
        assert len(set(r['song_id'] for r in rows))==len(rows)
        assert [r['rank'] for r in rows]==list(range(1,len(rows)+1))
        max_radius=next(x['maxRadius'] for x in protocol['scenarios'] if x['id']==s['scenario'])
        for r in rows:
            d2=(r['valence']-s['target']['valence'])**2+(r['arousal']-s['target']['arousal'])**2
            assert math.isclose(r['distance_squared'],d2,abs_tol=1e-12)
            assert math.isclose(r['distance'],math.sqrt(d2),abs_tol=1e-12)
            assert r['distance']<=max_radius and -1<=r['valence']<=1 and -1<=r['arousal']<=1
        assert rows==sorted(rows,key=lambda r:(r['distance_squared'],r['spotify_id']))
        assert s['expansions']==len(s['steps'])-1
        if not rows:
            assert s['distance']['mean'] is None
            assert s['coordinates']['iqr_fences']==dict(valence=[None,None],arousal=[None,None])
    assert len(search_keys)==250
    for p in pairs:
        left=grouped[(p['scenario'],p['target_id'],p['left'])]; right=grouped[(p['scenario'],p['target_id'],p['right'])]
        l={r['song_id']:r['rank'] for r in left}; r={r['song_id']:r['rank'] for r in right}
        common=set(l)&set(r); union=set(l)|set(r)
        assert p['intersection']==len(common) and p['overlap_at_k']==len(common)/20
        assert p['jaccard']==(len(common)/len(union) if union else None)
        assert p['top1_agreement']==(left[0]['song_id']==right[0]['song_id'] if left and right else None)
        expected=mean(abs(l[i]-r[i]) for i in common) if common else None
        assert p['mean_shared_rank_gap']==expected
    for scenario,summary in result['summary'].items():
        for model,m in summary['models'].items():
            cases=[s for s in searches if s['scenario']==scenario and s['model']==model]
            selected=[r for s in cases for r in grouped[(scenario,s['target']['id'],model)]]
            assert len(cases)==25 and len(selected)==m['total_recommendations']
            assert sum(s['shortfall']>0 for s in cases)==m['shortage_cases']
            assert all(s['target']['region']=='boundary' for s in cases if s['shortfall']>0)
            assert math.isclose(mean(r['distance'] for r in selected),m['distance']['mean'],abs_tol=1e-12)
            assert sum(m['coordinates']['quadrants'].values())==len(selected)
            if scenario=='coverage-control': assert m['shortage_cases']==0 and len(selected)==500
        for pair,m in summary['pairs'].items():
            observed=[p for p in pairs if p['scenario']==scenario and p['left']+'-'+p['right']==pair]
            assert len(observed)==25 and math.isclose(mean(p['overlap_at_k'] for p in observed),m['mean_overlap_at_k'],abs_tol=1e-12)
    output=dict(result='PASS',model_searches=250,ranking_rows=len(ranks),pair_comparisons=500,
        distance_order_overlap_summary_checks=True,empty_statistics_are_null=True,
        all_capped_shortages_on_boundary=True,all_shortages_recovered_by_coverage_control=True,
        artifact_sha256={n:digest(root/n) for n in ['protocol.json','result.json','rankings.jsonl','searches.jsonl','overlaps.jsonl','REPORT.md']})
    with (root/'verification.json').open('x',encoding='utf-8') as stream:
        json.dump(output,stream,indent=2); stream.write('\n')
    return {k:v for k,v in output.items() if k!='artifact_sha256'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('root',type=Path)
    print(json.dumps(verify(parser.parse_args().root)))
