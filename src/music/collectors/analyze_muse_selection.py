"""Finite-population selection audit; real source observations only, no DB/API writes."""
import argparse
import csv
import json
import math
from collections import Counter,defaultdict
from pathlib import Path

from clean_muse import LOCAL,SOURCE_DIR,load_configs,number,normalize,digest
from matching_audit import candidate_id,duplicate_group
from verify_reccobeats_multifeature import readonly

VERSIONS=('theoretical','observed')
QUADS=('--','-+','+-','++')
PROBS=(.01,.05,.25,.5,.75,.95,.99)


def moments(values,weights):
    mass=math.fsum(weights)
    avg=math.fsum(v*w for v,w in zip(values,weights))/mass
    sd=math.sqrt(math.fsum(w*(v-avg)**2 for v,w in zip(values,weights))/mass)
    quantiles={};pairs=sorted(zip(values,weights));j=0;cumulative=0.0
    for value,weight in pairs:
        cumulative+=weight
        while j<len(PROBS) and cumulative+1e-9>=PROBS[j]*mass:
            quantiles[f'p{int(PROBS[j]*100):02d}']=value;j+=1
    assert len(quantiles)==len(PROBS)
    return dict(mean=avg,stddev=sd,median=quantiles['p50'],min=pairs[0][0],max=pairs[-1][0],quantiles=quantiles)


def marginal_distance(left,lw,right,rw):
    masses=[math.fsum(lw),math.fsum(rw)]
    support=defaultdict(lambda:[0.0,0.0])
    for side,values,weights in [(0,left,lw),(1,right,rw)]:
        for value,weight in zip(values,weights): support[value][side]+=weight/masses[side]
    l=r=ks=w1=0.0;previous=None
    for value,(dl,dr) in sorted(support.items()):
        if previous is not None: w1+=abs(l-r)*(value-previous)
        l+=dl;r+=dr;ks=max(ks,abs(l-r));previous=value
    return dict(ks_distance=ks,wasserstein_1=w1)


def histogram(points,weights,bins):
    counts=[[0.0]*bins for _ in range(bins)]
    for (v,a),w in zip(points,weights):
        assert -1<=v<=1 and -1<=a<=1
        ix=min(bins-1,int((v+1)*bins/2));iy=min(bins-1,int((a+1)*bins/2))
        counts[iy][ix]+=w
    mass=math.fsum(weights)
    assert math.isclose(math.fsum(map(math.fsum,counts)),mass,abs_tol=1e-7)
    return [[100*n/mass for n in row] for row in counts]


def hist_distance(left,right):
    p=[v/100 for row in left for v in row];q=[v/100 for row in right for v in row]
    tv=.5*math.fsum(abs(a-b) for a,b in zip(p,q));l2=math.fsum((a-b)**2 for a,b in zip(p,q))
    js=.5*math.fsum((a*math.log2(2*a/(a+b)) if a else 0)+(b*math.log2(2*b/(a+b)) if b else 0) for a,b in zip(p,q) if a+b)
    return dict(total_variation=tv,jensen_shannon_bits=js,squared_l2=l2,
        reference_mass_in_target_empty_cells=math.fsum(a for a,b in zip(p,q) if not b))


def quad(point): return ('-' if point[0]<0 else '+')+('-' if point[1]<0 else '+')


def analyze(output):
    output=output.resolve()
    if not output.is_relative_to(LOCAL.resolve()) or output.exists(): raise ValueError('Use a NEW analysis directory under music/.local')
    source=SOURCE_DIR/'muse_dataset.csv';checkpoint=LOCAL/'reccobeats-full-v1/fixed-60741-v1/checkpoint.sqlite'
    experiment=LOCAL/'music-experiment-20261020-v3';comparison=LOCAL/'music-model-comparison-20261020-v1'
    config_file=Path(__file__).resolve().parents[1]/'db/002_normalization_v1.sql'
    files=[source,checkpoint,config_file,experiment/'manifest.json',experiment/'common-songs.jsonl',
        experiment/'B1.jsonl',experiment/'B2.jsonl',comparison/'result.json',comparison/'protocol.json',comparison/'searches.jsonl']
    before={str(p):digest(p) for p in files}
    configs=load_configs(config_file)
    assert all(c['source_sha256']==before[str(source)] and c['population_rows']==90408 for c in configs.values())
    manifest=json.loads((experiment/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['result']=='PASS' and manifest['verified'] is False
    for name in ['common-songs.jsonl','B1.jsonl','B2.jsonl']: assert digest(experiment/name)==manifest['artifacts_sha256'][name]
    with source.open(encoding='utf-8-sig',newline='') as stream: rows=list(csv.DictReader(stream))
    assert len(rows)==90408 and len({r['id'] for r in rows})==90408
    groups=defaultdict(list);missing=[];records=[]
    for i,row in enumerate(rows):
        sid=candidate_id(row['spotify_id'])
        if sid: groups[sid].append(i)
        else: missing.append(i)
        raw=tuple(number(row[k+'_tags']) for k in ('valence','arousal'))
        coords={v:tuple(float(normalize(x,number(configs[('muse-'+v+'-v1',axis)]['raw_min']),
            number(configs[('muse-'+v+'-v1',axis)]['raw_max']))) for axis,x in zip(('valence','arousal'),raw)) for v in VERSIONS}
        records.append(dict(raw=tuple(map(float,raw)),**coords))
    assert len(groups)==60741 and len(missing)==28506 and sum(map(len,groups.values()))==61902
    duplicates={sid:indices for sid,indices in groups.items() if len(indices)>1}
    singles={sid:indices[0] for sid,indices in groups.items() if len(indices)==1}
    assert len(duplicates)==1063 and sum(map(len,duplicates.values()))==2224 and len(singles)==59678
    db=readonly(checkpoint)
    try:
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        candidates={r['sid']:dict(r) for r in db.execute('SELECT * FROM candidates')}
    finally: db.close()
    assert set(candidates)==set(groups)
    for sid,c in candidates.items(): assert json.loads(c['refs'])==sorted(rows[i]['id'] for i in groups[sid])
    common={json.loads(line)['spotify_id'] for line in (experiment/'common-songs.jsonl').read_text(encoding='utf-8').splitlines()}
    assert len(common)==27948 and common=={sid for sid,c in candidates.items() if c['feature_outcome']=='both_available'}
    assert common<=set(singles)
    href={sid for sid,c in candidates.items() if c['metadata_outcome']=='matched_href'}
    strict={sid for sid,c in candidates.items() if (cs:=json.loads(c['comparisons'] or '[]')) and all(x['title_match'] and x['artist_match'] for x in cs)}
    assert len(href)==37808 and len(strict)==27953
    for version,model in [('theoretical','B1'),('observed','B2')]:
        with (experiment/(model+'.jsonl')).open(encoding='utf-8') as stream:
            for line in stream:
                r=json.loads(line);idx=singles[r['spotify_id']]
                for axis,value in enumerate(('valence','arousal')):
                    assert number(r[value+'_raw_value'])==number(rows[idx][value+'_tags'])
                    assert abs(float(r[value])-records[idx][version][axis])<1e-15
    id_indices=[i for indices in groups.values() for i in indices]
    duplicate_indices=[i for indices in duplicates.values() for i in indices]
    frames={
        'all_rows':(list(range(len(rows))),None,'row'),
        'id_rows':(id_indices,None,'row'),
        'id_balanced':(id_indices,[1/len(groups[candidate_id(rows[i]['spotify_id'])]) for i in id_indices],'ID-balanced source-observation sensitivity'),
        'common':([singles[sid] for sid in sorted(common)],None,'unambiguous unique Spotify ID'),
        'missing_id':(missing,None,'row'),
        'duplicate_rows':(duplicate_indices,None,'duplicate source row'),
        'singletons':(list(singles.values()),None,'unambiguous unique Spotify ID'),
        'href_singletons':([singles[s] for s in sorted(href&singles.keys())],None,'unambiguous unique Spotify ID'),
        'strict_singletons':([singles[s] for s in sorted(strict&singles.keys())],None,'unambiguous unique Spotify ID'),
        'not_returned_singletons':([i for s,i in singles.items() if s not in href],None,'unambiguous unique Spotify ID'),
        'held_metadata_singletons':([i for s,i in singles.items() if s in href and s not in strict],None,'unambiguous unique Spotify ID'),
        'feature_missing':([i for s,i in singles.items() if s in strict and s not in common],None,'unambiguous unique Spotify ID'),
        'href_rows':([i for s in sorted(href) for i in groups[s]],None,'row'),
        'strict_rows':([i for s in sorted(strict) for i in groups[s]],None,'row')}
    expected={'all_rows':90408,'id_rows':61902,'common':27948,'missing_id':28506,'duplicate_rows':2224,
        'singletons':59678,'href_singletons':37171,'strict_singletons':27949,'not_returned_singletons':22507,
        'held_metadata_singletons':9222,'feature_missing':1}
    for key,n in expected.items(): assert len(frames[key][0])==n
    assert sum(expected[k] for k in ['missing_id','duplicate_rows','not_returned_singletons','held_metadata_singletons','feature_missing','common'])==90408
    summaries={};points_by_frame={};weights_by_frame={};histograms={};payload={}
    plot_main=('all_rows','id_rows','id_balanced','common')
    plot_stages=('missing_id','duplicate_rows','singletons','href_singletons','strict_singletons','common')
    for key,(indices,weights,unit) in frames.items():
        weights=weights or [1.0]*len(indices);weights_by_frame[key]=weights;mass=math.fsum(weights)
        summaries[key]=dict(observations=len(indices),unit=unit,total_weight=mass,
            unique_spotify_ids=len({candidate_id(rows[i]['spotify_id']) for i in indices}-{None}),distributions={})
        points_by_frame[key]={version:[records[i][version] for i in indices] for version in ('raw',*VERSIONS)}
        for version,points in points_by_frame[key].items():
            qs={q:0.0 for q in QUADS}
            if version!='raw':
                for p,w in zip(points,weights): qs[quad(p)]+=w
            summary={axis:moments([p[j] for p in points],weights) for j,axis in enumerate(('valence','arousal'))}
            if version!='raw': summary['quadrants']={q:dict(mass=n,percent=100*n/mass) for q,n in qs.items()}
            summaries[key]['distributions'][version]=summary
            if version in VERSIONS:
                histograms[(key,version)]={bins:histogram(points,weights,bins) for bins in (20,40,80)}
                if key in set(plot_main)|set(plot_stages):
                    payload[key+'_'+version]=dict(points=[[v,a,w] for (v,a),w in zip(points,weights)] if key in plot_main else [],
                        heatmap=histograms[(key,version)][80],summary=dict(n=len(indices),mass=mass,
                            valence=summary['valence'],arousal=summary['arousal']))
    assert math.isclose(summaries['id_balanced']['total_weight'],60741,abs_tol=1e-7)
    # Same actual observations compared to themselves provide non-synthetic metric checks.
    actual_coordinate=points_by_frame['common']['raw'][0][0]
    checks=marginal_distance([actual_coordinate],[1],[actual_coordinate],[1])
    assert checks==dict(ks_distance=0.0,wasserstein_1=0.0)
    assert hist_distance(histograms[('common','theoretical')][80],histograms[('common','theoretical')][80])['jensen_shannon_bits']==0
    contrasts={}
    pairs=[('all_rows','id_rows'),('all_rows','common'),('id_rows','common'),('id_balanced','common'),
        ('singletons','common'),('singletons','href_singletons'),('href_singletons','strict_singletons'),('strict_singletons','common')]
    for base,selected in pairs:
        bp=points_by_frame[base]['raw'];sp=points_by_frame[selected]['raw'];bw=weights_by_frame[base];sw=weights_by_frame[selected]
        contrast=dict(raw={},normalized={},selected_fraction=summaries[selected]['total_weight']/summaries[base]['total_weight'])
        nested=frames[base][1] is None and frames[selected][1] is None and set(frames[selected][0])<=set(frames[base][0])
        for axis,keyaxis in enumerate(('valence','arousal')):
            b=summaries[base]['distributions']['raw'][keyaxis];s=summaries[selected]['distributions']['raw'][keyaxis]
            delta=s['mean']-b['mean'];pool=math.sqrt((b['stddev']**2+s['stddev']**2)/2)
            m=marginal_distance([p[axis] for p in bp],bw,[p[axis] for p in sp],sw)
            m.update(mean_delta=delta,standardized_mean_difference=delta/pool if pool else None,
                stddev_ratio=s['stddev']/b['stddev'] if b['stddev'] else None)
            if nested:
                total=len(bp);n=len(sp);se=b['stddev']*math.sqrt((total-n)/(n*(total-1)))
                m['srs_without_replacement_reference_se']=se
                m['delta_over_srs_reference_se']=delta/se if se else None
            contrast['raw'][keyaxis]=m
        for version in VERSIONS:
            stage={str(b):hist_distance(histograms[(base,version)][b],histograms[(selected,version)][b]) for b in (20,40,80)}
            if nested:
                total=len(bp);n=len(sp)
                for bins in (20,40,80):
                    probabilities=[x/100 for row in histograms[(base,version)][bins] for x in row]
                    expected_l2=(total-n)/(n*(total-1))*(1-math.fsum(p*p for p in probabilities))
                    stage[str(bins)]['srs_reference_expected_squared_l2']=expected_l2
                    stage[str(bins)]['observed_over_srs_expected_squared_l2']=stage[str(bins)]['squared_l2']/expected_l2 if expected_l2 else None
                baseq=summaries[base]['distributions'][version]['quadrants'];sq=summaries[selected]['distributions'][version]['quadrants']
                table=[[sq[q]['mass'] for q in QUADS],[baseq[q]['mass']-sq[q]['mass'] for q in QUADS]]
                chi2=0.0
                for row in table:
                    total_row=sum(row)
                    if total_row:
                        for j,q in enumerate(QUADS):
                            expected_cell=total_row*baseq[q]['mass']/total
                            if expected_cell: chi2+=(row[j]-expected_cell)**2/expected_cell
                stage['selection_association']=dict(cramers_v=math.sqrt(chi2/total),chi_square_descriptive=chi2,
                    selection_rates={q:sq[q]['mass']/baseq[q]['mass'] if baseq[q]['mass'] else None for q in QUADS},
                    quadrant_percentage_point_changes={q:sq[q]['percent']-baseq[q]['percent'] for q in QUADS})
            contrast['normalized'][version]=stage
        contrasts[base+'__to__'+selected]=contrast
    duplicate_details=[duplicate_group(sid,[rows[i] for i in indices]) for sid,indices in sorted(duplicates.items())]
    bounds={}
    for axis,field in enumerate(('valence_tags','arousal_tags')):
        bounds[field]=dict(min_possible_unique_id_mean=float(sum(min(number(rows[i][field]) for i in indices) for indices in groups.values())/len(groups)),
            max_possible_unique_id_mean=float(sum(max(number(rows[i][field]) for i in indices) for indices in groups.values())/len(groups)))
    qb={}
    for version in VERSIONS:
        qb[version]={}
        for q in QUADS:
            lower=sum(all(quad(records[i][version])==q for i in indices) for indices in groups.values())
            upper=sum(any(quad(records[i][version])==q for i in indices) for indices in groups.values())
            qb[version][q]=dict(min_count=lower,max_count=upper,min_percent=100*lower/60741,max_percent=100*upper/60741)
    compare_result=json.loads((comparison/'result.json').read_text(encoding='utf-8'))
    for version,model in [('theoretical','B1'),('observed','B2')]:
        for axis in ('valence','arousal'):
            assert abs(summaries['common']['distributions'][version][axis]['mean']-compare_result['candidate_distributions'][model][axis]['mean'])<1e-12
    output.mkdir(parents=True,exist_ok=False)
    def dump(name,value): (output/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    dup_summary=dict(groups=1063,rows=2224,va_conflict_groups=sum(g['va_conflict'] for g in duplicate_details),
        metadata_classes=dict(Counter(g['metadata_class'] for g in duplicate_details)),source_rows_preserved=True,
        unique_id_mean_identification_bounds=bounds,unique_id_quadrant_identification_bounds=qb)
    flow=dict(all_rows=90408,id_rows=61902,unique_ids=60741,duplicate_groups=1063,duplicate_rows=2224,singleton_ids=59678,
        href_matched_ids=len(href),href_singleton_ids=37171,strict_metadata_ids=len(strict),strict_singleton_ids=27949,common_ids=27948,
        disjoint_row_partition={k:expected[k] for k in ['missing_id','duplicate_rows','not_returned_singletons','held_metadata_singletons','feature_missing','common']},
        metadata_note='All 60,741 IDs were queried. Partition order is analytical, not collector chronology.')
    dump('flow.json',flow);dump('statistics.json',summaries);dump('contrasts.json',contrasts);dump('duplicates.json',dict(summary=dup_summary,groups=duplicate_details))
    def color_range(keys):
        positive=[n for k in keys for row in payload[k]['heatmap'] for n in row if n>0]
        return dict(min_positive=min(positive),max_probability_percent=max(positive))
    mainkeys=[key+'_'+v for v in VERSIONS for key in plot_main];stagekeys=[key+'_'+v for v in VERSIONS for key in plot_stages]
    dump('plot_payload.json',dict(models=payload,bins=80,main_order=list(plot_main),stage_order=list(plot_stages),
        main_color=color_range(mainkeys),stage_color=color_range(stagekeys),plot_limits=[-1,1],
        labels={'all_rows':'All MuSe rows','id_rows':'Spotify ID present','id_balanced':'Equal-ID sensitivity','common':'Final common songs',
            'missing_id':'Missing Spotify ID','duplicate_rows':'Duplicate source rows','singletons':'Singleton IDs',
            'href_singletons':'ID-returned singletons','strict_singletons':'Strict matched singletons'}))
    settings=dict(configurations={version:{axis:configs[('muse-'+version+'-v1',axis)] for axis in ('valence','arousal')} for version in VERSIONS},
        histogram='Same 80x80 bins; probability percentage per bin; main panels share one log color scale across both fixed normalizations.',
        quantiles='Inverse weighted empirical CDF for all frames; no interpolated/averaged song coordinates.',
        id_balancing='Each actual source row has weight 1/group_size; IDs total 1. Sensitivity distribution, not merged/verified unique song coordinates.',
        inference='Finite-population descriptive contrasts. Nested subsets are not independent samples. No iid KS p-values, bootstrap, permutation or generated data. SRS reference is an analytic benchmark only, not the actual selection design.')
    dump('method.json',settings)
    dump('recommendation_connection.json',{m:compare_result['summary']['coverage-control']['models'][m] for m in ('B1','B2')})
    assert all(digest(Path(p))==sha for p,sha in before.items())
    dump('verification.json',dict(result='PASS',fixed_full_population_normalization=True,common_b1_b2_coordinates_matched=True,
        no_coordinate_merging=True,no_generated_observations=True,read_only_sqlite=True,input_sha256=before,
        source_rows=90408,source_id_rows=61902,source_unique_ids=60741,common_ids=27948,disjoint_partition_conserved=True,
        frames={k:dict(observations=s['observations'],total_weight=s['total_weight']) for k,s in summaries.items()},
        duplicate_va_conflicts=dup_summary['va_conflict_groups'],external_api_calls=0,shared_db_connections=0))
    print(json.dumps(dict(result='PASS',output=str(output),frames=len(frames),flow=flow,overall_mean_shifts=contrasts['all_rows__to__common']['raw']),ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output-dir',type=Path,required=True)
    analyze(parser.parse_args().output_dir)
