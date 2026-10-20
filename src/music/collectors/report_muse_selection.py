"""Report/independent PNG and target-density checks for the MuSe selection audit."""
import argparse
import json
import math
import struct
import zlib
from pathlib import Path

from clean_muse import LOCAL,digest


def run(output,check_only=False):
    output=output.resolve()
    assert output.is_relative_to(LOCAL.resolve())
    def read(name): return json.loads((output/name).read_text(encoding='utf-8-sig'))
    def write(name,data):
        p=output/name
        if check_only:
            assert json.loads(p.read_text(encoding='utf-8-sig'))==data,name
            return
        if p.exists(): raise ValueError(f'Refusing overwrite: {p}')
        p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    s=read('statistics.json');c=read('contrasts.json');flow=read('flow.json');dup=read('duplicates.json')['summary']
    payload=read('plot_payload.json');verification=read('verification.json');render=read('render-verification.json')
    comparison=LOCAL/'music-model-comparison-20261020-v1'
    protocol=json.loads((comparison/'protocol.json').read_text(encoding='utf-8'))
    result=json.loads((comparison/'result.json').read_text(encoding='utf-8'))
    prior_artifacts=0
    prior=json.loads((comparison/'verification.json').read_text(encoding='utf-8'))
    for name,sha in prior['artifact_sha256'].items():
        assert digest(comparison/name)==sha;prior_artifacts+=1
    visual=LOCAL/'music-coordinate-visualization-20261020-v1'
    prior_visual=json.loads((visual/'verification.json').read_text(encoding='utf-8'))
    for name,meta in prior_visual['pngs'].items():
        assert digest(visual/name)==meta['sha256'];prior_artifacts+=1
    searches=[json.loads(line) for line in (comparison/'searches.jsonl').read_text(encoding='utf-8').splitlines()]
    assert protocol['settings']==dict(limit=20,valenceWeight=1,arousalWeight=1,initialRadius=.05,expansionFactor=2,excludeSongIds=[])
    local={};density_checks=0
    for version,model in [('theoretical','B1'),('observed','B2')]:
        local[model]=[]
        for target in protocol['targets']:
            groups={}
            for frame in payload['main_order']:
                m=payload['models'][frame+'_'+version]
                mass=math.fsum(w for v,a,w in m['points'] if (v-target['valence'])**2+(a-target['arousal'])**2<=.4**2+1e-14)
                groups[frame]=dict(mass=mass,percent=100*mass/m['summary']['mass'])
            search=next(x for x in searches if x['model']==model and x['scenario']=='cap-0.4' and x['target']['id']==target['id'])
            assert min(20,int(groups['common']['mass']))==search['returned'];density_checks+=1
            local[model].append(dict(target=target,within_radius_04=groups,prior_returned=search['returned'],
                common_minus_all_density_pp=groups['common']['percent']-groups['all_rows']['percent']))
    write('target_density_connection.json',dict(radius=.4,targets=local,checks=density_checks,
        meaning='Full MuSe counts are source rows, not newly verified/recommendable songs. Probability mass separates composition from pool size; no new recommendation run.'))
    pngs={}
    dimensions={'comparison_theoretical.png':(2320,1590),'comparison_observed.png':(2320,1590),
        'selection_bias_all.png':(2320,3180),'matching_and_duplicates.png':(3280,1630)}
    for name,expected in dimensions.items():
        raw=(output/name).read_bytes();assert raw[:8]==b'\x89PNG\r\n\x1a\n';pos=8;chunks=[]
        while pos<len(raw):
            n=struct.unpack('>I',raw[pos:pos+4])[0];kind=raw[pos+4:pos+8];content=raw[pos+8:pos+8+n]
            assert zlib.crc32(kind+content)&0xffffffff==struct.unpack('>I',raw[pos+8+n:pos+12+n])[0]
            if kind==b'IHDR': assert struct.unpack('>II',content[:8])==expected
            chunks.append(kind);pos+=n+12
        assert pos==len(raw) and chunks[-1]==b'IEND'
        pngs[name]=dict(width=expected[0],height=expected[1],sha256=digest(output/name),bytes=len(raw))
    assert verification['result']==render['result']=='PASS'
    assert all(digest(Path(p))==sha for p,sha in verification['input_sha256'].items())
    for frame in payload['main_order']:
        for version in ('theoretical','observed'):
            key=frame+'_'+version
            assert render['scatter_observations'][key]==s[frame]['observations']
            assert math.isclose(sum(map(sum,payload['models'][key]['heatmap'])),100,abs_tol=1e-7)
    lines=['# MuSe 선정·매칭 편향 검증','',
        '2026-10-20 · PASS. 실제 원본의 유한 모집단 비교이며, 외부 호출·DB 쓰기·verified 전환은 없다. 전체 원본은 행 모집단이고 최종 공통곡은 중복이 없는 Spotify ID 모집단이다. 서로 다른 단위를 동일한 “곡 수”로 해석하지 않는다.','',
        '## 선정 흐름과 분석 단위','',
        'MuSe 90,408행 → ID 보유 61,902행 → 고유 Spotify ID 60,741개 → 최종 공통곡 27,948개. ID 보유율 68.47%, 최종 공통곡은 전체 행의 30.91%·고유 ID의 46.01%다.','',
        '60,741개 모두 조회된 체크포인트를 읽기 전용으로 확인했다. href 일치 37,808 ID 중 중복 ID가 637개이며, 단일행 ID는 37,171개다. 제목·아티스트 엄격 일치 27,953 ID 중 중복 4그룹을 제외하면 27,949개이고, feature 미확보 1개를 제외하면 27,948개다. 나머지 중복 ID 426개는 반환되지 않았다. 엄격 메타데이터 일치만으로 중복 또는 verified 보류를 해제하지 않는다.','',
        '| 전체 원본의 상호 배타적 구분 | 행 수 |','|---|---:|']
    lines += [f'| {key} | {n:,} |' for key,n in flow['disjoint_row_partition'].items()]
    lines += ['', '이 표는 원본 90,408행의 분석용 분할이다. 모든 ID를 먼저 조회했으므로 위 분할 순서가 실제 수집의 제외 순서를 뜻하지 않는다.','',
        '**60,741 고유 ID의 단일한 좌표 분포는 확정할 수 없다.** 1,063개 중복 ID에는 2,224개 원본행과 965개 V/A 충돌 그룹이 있다. 단일행 ID 59,678개의 정확한 분포를 별도로 계산했다. ID 균등 가중 민감도는 모든 원본 좌표를 보존하면서 각 행에 `1/그룹행수` 가중치를 주어 각 ID의 총 질량만 1로 맞춘다. 새 좌표나 평균 대표곡을 만들지 않는다. 이 분포는 미해결 고유곡의 확정 분포가 아니다.','',
        '## 고정 정규화와 통계 정의','',
        '`002_normalization_v1.sql`의 `2*(raw-min)/(max-min)-1`을 그대로 재사용했다. 이론 범위는 V/A 모두 [0,9], 관측 범위는 **전체 MuSe** V=[0.23500000000000001,8.475], A=[0.1081132075471698,7.27]이다. 부분집합별 min/max 재계산·좌표 보정·클리핑·jitter·다운샘플링은 없다. B1/B2 JSONL 27,948쌍의 원본 값과 정규화 값도 전수 대조했다.','',
        '표준편차는 모집단 표준편차, 분위수는 가중 경험 누적분포 역함수다. 사분면 기호는 (V,A), 0은 양수 쪽이다. 히트맵은 동일 80×80 구간의 집합 내 확률(%)이며, 이는 색 비교를 위한 질량 정규화다. 감정 좌표를 재정규화한 것이 아니다. 네 집합·두 정규화 전체에 동일 로그 색 척도를 사용했다. 별도 단계 이미지에는 그 이미지 전체에 공통인 색 척도를 사용했다. 산점도는 전 행을 표시하며 집합 질량과 ID 가중치에 맞춰 불투명도를 조정했다.','',
        '## 집합별 평균·표준편차·중앙값·분위수','',
        '모든 분석 집합과 원본/이론/관측 기준을 기록한다. `id_balanced`만 가중 통계다. 원본의 단위는 MuSe raw 점수이며 두 정규화는 [-1,1]이다.','',
        '| 집합 | 관측 수 / 총 가중치 | 단위 |','|---|---:|---|']
    lines += [f"| {key} | {x['observations']:,} / {x['total_weight']:,.3f} | {x['unit']} |" for key,x in s.items()]
    for version in ('raw','theoretical','observed'):
        lines += ['',f'### {version}','', '| 집합 | 축 | 평균 | SD | 중앙값 | P01 | P05 | P25 | P75 | P95 | P99 |','|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
        for key,frame in s.items():
            for axis in ('valence','arousal'):
                x=frame['distributions'][version][axis]
                vals=[x['mean'],x['stddev'],x['median']]+[x['quantiles'][q] for q in ('p01','p05','p25','p75','p95','p99')]
                lines.append(f'| {key} | {axis} | '+' | '.join(f'{n:.5f}' for n in vals)+' |')
        if version!='raw':
            lines += ['','| 집합 | -- 질량 / % | -+ 질량 / % | +- 질량 / % | ++ 질량 / % |','|---|---:|---:|---:|---:|']
            for key,frame in s.items():
                q=frame['distributions'][version]['quadrants']
                lines.append(f'| {key} | '+' | '.join(f"{q[k]['mass']:,.3f} / {q[k]['percent']:.3f}%" for k in ('--','-+','+-','++'))+' |')
    lines += ['', '## 단계별 변화와 효과 크기','',
        '표준화 평균 차이(SMD)는 두 집합 모집단 분산 평균의 제곱근으로 평균 차이를 나눈 값이다. KS는 최대 누적확률 차이, W1은 raw 축에서의 1차 Wasserstein 거리다. 방향은 오른쪽 집합−왼쪽 집합이다.','',
        '| 비교 | 축 | 평균차 | SMD | SD 비 | KS | W1 |','|---|---|---:|---:|---:|---:|---:|']
    for key,contrast in c.items():
        for axis,m in contrast['raw'].items():
            lines.append(f'| {key} | {axis} | '+ ' | '.join(f'{m[k]:.6f}' for k in ('mean_delta','standardized_mean_difference','stddev_ratio','ks_distance','wasserstein_1'))+' |')
    lines += ['', '| 비교 | 정규화 | TV 20 / 40 / 80 | JS(bits) 20 / 40 / 80 | 80-bin 기준 오른쪽 집합의 빈 칸에 놓인 왼쪽 집합 질량 |','|---|---|---|---|---:|']
    for key,contrast in c.items():
        for version in ('theoretical','observed'):
            x=contrast['normalized'][version]
            tv=' / '.join(f"{x[str(b)]['total_variation']:.5f}" for b in (20,40,80))
            js=' / '.join(f"{x[str(b)]['jensen_shannon_bits']:.5f}" for b in (20,40,80))
            lines.append(f"| {key} | {version} | {tv} | {js} | {100*x['80']['reference_mass_in_target_empty_cells']:.3f}% |")
    lines += ['', 'TV=구간 확률 절대차 합/2, JS는 밑 2 Jensen–Shannon divergence다. TV는 구간 폭 및 표본 크기에 민감하므로 단일 숫자를 “편향된 곡의 비율”로 읽으면 안 된다. 다른 bin 폭에서도 방향을 확인했고, 희박한 칸은 작은 최종 집합에서 더 자주 비게 된다.','',
        '전체→공통의 평균 변화는 V +0.043208 / A −0.026079, SMD +0.02783 / −0.02246으로 **전역 위치 변화는 작다**. KS도 0.01702 / 0.02459다. SD 비는 0.99922 / 1.01140으로 대체로 비슷하다. 다만 2차원 국소 질량 차이와 꼬리 손실은 남는다. 사분면 최대 변화는 이론 1.038%p, 관측 1.668%p다. 원본에서 공통곡이 없는 80-bin 칸에 있던 질량은 이론 0.858%, 관측 1.359%다.','',
        'ID 보유 단계는 V 평균 +0.059885 / A −0.034258이며, 이후 공통곡 매칭은 ID 보유행 대비 V −0.016678 / A +0.008179로 평균 변화 일부를 상쇄한다. 단일행 고유 ID만 비교해도 최종 SMD는 V −0.00985 / A +0.00683으로 작다. href 반환 때 A는 +0.029503, 엄격 메타데이터 일치 때 −0.021473로 이동하며, 최종 feature 1개 탈락의 평균 효과는 0.00006 미만이다.','',
        '### 사분면별 선택 연관성','',
        '| 비교 | 기준 | Cramér V | -- 선택률 | -+ 선택률 | +- 선택률 | ++ 선택률 | 최대 변화(%p) |','|---|---|---:|---:|---:|---:|---:|---:|']
    for key,contrast in c.items():
        for version in ('theoretical','observed'):
            assoc=contrast['normalized'][version].get('selection_association')
            if not assoc: continue
            rates=' | '.join(f'{100*x:.3f}%' if x is not None else 'NA' for x in assoc['selection_rates'].values())
            lines.append(f"| {key} | {version} | {assoc['cramers_v']:.5f} | {rates} | {max(map(abs,assoc['quadrant_percentage_point_changes'].values())):.4f} |")
    lines += ['', '### 통계적 해석','',
        '이 자료는 전체 관측 모집단과 그 내부 선정 집합이다. 독립 두 표본 KS 검정이나 일반 t 검정의 p값을 붙이지 않는다. 동일 ID 원본 중복도 독립 표본으로 취급하지 않는다. Cramér V는 선택/탈락×사분면 표의 기술적 연관성이다. 전체→공통의 값은 이론 0.01765, 관측 0.03452로 작다.','',
        '선정이 단순무작위 비복원 추출이었다면 기대되는 평균 SE와 binned L2를 유한 모집단 공식으로만 계산했다(난수·새 관측 생성 없음). 전체→공통 평균차는 이 설계 기준 SE의 +5.596 / −4.543배, 80-bin L2는 기대값의 이론 4.838배 / 관측 4.782배다. 이는 **정확한 무작위 축소와 같다고 가정하기 어렵다는 참고 근거**이며, 실제 선정 설계의 유의확률·인과 효과·미래 표본 신뢰구간을 뜻하지 않는다. 표본 크기가 커 작은 차이도 이러한 기준에서는 두드러진다. 전역 효과 크기가 작다는 사실과 모순되지 않는다.','',
        '## 중복 ID의 별도 분석','',
        f"중복 {dup['groups']:,}그룹 / {dup['rows']:,}행, V/A 충돌 {dup['va_conflict_groups']:,}그룹. 메타데이터 분류: `{json.dumps(dup['metadata_classes'],ensure_ascii=False)}`. 원본과 정책을 보존했고 평균·대표행 선택·병합을 하지 않았다. `duplicates.json`에는 그룹별 판정 근거와 모든 분포 식별 범위를 기록했다.",'',
        '| raw 축 | 미해결 ID별 좌표 한 개를 선택했을 때 가능한 고유 ID 평균 범위 |','|---|---|']
    for axis,b in dup['unique_id_mean_identification_bounds'].items():
        lines.append(f"| {axis} | [{b['min_possible_unique_id_mean']:.6f}, {b['max_possible_unique_id_mean']:.6f}] |")
    lines += ['', '이 범위는 각 원본 후보 중 최솟값/최댓값으로 구한 **축별 식별 한계**이며, 실제 선택·통합 결과가 아니다. 축별 극값을 동시에 달성하는 대표 좌표가 있다고 가정하지 않는다. ID 균등 가중 통계도 이 범위 내 민감도 결과다. 사분면 범위는 각 ID 후보가 모두 그 사분면인지/하나라도 그 사분면인지로 계산했고 범위끼리 동시에 달성된다고 보장하지 않는다.','',
        '## 기존 B1/B2와 추천 거리 실험의 연결','',
        '관측 정규화는 동일 원본을 이론 정규화보다 V축 9/8.24≈1.092배, A축 9/7.1618868≈1.257배 늘리고 원점을 이동한다. 그래서 B1/B2의 사분면 비율·빈 공간·같은 숫자의 목표에 대한 거리가 달라진다. 이는 선정 편향 또는 감정 정확도의 개선과 같은 의미가 아니다. 전체 MuSe에서도 같은 집중·빈 공간 형상이 존재하므로 최종 매칭만으로 B1/B2의 형상을 설명할 수 없다.','',
        '| 모델 | 공통곡 평균 V/A | SD V/A | 반경 .4 부족 / 빈 목표 | 전체 범위 평균 거리 / 확대 |','|---|---|---|---|---|']
    for version,model in [('theoretical','B1'),('observed','B2')]:
        x=s['common']['distributions'][version];limited=result['summary']['cap-0.4']['models'][model];full=result['summary']['coverage-control']['models'][model]
        lines.append(f"| {model} | {x['valence']['mean']:.5f} / {x['arousal']['mean']:.5f} | {x['valence']['stddev']:.5f} / {x['arousal']['stddev']:.5f} | {limited['shortage_cases']} / {limited['empty_cases']} | {full['distance']['mean']:.5f} / {full['mean_expansions']:.2f} |")
    lines += ['', '기존 실험의 반경 .4·25 목표에서 실제 점 개수를 다시 세어 B1/B2 총 50건의 반환 개수와 일치시켰다. 아래 질량은 원본행 또는 고유 공통곡의 집합 내 비율로, 원본을 추천 후보로 추가하거나 알고리즘을 다시 실행한 결과가 아니다. 전체 행 수 감소 자체가 작은 주변 후보 수를 줄이는 효과와, 분포 구성 변화의 효과를 구분해야 한다.','',
        '| 모델 | 목표 V/A | 전체 원본 주변 비율 | ID행 주변 비율 | ID균등 민감도 비율 | 공통곡 주변 비율 | 공통 주변 곡수 | 기존 반환 |','|---|---|---:|---:|---:|---:|---:|---:|']
    for model,targets in local.items():
        for entry in targets:
            t=entry['target'];groups=entry['within_radius_04']
            values=' | '.join(f"{groups[k]['percent']:.5f}%" for k in payload['main_order'])
            lines.append(f"| {model} | ({t['valence']},{t['arousal']}) | {values} | {groups['common']['mass']:.0f} | {entry['prior_returned']} |")
    for model,targets in local.items():
        empty_common=[e for e in targets if e['within_radius_04']['common']['mass']==0]
        empty_both=sum(e['within_radius_04']['all_rows']['mass']==0 for e in empty_common)
        lines += ['',f"{model}: 공통곡 주변 0개인 목표 {len(empty_common)}개 중 전체 MuSe에서도 주변 원본 0행인 목표는 {empty_both}개다. 전체에 있던 소수 원본이 사라진 목표는 {len(empty_common)-empty_both}개다. 상세는 `target_density_connection.json` 참조."]
    lines += ['', '선정 이후 국소적으로 희박해진 영역은 추천 거리 증가·반경 확대·부족을 추가할 수 있지만, 전체 평균 이동만으로 이전 거리 차이의 크기를 인과적으로 배분할 수는 없다. 실제 추천 실험은 동일 27,948곡에 조건부인 비교로 계속 유효하며, 전체 MuSe·다른 음악 카탈로그·실제 감정 정확도로 일반화하는 데는 한계가 있다. MuSe 전체도 이미 별도의 수집/태그 선정 과정을 거친 자료이므로 실제 음악 전체의 대표성을 여기서 검증한 것은 아니다.','',
        '다음 평가는 중앙/경계·고밀도/희박 영역을 층화한 동일 곡 블라인드 청취 평가다. 추천 거리와 청취 감정 일치·선호는 별도 평가하고, 현재 결과만으로 모델 우열을 단정하지 않는다. 중복 ID는 원본별 수동 검토 전 보류 유지한다.','',
        '## 결과와 재현','',
        '- `selection_bias_all.png`: 네 집합 × 두 정규화의 산점도·밀도 통합 이미지.',
        '- `comparison_theoretical.png`, `comparison_observed.png`: 정규화별 비교.',
        '- `matching_and_duplicates.png`: 결측·중복·단일행·href·엄격매칭·공통 단계.',
        '- `statistics.json`, `contrasts.json`, `duplicates.json`, `flow.json`, `method.json`: 모든 통계·방법·중복 근거.',
        '- `target_density_connection.json`, `recommendation_connection.json`: 이전 실험 연결.',
        '- `verification.json`, `render-verification.json`, `result.json`: 원본/입력 SHA·행 보존·좌표 대조·PNG 검증.', '',
        '저장소 루트 PowerShell에서 **새 출력 폴더**를 지정해 순서대로 실행한다. 원본과 과거 출력 덮어쓰기를 거부한다.','',
        '```powershell',
        '$analysisDir = "src/music/.local/muse-selection-bias-reproduction-v1"',
        'python -B src/music/collectors/analyze_muse_selection.py --output-dir $analysisDir',
        'powershell -NoProfile -ExecutionPolicy Bypass -File src/music/collectors/render_muse_selection.ps1 -OutputDir $analysisDir',
        'python -B src/music/collectors/report_muse_selection.py --output-dir $analysisDir','```','',
        'Python 표준 라이브러리와 기존 System.Drawing 렌더러만 사용했다. 입력 SHA를 분석 전후 및 보고서 완료 시 재검사했고 immutable SQLite·실험 manifest 해시·공통 B1/B2 원본/좌표 전수 일치·행 분할 보존·확률 질량 보존·모든 점 표시·PNG 전체 청크 CRC와 크기 검증 PASS다. 실제 서비스/백엔드/추천 함수·공유 DB·수집 원본·기존 실험 출력 변경 없음.','']
    report=output/'REPORT.md'
    if check_only:
        assert report.read_text(encoding='utf-8')=='\n'.join(lines),'REPORT reproducibility'
    else:
        if report.exists(): raise ValueError('Refusing overwrite: REPORT.md')
        report.write_text('\n'.join(lines),encoding='utf-8')
    scripts=[Path(__file__).resolve(),Path(__file__).with_name('analyze_muse_selection.py'),Path(__file__).with_name('render_muse_selection.ps1'),Path(__file__).with_name('render_coordinate_plots.ps1')]
    write('result.json',dict(result='PASS',pngs=pngs,target_density_checks=density_checks,protected_input_hashes_unchanged=True,
        previous_artifacts_verified=prior_artifacts,png_crc_verified=True,source_sha256={str(p):digest(p) for p in scripts},report_sha256=digest(report),
        overall_raw_contrast=c['all_rows__to__common']['raw'],population_units_explicit=True,duplicates_not_merged=True))
    print(json.dumps(dict(result='PASS',pngs=len(pngs),target_checks=density_checks,output=str(output)),ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--check-only',action='store_true',help='Recompute and compare existing reports without writes')
    args=parser.parse_args();run(args.output_dir,args.check_only)
