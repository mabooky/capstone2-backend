# 공유 후보 검토·정제 기록

조사 보고서의 후보 36개를 파일별로 검토했다. **24개 후보의 발췌/정제 사본을 채택하고 이미지 12개는 제외**했다. 개별 좌표를 표시하는 산점도/통합 이미지 9개와 공개 조건이 미확정인 ReccoBeats 파생 밀도 3개다. 모든 원본은 현재 위치에 보존했다.

## 판정 기준

- MuSe는 로컬 provenance의 CC BY 4.0 기록과 출처 표시를 근거로 집계 발췌를 준비했다. 이번 외부 사이트 조회는 없다. 개별 곡 ID/좌표·원본 API·대량 매핑을 포함하지 않는다.
- 원본 ReccoBeats 데이터의 공개 조건은 확인되지 않았다. A/C1/C2 값에 의존하는 수치·모델 쌍·밀도는 이번 공유본에 넣지 않았다. 연구 방법·원본 실행 건수·일반 검사 이력과 B1/B2 MuSe 집계만 유지했다.
- 세 REPORT는 공유용으로 재구성했다. 1행 feature_missing 집단과 strict 집단의 감정 통계, 해당 단계 비교를 제외해 단일행 탈락 좌표를 직접 보여주거나 차분으로 복원하는 위험을 줄였다.
- JSON의 기기 절대경로는 저장소 상대경로로 변경하거나 비공개 입력 해시 맵과 함께 제거했다. 개인 환경 경로·자격증명·실제 Spotify ID·원본 응답은 공유하지 않는다. t01~t25는 실험 목표 ID이며 음악 ID가 아니다.
- 원본 검증 기록의 result는 original_run_result로 표시하고 _share_copy에 정제 범위를 적었다. 원본 5모델 카운터를 현재 공유 파일 수·실행 결과로 해석하지 않는다.
- 채택 PNG 3개는 MuSe의 80×80 bin 집계 이미지이며 바이트 그대로 복사했다. 모든 점별 산점도는 제외했다.

## 36개 파일의 판정

| 원본(비공개 로컬 경로) | 판정 | 공유 사본 | 변경·제외 이유 |
|---|---|---|---|
| muse-selection-bias-20261020-v1/REPORT.md | 발췌·정제 | [muse-selection-bias-20261020/REPORT.md](muse-selection-bias-20261020/REPORT.md) | 공유용 발췌 보고서로 재구성; 원본 전체 보고서와 구분 |
| muse-selection-bias-20261020-v1/comparison_observed.png | 제외·검토 보류 | — | 점별 산점도/산점도 포함 통합 이미지: 개별 원본 좌표 표시 |
| muse-selection-bias-20261020-v1/comparison_theoretical.png | 제외·검토 보류 | — | 점별 산점도/산점도 포함 통합 이미지: 개별 원본 좌표 표시 |
| muse-selection-bias-20261020-v1/contrasts.json | 발췌·정제 | [muse-selection-bias-20261020/contrasts.json](muse-selection-bias-20261020/contrasts.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; 한 행 탈락을 직접 비교하거나 역산하는 strict 단계 비교 2개 제외 |
| muse-selection-bias-20261020-v1/flow.json | 발췌·정제 | [muse-selection-bias-20261020/flow.json](muse-selection-bias-20261020/flow.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분 |
| muse-selection-bias-20261020-v1/matching_and_duplicates.png | 밀도 PNG 동일 복사 | [muse-selection-bias-20261020/figures/matching_and_duplicates.png](muse-selection-bias-20261020/figures/matching_and_duplicates.png) | MuSe 집계 밀도 PNG 바이트 동일 복사; 픽셀/축/정규화 변경 없음 |
| muse-selection-bias-20261020-v1/method.json | 발췌·정제 | [muse-selection-bias-20261020/method.json](muse-selection-bias-20261020/method.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분 |
| muse-selection-bias-20261020-v1/recommendation_connection.json | 발췌·정제 | [muse-selection-bias-20261020/recommendation_connection.json](muse-selection-bias-20261020/recommendation_connection.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분 |
| muse-selection-bias-20261020-v1/render-verification.json | 발췌·정제 | [muse-selection-bias-20261020/render-verification.json](muse-selection-bias-20261020/render-verification.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; 공유하지 않는 점별 산점도 렌더 카운터 제외 |
| muse-selection-bias-20261020-v1/result.json | 발췌·정제 | [muse-selection-bias-20261020/result.json](muse-selection-bias-20261020/result.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; 미공유 산점도 PNG·원본 REPORT 해시 제외; 코드 해시 키를 상대경로로 변경 |
| muse-selection-bias-20261020-v1/selection_bias_all.png | 제외·검토 보류 | — | 점별 산점도/산점도 포함 통합 이미지: 개별 원본 좌표 표시 |
| muse-selection-bias-20261020-v1/statistics.json | 발췌·정제 | [muse-selection-bias-20261020/statistics.json](muse-selection-bias-20261020/statistics.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; 1행 feature_missing 및 그와 대조되는 strict 집합 2개 제외; 개별 좌표/차분 복원 위험 축소 |
| muse-selection-bias-20261020-v1/target_density_connection.json | 발췌·정제 | [muse-selection-bias-20261020/target_density_connection.json](muse-selection-bias-20261020/target_density_connection.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분 |
| muse-selection-bias-20261020-v1/verification.json | 발췌·정제 | [muse-selection-bias-20261020/verification.json](muse-selection-bias-20261020/verification.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; 비공개 입력 해시 맵과 소수 집단/strict frame 메타데이터 제외 |
| muse-selection-bias-20261020-v1/visual-qa.json | 발췌·정제 | [muse-selection-bias-20261020/visual-qa.json](muse-selection-bias-20261020/visual-qa.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; 공유하지 않는 점별 산점도 이름 제외 |
| music-coordinate-visualization-20261020-v1/REPORT.md | 발췌·정제 | [coordinate-distributions-20261020/REPORT.md](coordinate-distributions-20261020/REPORT.md) | 공유용 발췌 보고서로 재구성; 원본 전체 보고서와 구분 |
| music-coordinate-visualization-20261020-v1/comparison_all.png | 제외·검토 보류 | — | 점별 산점도/산점도 포함 통합 이미지: 개별 원본 좌표 표시 |
| music-coordinate-visualization-20261020-v1/density_A.png | 제외·검토 보류 | — | ReccoBeats 파생 밀도: 공개·재배포 조건 확인 전 보류 |
| music-coordinate-visualization-20261020-v1/density_B1.png | 밀도 PNG 동일 복사 | [coordinate-distributions-20261020/figures/density_B1.png](coordinate-distributions-20261020/figures/density_B1.png) | MuSe 집계 밀도 PNG 바이트 동일 복사; 픽셀/축/정규화 변경 없음 |
| music-coordinate-visualization-20261020-v1/density_B2.png | 밀도 PNG 동일 복사 | [coordinate-distributions-20261020/figures/density_B2.png](coordinate-distributions-20261020/figures/density_B2.png) | MuSe 집계 밀도 PNG 바이트 동일 복사; 픽셀/축/정규화 변경 없음 |
| music-coordinate-visualization-20261020-v1/density_C1.png | 제외·검토 보류 | — | ReccoBeats 파생 밀도: 공개·재배포 조건 확인 전 보류 |
| music-coordinate-visualization-20261020-v1/density_C2.png | 제외·검토 보류 | — | ReccoBeats 파생 밀도: 공개·재배포 조건 확인 전 보류 |
| music-coordinate-visualization-20261020-v1/density_vs_recommendation.json | 발췌·정제 | [coordinate-distributions-20261020/density_vs_recommendation.json](coordinate-distributions-20261020/density_vs_recommendation.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; A/C1/C2 목표 주변 수치 제외 |
| music-coordinate-visualization-20261020-v1/input-verification.json | 발췌·정제 | [coordinate-distributions-20261020/input-verification.json](coordinate-distributions-20261020/input-verification.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; 비공개 입력 해시 맵 제외; 두 데이터 폴더 절대경로 상대화 |
| music-coordinate-visualization-20261020-v1/render-verification.json | 발췌·정제 | [coordinate-distributions-20261020/render-verification.json](coordinate-distributions-20261020/render-verification.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; 미공유 모델별 렌더 카운터 제외; 원본 실행 메타데이터만 유지 |
| music-coordinate-visualization-20261020-v1/scatter_A.png | 제외·검토 보류 | — | 점별 산점도/산점도 포함 통합 이미지: 개별 원본 좌표 표시 |
| music-coordinate-visualization-20261020-v1/scatter_B1.png | 제외·검토 보류 | — | 점별 산점도/산점도 포함 통합 이미지: 개별 원본 좌표 표시 |
| music-coordinate-visualization-20261020-v1/scatter_B2.png | 제외·검토 보류 | — | 점별 산점도/산점도 포함 통합 이미지: 개별 원본 좌표 표시 |
| music-coordinate-visualization-20261020-v1/scatter_C1.png | 제외·검토 보류 | — | 점별 산점도/산점도 포함 통합 이미지: 개별 원본 좌표 표시 |
| music-coordinate-visualization-20261020-v1/scatter_C2.png | 제외·검토 보류 | — | 점별 산점도/산점도 포함 통합 이미지: 개별 원본 좌표 표시 |
| music-coordinate-visualization-20261020-v1/statistics.json | 발췌·정제 | [coordinate-distributions-20261020/statistics.json](coordinate-distributions-20261020/statistics.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; A/C1/C2 좌표 집계 제외 |
| music-coordinate-visualization-20261020-v1/verification.json | 발췌·정제 | [coordinate-distributions-20261020/verification.json](coordinate-distributions-20261020/verification.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; 공유 density 2개의 원본 PNG 해시만 유지; 원본 REPORT 해시 제외 |
| music-model-comparison-20261020-v1/REPORT.md | 발췌·정제 | [model-comparison-20261020/REPORT.md](model-comparison-20261020/REPORT.md) | 공유용 발췌 보고서로 재구성; 원본 전체 보고서와 구분 |
| music-model-comparison-20261020-v1/protocol.json | 발췌·정제 | [model-comparison-20261020/protocol.json](model-comparison-20261020/protocol.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; 실험 DB 절대경로를 저장소 상대경로로 변경; 파일은 비공개 |
| music-model-comparison-20261020-v1/result.json | 발췌·정제 | [model-comparison-20261020/result.json](model-comparison-20261020/result.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; A/C1/C2 수치·교차 모델 쌍·입력 해시 제외; B1/B2 집계만 발췌 |
| music-model-comparison-20261020-v1/verification.json | 발췌·정제 | [model-comparison-20261020/verification.json](model-comparison-20261020/verification.json) | 공유 사본 식별정보 추가; 원본 검증 결과와 공유본 검사를 구분; 비공개 상세 결과 및 정제 전 REPORT/protocol/result의 artifact 해시 맵 제외 |

개별 파일의 원본 SHA와 공유 SHA/용량은 [manifest.json](manifest.json)에 있다. 원본은 검토 대상 콘텐츠를 보고서에 다시 싣지 않고 상대경로·해시로만 식별한다.

## 후보 밖 자료

추가 근거 9개와 개별 곡 순위/검색/교집합 JSONL, source/score JSONL, plot_payload, duplicate 그룹 상세, 공통곡 매핑, 원본 CSV/API, DB snapshot·체크포인트·WAL/SHM은 복사하지 않았다. 원본 검증·원본 입력의 SHA 목록을 제거한 공유 검증 요약은 독립적인 전체 실험 재현 증거를 대체하지 않는다.

## 기존 문서 변경 필요성

최종 공유 점검에서 확인한 차단 사항을 다음과 같이 문서에서 정리했다. 원본 연구·DB·체크포인트와 구현 기능은 변경하지 않았다.

| 기존 파일 | 후속 검토 필요 내용 |
|---|---|
| PROJECT.md | 완료된 격리 연구와 운영/팀 라우터 미적용을 구분하고 reports·재현 안내 링크를 추가했다. |
| db/README.md | MuSe 단독 적재 설명이 과거 단계임을 표시하고 최신 상태/공유 인덱스를 연결했다. |
| collectors/README.md | 실제 매칭/확보·통신 결과 수치를 제거하고 구현 설정과 실측을 구분했다. 고정 작업 절대경로를 제거하고 설치/검증 안내를 연결했다. |
| integration/README.md | 기존 서버 라우터 미연결 설명은 유지한다. 최신 설치/비공개 DB 테스트 구분은 REPRODUCING.md를 따른다. |
| SPEC.md, STATUS.md | 실제 Spotify ID·원본 행 ID·곡명·개별 감정 좌표·태그 가중치 사례를 공유 문서에서 제거했다. 필요한 설명만 실제 관측과 구분된 가상 예시로 제시한다. |
| PLAN.md, SPEC.md, STATUS.md | ReccoBeats 기반 실제 분포·성공률·거리/겹침·비용 분석은 로컬 보존 위치만 안내한다. 모델 정의·일반 수식·구현 설정·합성 검증·MuSe 집계는 유지했다. |

제공자 기반 실제 수치·시각화를 다시 공개하려면 별도 허용 범위를 확인해야 한다. 현재 공유 후보에는 추가하지 않았다. 최종 문서 정제 후 전체 업로드 후보의 검사 범위·판정은 verification.json의 final_upload_review에 기록한다. 이는 모델/DB 테스트 재실행이나 제공자 허가 취득을 뜻하지 않는다. 기존 .gitignore 변경도 실제 커밋 전에 함께 검토한다.

## 커밋 준비 범위

원본/기존 구현 보존, 공유 JSON 파싱·허용 범위·절대경로/ID 패턴, Markdown 상대 링크, PNG 동일성·청크 무결성, Git ignore/미추적 상태를 검사한다. 결과는 [verification.json](verification.json)이다. Git add/commit/push와 모델/DB 테스트는 수행하지 않는다.
