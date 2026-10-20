"""Actual common-song coordinates only; stdlib statistics and native PNG rendering payload."""
import argparse
import json
import math
import statistics
from decimal import Decimal
from pathlib import Path

from clean_muse import LOCAL, digest

MODELS=('A','B1','B2','C1','C2')
N=27948
BINS=80


def main(output):
    output=output.resolve()
    if not output.is_relative_to(LOCAL.resolve()) or output.exists():
        raise ValueError('Use a NEW directory under music/.local')
    dataset=LOCAL/'music-experiment-20261020-v3'
    comparison=LOCAL/'music-model-comparison-20261020-v1'
    manifest=json.loads((dataset/'manifest.json').read_text(encoding='utf-8'))
    previous=json.loads((comparison/'result.json').read_text(encoding='utf-8'))
    protocol=json.loads((comparison/'protocol.json').read_text(encoding='utf-8'))
    audit=json.loads((comparison/'verification.json').read_text(encoding='utf-8'))
    assert manifest['result']==previous['result']==audit['result']=='PASS'
    assert manifest['verified'] is False and manifest['common_songs']==previous['common_songs']==N
    protected={p:digest(p) for p in [dataset/'manifest.json',comparison/'result.json',comparison/'protocol.json',
        comparison/'searches.jsonl',comparison/'rankings.jsonl',comparison/'verification.json',
        *[dataset/(m+'.jsonl') for m in MODELS]]}
    for m in MODELS:
        assert protected[dataset/(m+'.jsonl')]==manifest['artifacts_sha256'][m+'.jsonl']==previous['input_sha256'][m]
    for name,sha in audit['artifact_sha256'].items():
        assert digest(comparison/name)==sha
    searches={}
    for line in (comparison/'searches.jsonl').read_text(encoding='utf-8').splitlines():
        r=json.loads(line)
        if r['scenario']=='cap-0.4': searches[(r['model'],r['target']['id'])]=r
    kth={}
    for line in (comparison/'rankings.jsonl').read_text(encoding='utf-8').splitlines():
        r=json.loads(line)
        if r['scenario']=='coverage-control' and r['rank']==20: kth[(r['model'],r['target_id'])]=r['distance']
    models={};stats={};density={};identity=None;max_bin=0
    for model in MODELS:
        points=[];ids={};quads={q:0 for q in ('--','-+','+-','++')};near={'.05':0,'.1':0}
        counts=[[0]*BINS for _ in range(BINS)]
        with (dataset/(model+'.jsonl')).open(encoding='utf-8') as stream:
            for line in stream:
                row=json.loads(line);sid=row['spotify_id']
                assert sid not in ids;ids[sid]=row['song_id']
                v,a=Decimal(row['valence']),Decimal(row['arousal'])
                assert v.is_finite() and a.is_finite() and -1<=v<=1 and -1<=a<=1
                quads[('-' if v<0 else '+')+('-' if a<0 else '+')]+=1
                for radius in near:
                    near[radius]+=v*v+a*a<=Decimal(radius)**2
                x,y=float(v),float(a);points.append([x,y])
                ix=min(BINS-1,int((v+1)*BINS/2));iy=min(BINS-1,int((a+1)*BINS/2))
                counts[iy][ix]+=1
        assert len(points)==len(ids)==N and sum(map(sum,counts))==N
        if identity is None: identity=ids
        else: assert identity==ids
        x=[p[0] for p in points];y=[p[1] for p in points]
        xstats=dict(mean=statistics.mean(x),stddev=statistics.pstdev(x),min=min(x),max=max(x))
        ystats=dict(mean=statistics.mean(y),stddev=statistics.pstdev(y),min=min(y),max=max(y))
        for axis,values in [('valence',xstats),('arousal',ystats)]:
            reference=previous['candidate_distributions'][model][axis]
            assert abs(values['mean']-reference['mean'])<1e-12
            assert abs(values['stddev']-reference['stddev'])<1e-12
        peak=max(max(row) for row in counts);max_bin=max(max_bin,peak)
        occupied=sum(n>0 for row in counts for n in row)
        peak_iy,peak_ix=next((iy,ix) for iy,row in enumerate(counts) for ix,n in enumerate(row) if n==peak)
        summary=dict(n=N,valence=xstats,arousal=ystats,pearson_v_a=statistics.correlation(x,y),
            quadrants={q:dict(count=n,percent=100*n/N) for q,n in quads.items()},
            near_origin={r:dict(radius=float(r),count=n,percent=100*n/N) for r,n in near.items()},
            histogram=dict(bins=BINS,bin_width=2/BINS,occupied_bins=occupied,empty_bins=BINS*BINS-occupied,
                empty_bin_percent=100*(1-occupied/(BINS*BINS)),max_bin_count=peak,
                peak_cell=dict(v_min=-1+peak_ix*2/BINS,v_max=-1+(peak_ix+1)*2/BINS,
                    a_min=-1+peak_iy*2/BINS,a_max=-1+(peak_iy+1)*2/BINS)))
        cells=[]
        for t in protocol['targets']:
            distances=[(px-t['valence'])**2+(py-t['arousal'])**2 for px,py in points]
            n05=sum(math.sqrt(d)<=.05 for d in distances);n04=sum(math.sqrt(d)<=.4 for d in distances)
            old=searches[(model,t['id'])]
            assert n05==old['steps'][0]['cumulativeCount']
            assert old['returned']==min(20,n04)
            if old['shortfall']>0: assert old['target']['region']=='boundary'
            cells.append(dict(target=t,neighbors_r005=n05,neighbors_r04=n04,
                shortage_at_r04=n04<20,k20_distance=kth[(model,t['id'])],expansions_at_r04=old['expansions']))
        density[model]=dict(targets=cells,zero_neighbor_r04_targets=sum(r['neighbors_r04']==0 for r in cells),
            fewer_than_20_r04_targets=sum(r['shortage_at_r04'] for r in cells),
            mean_k20_distance=statistics.mean(r['k20_distance'] for r in cells),
            previous_full_coverage=previous['summary']['coverage-control']['models'][model],
            previous_capped=previous['summary']['cap-0.4']['models'][model])
        models[model]=dict(points=points,heatmap=counts,summary=summary);stats[model]=summary
    output.mkdir(parents=True,exist_ok=False)
    dump=lambda name,data:(output/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    dump('plot_payload.json',dict(models=models,n=N,bins=BINS,max_bin_count=max_bin,
        histogram_scale='log1p count; one global maximum for every model; zero cells use separate light gray',
        origin_radius=.1,axis_limits=[-1,1],scatter_alpha=28/255,point_sampling=False,jitter=False))
    dump('statistics.json',dict(models=stats,standard_deviation='population (ddof=0)',
        near_origin='Euclidean normalized coordinate radius <= 0.1 (also report <=0.05)',
        quadrant_axis_policy='Zero belongs to positive side',same_spotify_id_mapping=True))
    dump('density_vs_recommendation.json',density)
    dump('input-verification.json',dict(result='PASS',common_songs=N,models=5,rows=5*N,
        same_spotify_ids=True,same_experiment_id_mapping=True,missing=0,outside_range=0,
        histogram_conservation=True,previous_125_target_density_counts_matched=True,
        protected_sha256={str(p):sha for p,sha in protected.items()},
        input_source=str(dataset),comparison_source=str(comparison)))
    lines=['# 실제 공통곡 27,948개의 5모델 좌표 분포','',
        '전 곡을 사용한 산점도 및 80×80 2D count histogram이다. 모든 축은 [-1,1]·정사각형이다. 원점 근처는 유클리드 반경 ≤0.1, 표준편차는 모집단 기준이다. 축의 0은 양수 사분면에 포함한다. 점은 샘플링/지터/평활화 없이 실제 좌표 그대로다.',
        '', '| 모델 | 평균 V / A | 표준편차 V / A | 원점 r≤0.1 | 빈 bin 비율 | 최대 bin 곡 수 |',
        '|---|---|---|---:|---:|---:|']
    for m,s in stats.items():
        lines.append(f"| {m} | {s['valence']['mean']:.4f} / {s['arousal']['mean']:.4f} | {s['valence']['stddev']:.4f} / {s['arousal']['stddev']:.4f} | {s['near_origin']['.1']['percent']:.2f}% | {s['histogram']['empty_bin_percent']:.2f}% | {s['histogram']['max_bin_count']} |")
    lines+=['','| 모델 | -- 곡 수 / 비율 | -+ 곡 수 / 비율 | +- 곡 수 / 비율 | ++ 곡 수 / 비율 |',
        '|---|---|---|---|---|']
    for m,s in stats.items():
        lines.append('| '+m+' | '+' | '.join(f"{s['quadrants'][q]['count']:,} / {s['quadrants'][q]['percent']:.2f}%" for q in quads)+' |')
    lines+=['','## 추천 비교와의 연결','',
        '이전 25개 목표에서 각 모델 전체 좌표를 다시 세어 반경 0.05/0.4의 이웃 수와 실제 반환량을 검증했다. 목표를 새로운 음악 데이터로 추가하지 않았다. 기하학적 밀도와 거리의 관계이며 청취 품질/감정 정확도의 검증이 아니다.',
        '', '| 모델 | r=0.4에서 20곡 미만 목표 | 이웃 0인 목표 | 전체 범위 평균 거리 | 평균 확대 |',
        '|---|---:|---:|---:|---:|']
    for m,d in density.items():
        c=d['previous_full_coverage'];lines.append(f"| {m} | {d['fewer_than_20_r04_targets']} | {d['zero_neighbor_r04_targets']} | {c['distance']['mean']:.4f} | {c['mean_expansions']:.2f} |")
    lines+=['',
        '- A는 ReccoBeats V/E, B1/B2는 동일 MuSe V/A의 이론/관측 정규화, C1/C2는 ReccoBeats V와 해당 MuSe A를 조합한다. B1→B2 또는 C1→C2 차이는 동일 raw 점수의 고정 정규화 차이다.',
        '- 0.4 이내에 20곡이 없는 목표는 모두 경계였다. 전체 범위에서는 모두 20곡을 찾았으므로 후보 전체 부족이 아니라 목표 주변의 빈/희박 영역이 제한 반경 추천 부족과 더 긴 거리/확대로 연결된다.',
        '- 히트맵은 0.025×0.025 구간의 곡 수를 동일한 전역 log1p 색상축으로 표시한다. 빈 구간 비율은 이 구간 크기에 따른 기술 통계이며 연속 공간의 확정적 공백/오류 판정이 아니다. 가까운 좌표 동률도 삭제하지 않는다.',
        '- 25개 목표 중 경계가 16개인 인위적 격자다. 이 그림/수치만으로 실제 감정 정확도나 음악 선호 우위를 주장하지 않는다. Energy와 MuSe Arousal의 출처 차이도 유지한다.',
        '- 실제 source는 미검증 실험 데이터이며 verified 전환, DB/추천 알고리즘 수정, 외부 API 호출을 하지 않았다. Python 표준 라이브러리와 기존 Windows System.Drawing만 사용한다.',
        '', '## 파일', '',
        '`comparison_all.png`: 상단 산점도 5개, 하단 공통 색상축의 밀도 5개. `scatter_{A,B1,B2,C1,C2}.png`, `density_{A,B1,B2,C1,C2}.png`: 개별 고해상도 PNG. `statistics.json`: 정밀 통계, `density_vs_recommendation.json`: 125개 목표/모델 이웃 수와 추천 비교 근거.']
    (output/'REPORT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    assert all(digest(p)==sha for p,sha in protected.items())
    print(json.dumps(dict(result='PASS',models=5,points_per_model=N,max_shared_bin_count=max_bin,output=str(output))))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output-dir',type=Path,required=True)
    main(parser.parse_args().output_dir)
