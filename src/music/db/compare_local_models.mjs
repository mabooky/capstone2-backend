// Numerical local experiment only. No service source promotion or quality ground truth.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { openLocalExperiment } from './query_local_experiment.mjs';
import { entries } from './load_muse_batches.mjs';
import { q,music,shaFile,localDirectory } from './persistent_muse.mjs';
import { MODELS,mean,statistics,quadrant,targets,overlap,shape } from './experiment_comparison_metrics.mjs';

const forbidden=()=>{throw new Error('Network forbidden in numerical experiment');};
net.Socket.prototype.connect=forbidden; http.request=http.get=https.request=https.get=forbidden; globalThis.fetch=forbidden;
const dataset=resolve(music,'.local/music-experiment-20261020-v3');
const root=await localDirectory(process.argv[2]??resolve(music,'.local/music-model-comparison-20261020-v1'));
assert.deepEqual(await readdir(root),['build'],'Use a fresh output directory containing only the new TS build');
const newJson=(name,value)=>writeFile(resolve(root,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const {compareViews}=await import(pathToFileURL(resolve(root,'build/algorithm/recommend.js')).href);
const {experimentRows}=await import(pathToFileURL(resolve(root,'build/db/experiment_input.js')).href);
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const ok=(a)=>{assert.ok(a);checks++;};
// Known fixtures test metric denominators, empty lists and rank swaps independently of real data.
eq(overlap([{song_id:'1',rank:1},{song_id:'2',rank:2}],[{song_id:'2',rank:1},{song_id:'3',rank:2}],2).overlap_at_k,.5);
eq(overlap([],[],20).jaccard,null); eq(overlap([],[],20).overlap_at_k,0);
eq(overlap([],[],20).top1_agreement,null);
eq(overlap([{song_id:'1',rank:1}],[{song_id:'1',rank:2}],20).mean_shared_rank_gap,1);
eq(statistics([0,1,2,3]).median,1.5); eq(targets().length,25); eq(quadrant(0,0),'++');
const metricFixtureChecks=checks;
const targetRows=targets();
const settings={limit:20,valenceWeight:1,arousalWeight:1,initialRadius:.05,expansionFactor:2,excludeSongIds:[]};
const scenarios=[{id:'cap-0.4',maxRadius:.4},{id:'coverage-control',maxRadius:Math.sqrt(8)}];
await newJson('protocol.json',{dataset,targets:targetRows,settings,scenarios,
    target_selection:'Complete Cartesian grid of [-1,-0.5,0,0.5,1]; no random selection.',
    overlap_at_k:'intersection / 20, including short/empty lists; empty/empty Jaccard and top1 agreement are null.',
    ranking:'Existing weighted Euclidean distance; exact score ties use case-sensitive Spotify ID order.',
    exclusions:'Empty for every model; all 27,948 candidates retained.',
    inference:'Grid-weighted numerical behavior only; no listening labels or emotional accuracy inference.'});
const protectedInput=JSON.parse(await readFile(resolve(music,'.local/music-integrated-20261020-v1/reccobeats-staging/manifest.json'),'utf8')).protected_sha256;
for(const [name,sha] of Object.entries(protectedInput)) eq(await shaFile(resolve(music,'.local',name)),sha);
const experiment=await openLocalExperiment(dataset,{allowUnverifiedLocalExperiment:true});
const inputs={},population={},numeric={};
try {
    eq((await q(experiment.db,'SHOW transaction_read_only'))[0].transaction_read_only,'on');
    for(const model of MODELS) {
        const envelope=await experiment.model(model);
        inputs[model]=experimentRows(envelope,{allowUnverifiedLocalExperiment:true});
        eq(inputs[model].length,27948);
        const file=resolve(dataset,model+'.jsonl');
        eq(await shaFile(file),experiment.manifest.artifacts_sha256[model+'.jsonl']);
        let i=0; for await(const entry of entries(file)) eq(inputs[model][i++],entry);
        eq(i,27948);
        numeric[model]=inputs[model].map(r=>({id:String(r.song_id),spotify:r.spotify_id,v:Number(r.valence),a:Number(r.arousal)}));
        population[model]=shape(numeric[model].map(r=>[r.v,r.a]));
    }
    eq((await q(experiment.db,"SELECT count(*)::int n FROM music.song_sources WHERE match_status='verified'"))[0].n,0);
} finally { await experiment.close(); }
const inputHashes=Object.fromEntries(MODELS.map(m=>[m,hash(inputs[m])]));
eq(new Set(MODELS.map(m=>hash(numeric[m].map(r=>[r.id,r.spotify])))).size,1);
const allSearches=[],allOverlaps=[],centerHashes={};
for(const file of ['rankings.jsonl','searches.jsonl','overlaps.jsonl']) await writeFile(resolve(root,file),'',{flag:'wx'});
for(const scenario of scenarios) {
    for(const target of targetRows) {
        const result=compareViews(inputs,{...settings,maxRadius:scenario.maxRadius,valence:target.valence,arousal:target.arousal});
        eq(result.commonSongIds.length,27948);
        const ranked={};
        for(const model of MODELS) {
            const r=result.results[model]; eq(result.coverage[model],27948); eq(r.availableCandidates,27948); eq(r.duplicateRowsIgnored,0);
            const records=r.tracks.map((track,i)=>({scenario:scenario.id,target_id:target.id,model,rank:i+1,
                song_id:String(track.row.song_id),spotify_id:track.row.spotify_id,
                valence:Number(track.row.valence),arousal:Number(track.row.arousal),
                distance:track.distance,distance_squared:track.distanceSquared,
                valence_source_id:String(track.row.valence_source_id),arousal_source_id:String(track.row.arousal_source_id),
                valence_normalization_version:track.row.valence_normalization_version,
                arousal_normalization_version:track.row.arousal_normalization_version}));
            eq(new Set(records.map(x=>x.song_id)).size,records.length);
            // Independent full-cap brute-force ranking; no production radius search is reused.
            const oracle=numeric[model].map(p=>({...p,d2:(p.v-target.valence)**2+(p.a-target.arousal)**2}))
                .filter(p=>Math.sqrt(p.d2)<=scenario.maxRadius)
                .sort((a,b)=>a.d2-b.d2||(a.spotify<b.spotify?-1:a.spotify>b.spotify?1:0)).slice(0,20);
            eq(records.map(x=>x.song_id),oracle.map(x=>x.id));
            for(let i=0;i<records.length;i++) {
                const row=records[i]; ok(Math.abs(row.distance_squared-oracle[i].d2)<1e-12);
                ok(row.distance<=scenario.maxRadius); ok(Number.isFinite(row.valence)&&Number.isFinite(row.arousal));
                ok(Math.abs(row.valence)<=1&&Math.abs(row.arousal)<=1);
            }
            const points=records.map(x=>[x.valence,x.arousal]),candidate=population[model];
            const outlier=x=>x.valence<candidate.iqr_fences.valence[0]||x.valence>candidate.iqr_fences.valence[1]||
                x.arousal<candidate.iqr_fences.arousal[0]||x.arousal>candidate.iqr_fences.arousal[1];
            const cutoff=r.tracks.at(-1)?.distanceSquared;
            const tiedPool=cutoff===undefined?0:numeric[model].filter(p=>(p.v-target.valence)**2+(p.a-target.arousal)**2===cutoff).length;
            const search={scenario:scenario.id,target,model,returned:records.length,shortfall:20-records.length,
                reason:r.reason,expansions:r.steps.length-1,final_radius:r.steps.at(-1).radius,steps:r.steps,
                distance:statistics(records.map(x=>x.distance)),coordinates:shape(points),
                axis_extent_contains_target:target.valence>=candidate.valence.min&&target.valence<=candidate.valence.max&&
                    target.arousal>=candidate.arousal.min&&target.arousal<=candidate.arousal.max,
                iqr_outlier_exposures:records.filter(outlier).length,
                iqr_outlier_song_ids:records.filter(outlier).map(x=>x.song_id),
                near_boundary_exposures:records.filter(x=>Math.abs(x.valence)>=.95||Math.abs(x.arousal)>=.95).length,
                cutoff_tied_candidate_pool:tiedPool,
                recommendations:records};
            ranked[model]=records; allSearches.push(search);
            if(records.length) await appendFile(resolve(root,'rankings.jsonl'),records.map(x=>JSON.stringify(x)).join('\n')+'\n');
            const {recommendations,...saved}=search;
            await appendFile(resolve(root,'searches.jsonl'),JSON.stringify(saved)+'\n');
        }
        for(let i=0;i<MODELS.length;i++) for(let j=i+1;j<MODELS.length;j++) {
            const left=MODELS[i],right=MODELS[j];
            const record={scenario:scenario.id,target_id:target.id,left,right,left_n:ranked[left].length,right_n:ranked[right].length,
                ...overlap(ranked[left],ranked[right],20)};
            allOverlaps.push(record); await appendFile(resolve(root,'overlaps.jsonl'),JSON.stringify(record)+'\n');
        }
        if(target.region==='center') centerHashes[scenario.id]=hash(result);
    }
    console.log(JSON.stringify({scenario:scenario.id,targets:25,model_searches:125,status:'PASS'}));
}
// A selected repeat checks deterministic output without rerunning the entire experiment.
for(const scenario of scenarios) eq(hash(compareViews(inputs,{...settings,maxRadius:scenario.maxRadius,valence:0,arousal:0})),centerHashes[scenario.id]);
for(const model of MODELS) eq(hash(inputs[model]),inputHashes[model]);
const summary={};
for(const scenario of scenarios) {
    const models={};
    for(const model of MODELS) {
        const searches=allSearches.filter(x=>x.scenario===scenario.id&&x.model===model),records=searches.flatMap(x=>x.recommendations);
        const regions={};
        for(const region of ['center','quadrant','axis','boundary']) {
            const cases=searches.filter(x=>x.target.region===region);
            regions[region]={targets:cases.length,shortage_cases:cases.filter(x=>x.shortfall>0).length,
                mean_returned:mean(cases.map(x=>x.returned)),mean_expansions:mean(cases.map(x=>x.expansions)),
                mean_distance:mean(cases.flatMap(x=>x.recommendations.map(r=>r.distance))),
                recommended_quadrants:shape(cases.flatMap(x=>x.recommendations.map(r=>[r.valence,r.arousal]))).quadrants};
        }
        models[model]={targets:25,total_recommendations:records.length,unique_recommended_songs:new Set(records.map(x=>x.song_id)).size,
            shortage_cases:searches.filter(x=>x.shortfall>0).length,empty_cases:searches.filter(x=>x.returned===0).length,
            shortage_target_ids:searches.filter(x=>x.shortfall>0).map(x=>x.target.id),
            mean_returned:mean(searches.map(x=>x.returned)),mean_expansions:mean(searches.map(x=>x.expansions)),
            max_expansions:Math.max(...searches.map(x=>x.expansions)),mean_final_radius:mean(searches.map(x=>x.final_radius)),
            distance:statistics(records.map(x=>x.distance)),mean_target_mean_distance:mean(searches.map(x=>x.distance.mean).filter(x=>x!==null)),
            coordinates:shape(records.map(x=>[x.valence,x.arousal])),
            candidate_iqr_outlier_exposures:searches.reduce((n,x)=>n+x.iqr_outlier_exposures,0),
            unique_iqr_outlier_songs:new Set(searches.flatMap(x=>x.iqr_outlier_song_ids)).size,
            near_boundary_exposures:searches.reduce((n,x)=>n+x.near_boundary_exposures,0),
            cutoff_tie_cases:searches.filter(x=>x.cutoff_tied_candidate_pool>1).length,by_target_region:regions};
    }
    const pairs={};
    for(let i=0;i<MODELS.length;i++) for(let j=i+1;j<MODELS.length;j++) {
        const left=MODELS[i],right=MODELS[j],rows=allOverlaps.filter(r=>r.scenario===scenario.id&&r.left===left&&r.right===right);
        pairs[left+'-'+right]={mean_overlap_at_k:mean(rows.map(x=>x.overlap_at_k)),
            mean_jaccard_nonempty_union:mean(rows.map(x=>x.jaccard).filter(x=>x!==null)),
            mean_shared_rank_gap:mean(rows.map(x=>x.mean_shared_rank_gap).filter(x=>x!==null)),
            top1_agreement_cases:rows.filter(x=>x.top1_agreement===true).length,
            both_nonempty_cases:rows.filter(x=>x.top1_agreement!==null).length,
            both_empty_cases:rows.filter(x=>x.left_n===0&&x.right_n===0).length};
    }
    summary[scenario.id]={models,pairs};
}
for(const model of MODELS) {
    eq(summary['coverage-control'].models[model].shortage_cases,0);
    eq(summary['coverage-control'].models[model].total_recommendations,500);
}
for(const [name,sha] of Object.entries(protectedInput)) eq(await shaFile(resolve(music,'.local',name)),sha);
const integratedHashes=JSON.parse(await readFile(resolve(dataset,'source-database-sha256.json'),'utf8'));
for(const [name,sha] of Object.entries(integratedHashes)) eq(await shaFile(resolve(music,'.local/music-integrated-20261020-v1/database',name)),sha);
const sourceHashes={};
for(const path of ['algorithm/recommend.ts','db/experiment_input.ts','db/004_local_experiment.sql','db/compare_local_models.mjs','db/experiment_comparison_metrics.mjs'])
    sourceHashes[path]=await shaFile(resolve(music,path));
const result={result:'PASS',dataset_kind:'unverified-local-experiment-v1',dataset_id:'music-experiment-20261020-v3',
    common_songs:27948,targets:25,scenarios:2,model_searches:250,top_k:20,summary,candidate_distributions:population,
    validation:{checks,metric_fixture_checks:metricFixtureChecks,independent_full_cap_oracle:'250 model searches matched',
        deterministic_center_repeats:2,input_rows_unchanged:true,real_verified_sources:0,readonly_db:true,
        protected_collection_files_unchanged:Object.keys(protectedInput).length,original_integrated_files_unchanged:Object.keys(integratedHashes).length,
        external_api_calls:0,external_database_connections:0},source_sha256:sourceHashes,
    input_sha256:Object.fromEntries(await Promise.all(MODELS.map(async m=>[m,await shaFile(resolve(dataset,m+'.jsonl'))]))),
    interpretation:'Numerical coordinate geometry and grid-weighted behavior only. No human emotion labels/listening outcomes; distances are not emotional accuracy scores.'};
await newJson('result.json',result);
const pct=x=>(100*x).toFixed(1)+'%',num=x=>x===null?'—':x.toFixed(3);
let report='# 5종 추천 모델 수치 비교\n\n공통 27,948곡, 격자 목표 25개, Top-20, 가중치 V=A=1, 제외 없음, 초기 반경 0.05·2배 확대. 실험 전용 미검증 데이터이며 서비스 verified 전환은 없다.\n';
for(const scenario of scenarios) {
    report+=`\n## ${scenario.id} (최대 반경 ${num(scenario.maxRadius)})\n\n| 모델 | 평균 반환 | 부족/25 | 빈 결과 | 평균 거리 | 평균 확대 | 고유 추천곡 |\n|---|---:|---:|---:|---:|---:|---:|\n`;
    for(const model of MODELS) { const m=summary[scenario.id].models[model]; report+=`| ${model} | ${num(m.mean_returned)} | ${m.shortage_cases} | ${m.empty_cases} | ${num(m.distance.mean)} | ${num(m.mean_expansions)} | ${m.unique_recommended_songs} |\n`; }
    report+='\n평균 거리는 반환된 추천 노출에 한하며 빈 결과는 포함하지 않는다. 사분면/중앙/축/경계별 결과는 result.json의 by_target_region에 있다.\n\n| 모델 쌍 | 평균 Top-20 중복률 | 평균 공유곡 순위 차이 | Top-1 일치 / 둘 다 비어 있지 않은 목표 |\n|---|---:|---:|---:|\n';
    for(const [pair,p] of Object.entries(summary[scenario.id].pairs)) report+=`| ${pair} | ${pct(p.mean_overlap_at_k)} | ${num(p.mean_shared_rank_gap)} | ${p.top1_agreement_cases}/${p.both_nonempty_cases} |\n`;
}
report+='\n## 좌표 분포·이상값\n\n사분면 0은 양수 쪽으로 분류한다. 노출 통계에는 동일 곡의 반복 추천이 포함되며 고유 곡 수도 별도 집계했다. IQR 이상값은 각 모델 전체 후보의 축별 Q1−1.5IQR/Q3+1.5IQR 밖의 추천 노출이며 제거하지 않는다. abs(V/A)≥0.95는 경계 근접 노출로만 표시한다.\n\n| 모델 | 제한 반경 추천 사분면 (--/-+/+-/++) | IQR 이상 노출 | 전체 범위 추천 사분면 | IQR 이상 노출 |\n|---|---|---:|---|---:|\n';
for(const model of MODELS) { const a=summary['cap-0.4'].models[model],b=summary['coverage-control'].models[model]; report+=`| ${model} | ${Object.values(a.coordinates.quadrants).join('/')} | ${a.candidate_iqr_outlier_exposures} | ${Object.values(b.coordinates.quadrants).join('/')} | ${b.candidate_iqr_outlier_exposures} |\n`; }
report+='\n## 해석의 범위와 후속 청취 평가\n\n25개 격자 중 경계가 16개인 인위적 실험이다. 전체 목표 평균은 실제 이용자 감정 분포나 서비스 품질 추정치가 아니다. 중복률=교집합/20이며 부족·빈 결과에 영향을 받는다. 둘 다 빈 결과의 Jaccard/Top-1은 null이다. 공유곡 순위 차이는 공유곡이 있는 목표에 조건부다.\n\nReccoBeats Energy와 MuSe Arousal은 다른 출처의 지표이고 이론/관측 정규화가 축의 분포와 거리를 바꾼다. 특정 모델의 짧은 거리·높은 충족률·중복률은 감정 정확도나 음악 추천 품질 우위를 입증하지 않는다. 전체 범위 대조에서 모든 부족이 해소되는지 확인해 반경 상한과 후보 고갈을 구분했다.\n\n청취 평가는 모델명을 가린 무작위·순서 균형 설계에서 목표 감정 적합도, Valence/Arousal 인지, 개인 선호·익숙함·곡 버전, 다양성과 피로도를 별도로 수집해야 한다. 동일 곡이 모델 간 중복될 때는 같은 자극으로 연결하고, 참가자별 반복 측정과 일치도를 분석한다. 이용 가능한 음원/권한·평가 절차는 별도 확정하며 이번에는 재생/외부 API를 사용하지 않았다.\n\n## 재현·검증\n\nprotocol.json에 목표와 설정, result.json에 입력/소스 SHA256와 검증 결과, rankings.jsonl에 순위/곡 ID/좌표/거리/출처, searches.jsonl에 확대 단계/부족/좌표 통계, overlaps.jsonl에 목표별 모델 쌍 결과를 저장했다. 기존 TypeScript 추천 함수를 수정하지 않고 사용했으며 모든 250개 모델 검색을 독립 전체 후보 정렬 기준과 대조하고 중앙 좌표 2개 조건을 반복 확인했다. 앱 전체 빌드와 청취 품질 평가는 이 결과에 포함하지 않는다.\n';
await writeFile(resolve(root,'REPORT.md'),report,{flag:'wx'});
console.log(JSON.stringify({result:'PASS',targets:25,model_searches:250,checks,report:resolve(root,'REPORT.md')}));
