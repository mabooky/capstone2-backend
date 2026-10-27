# 음악 DB·추천 상세 설계

## 공유용 축소 실험 데이터셋 v1 (2026-10-27)

사용자가 공유 권한 확보와 GitHub 포함을 명시한 이번 요청에 한해
`data/experiment-v1`의 실제 곡 ID·좌표 공유를 허용한다. 과거 공유 보류 기록과 구별하며
원본 DB/CSV/체크포인트는 계속 제외한다. 권한 확인의 범위와 제공되지 않은 허가 문서는
해당 폴더 README 및 manifest에 명시한다. 추가 오픈 라이선스를 추정하지 않는다.

- 27,948행의 고정 15열 문자열 배열 JSONL: 실험 ID·Spotify ID, 두 제공자 source ID,
  곡별 ReccoBeats source version, 원본 축 4개, 고유 정규화 축 6개.
- 동일한 MuSe source version과 정규화 템플릿 6개는 별도 normalization.json으로 분리한다.
- A/B1/B2/C1/C2를 기존 14필드로 복원하며 소수 반올림·공식 변경·검증 상태 변경은 없다.
- manifest는 바이트 수/SHA-256, 실험 namespace/미검증 상태, 출처·권한 기록을 보존한다.
- 개발용 API의 기본 소스는 dataset이다. 명시 source=pglite 또는 기존 experimentRoot
  설정은 레거시 조회를 유지한다. 운영 서비스 및 production 차단은 유지한다.

## 개발용 실험 API 계약 (2026-10-27)

- `POST /api/dev/music/recommendations`: NODE_ENV=development 및 ENABLE_DEV_MUSIC_RECOMMENDATIONS=true에서만 제공, 나머지는 404.
- 입력은 coordinateSpace=unit-interval-v1, view=A/B1/B2/C1/C2, valence/arousal=0~1 숫자, limit=0~100 정수의 필수 5필드다.
- 응답은 view/returnedCount/spotifyIds/reason과 coordinateSpace, experimental=true, verified=false, canonicalSongIds=false, idNamespace/datasetId를 포함한다. 메타데이터와 운영 songId를 만들지 않는다.
- 기존 실험 VIEW를 임시 DB 사본의 READ ONLY 트랜잭션에서 조회한다. 원본 DB·서비스 VIEW·검증 상태는 변경하지 않는다. 요청 오류 400, 데이터/런타임 누락 503, 잘못된 추천 데이터 500.
- 운영 RecommendationService와 분리한 DevExperimentService를 사용한다. 구체적인 실행·요청·테스트 안내는 integration/README.md를 따른다.

## Git 공유 범위 (2026-10-20)

공유 문서는 구현 계약·모델 정의·합성 테스트 절차와 MuSe 집계만 제공한다. 실제 Spotify ID·개별 곡 식별/좌표·외부 태그 가중치, 공개 조건이 미확정인 ReccoBeats 실측 분포·성공률·추천 수치는 제외했다. 생략은 원본 연구 결과의 변경이 아니다. .local 원본과 실험 결과는 그대로 보존한다.

공개용 결과·설치/검증 안내는 [reports/README.md](reports/README.md), [REPRODUCING.md](reports/REPRODUCING.md), 출처/보류 정책은 [SOURCES.md](reports/SOURCES.md)를 따른다. 공통 모집단/코호트 규모와 처리 상태는 프로젝트 메타데이터이며 제공자의 개별 데이터·성능 공개와 구분한다.

## MuSe 선정·매칭 편향 분석 (2026-10-20, 최신)

분석 코드는 `collectors/analyze_muse_selection.py`, `render_muse_selection.ps1`, `report_muse_selection.py`다. 기존 정규화·중복 판정·immutable SQLite 조회·PNG 렌더링을 재사용하며 새 `.local/muse-selection-bias-20261020-v1/`에만 결과를 저장했다. `REPORT.md`에 통계 정의·재현 명령·한계를 기록했다.

- 분석 단위: 전체 90,408행·ID 보유 61,902행·고유 ID 60,741개·공통곡 27,948개를 구분한다. 단일행 ID는 59,678개다. 중복 1,063그룹/2,224행(965그룹 V/A 충돌)은 대표행·평균 좌표를 만들지 않는다. 전체 ID 민감도는 원본행 가중치 `1/그룹행수`로 계산하고 확정 고유곡 분포와 구별한다. 미해결 ID별 좌표 선택에 따른 축별 평균/사분면 식별 범위도 제공한다.
- 전체 MuSe에서 확정한 이론 [0,9] 및 관측 V=[0.23500000000000001,8.475], A=[0.1081132075471698,7.27]을 모든 부분집합에 동일 적용한다. 부분집합별 범위 재산정은 없다. 평균·모집단 SD·가중 경험분위수·사분면·SMD·KS·W1 및 20/40/80-bin TV/JS를 저장했다. 확률 히트맵의 질량 정규화와 감정 좌표 정규화를 구별한다.
- 중첩 집합의 독립표본 p값은 산출하지 않는다. 유한 모집단 기술 통계와 단순무작위 비복원 추출의 분석적 참고값만 제공하며 실제 선정 설계의 인과/유의성 해석과 구분한다. 기존 25목표 반경 .4 주변 질량을 재계산해 B1/B2 반환 건수 50건을 대조했다. 원본행을 실제 추천 후보로 승격하지 않는다.
- 전역 평균 이동은 작지만 세부 밀도/희박 영역 차이는 남는다. 기존 동일 27,948곡 비교는 해당 집합에 조건부이며 전체 카탈로그 감정 정확도/청취 품질의 우열로 일반화하지 않는다. 실제 verified 상태·원본·기존 실험/추천 알고리즘을 변경하지 않는다.

## 5모델 수치 비교 실험 완료 (2026-10-20, 비교 실험 근거)

근거는 `.local/music-model-comparison-20261020-v1/REPORT.md`, `result.json`, 독립 집계 감사 `verification.json`이다. 실험 전용 v3 DB를 READ ONLY로 조회하고 검증된 14열 JSONL과 139,740행을 대조했다. 기존 TypeScript 추천 함수/실험 opt-in 어댑터를 새 로컬 build에 컴파일해 재사용했다. 모든 모델·모든 검색의 후보는 동일한 27,948곡이며 원본 음악/verified/서비스 데이터는 변경하지 않는다.

### 사전 고정한 실험 조건

- 목표 25개: V/A 각각 `{-1,-0.5,0,0.5,1}`의 완전 격자. 중앙 1·내부 사분면 4·내부 축 4·경계 16개, 난수 없음. 목표 목록과 ID는 `protocol.json`에 저장했다. 사분면에서 0은 양수 쪽이다.
- 공통 조건: 가중치 V=A=1, Euclidean 거리, Top-K=20, 제외 ID는 빈 목록(전 모델 동일 곡 집합), 초기 반경 0.05, 확대 배수 2. 동점은 기존 대소문자 구분 Spotify ID 순서다.
- 주 조건 `cap-0.4`: 최대 반경 0.4. 대조 조건 `coverage-control`: 최대 반경 √8. 각 조건 안에서 5모델의 모든 설정/목표가 동일하다. 본실험은 25목표×5모델×2조건=250개 모델 검색이고 중앙 목표 2조건을 추가 반복해 결정성을 확인했다.
- Top-K 중복률은 교집합/20이다. 부족·빈 목록도 분모 20을 유지하므로 반환량 영향을 받는다. Jaccard의 두 목록이 모두 비면 null, Top-1은 둘 다 비어 있지 않은 목표만 비교한다. 공유곡 순위 차이는 공유곡이 있는 목표에 조건부인 목표 균등 평균이다.

### 모델별 결과

공유 가능한 수치 비교는 reports/model-comparison-20261020/REPORT.md의 MuSe B1/B2 집계로 한정한다. A/C1/C2의 실제 거리·부족률·겹침률은 공개 조건 확인 전 공유 문서에서 제외했다. 모델 정의와 동일 조건 비교 절차는 유지한다.

| 모델 | 반경 .4 부족/빈 목표 | 전체 범위 평균 거리/확대 |
|---|---|---|
| B1 | 8/7 | 0.2776 / 2.44 |
| B2 | 4/4 | 0.2007 / 2.04 |

B1–B2 전체 범위 Top-20 중복률은 36.0%, Top-1 일치는 9/25다. 원본 전체 모델 결과·순위는 비공개 로컬 결과에 그대로 보존했다. 숫자는 새로 생성하거나 보정하지 않았다.

### 좌표 분포·동률·이상값

공유 분포는 reports/coordinate-distributions-20261020/의 MuSe B1/B2 집계를 참조한다. A/C1/C2의 실측 사분면·IQR·경계 노출·동률 수치는 로컬에만 보존한다. IQR 희귀 좌표를 오류로 자동 삭제하지 않고, 빈 결과의 정의되지 않는 통계는 null로 유지한다.

B1/B2 전체 범위 cutoff 동률 목표는 15/16개다. Spotify ID 동점 정렬은 재현성을 위한 것이며 청취 선호 우선순위가 아니다. 개별 곡 순위·좌표·거리·원본 PK는 공유하지 않는다.

### 재현·검증 및 해석 한계

`db/compare_local_models.mjs`가 기존 DB 조회기/어댑터/추천 함수를 재사용하고, `experiment_comparison_metrics.mjs`가 집계한다. `collectors/verify_model_comparison.py`는 DB를 열지 않고 저장된 순위·거리·중복률·집계 250검색/500쌍을 독립 재계산했다. 원래 통합 DB 1,008개·수집 보호 파일 323개 해시 불변, 입력 행 불변·실제 verified=0·외부 API/DB 연결 0이다. 검증 assertion 161,409개, 알려진 지표 fixture 8개와 빈 표본 통계 추가 검사, 기존 추천 테스트 22개, strict TypeScript 검사 PASS다. `pnpm build`는 pnpm 부재로 미실행이다.

재현은 기존 로컬 TypeScript로 `db/experiment_input.ts`를 `--ignoreConfig --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --rootDir src/music --outDir src/music/.local/새-비교-폴더/build`에 컴파일한 뒤 `node src/music/db/compare_local_models.mjs src/music/.local/새-비교-폴더`, `python -B src/music/collectors/verify_model_comparison.py src/music/.local/새-비교-폴더`를 실행한다. 새 출력만 허용한다. 목표/설정은 protocol, 입력·소스 SHA256와 요약은 result, 결과 파일 SHA256는 verification에 고정했다.

이 격자는 경계 목표가 16/25개인 인위적 설계다. 평균은 이 격자에 대한 값이며 일반화된 서비스 성능 추정치가 아니다. ReccoBeats Energy와 MuSe Arousal은 다른 출처 지표이고 정규화가 축 분포/거리를 바꾼다. 짧은 거리·높은 충족률·중복률로 감정 정확도나 청취 품질의 우위를 결론 내리지 않는다. 실제 목표 감정 적합도·Valence/Arousal 인지·개인 선호·익숙함/곡 버전·다양성/피로도는 모델명을 가린 무작위·순서 균형 청취 평가에서 별도로 수집해야 한다. 동일 자극의 모델 간 중복과 참가자별 반복 측정을 분석에 반영하고 음원/권한·평가 절차를 별도 확정한다. 이번에는 청취/재생/외부 수집을 하지 않았다.

다음 작업은 수치 보고서를 근거로 경계/중앙 목표와 중복·비중복 추천을 층화한 블라인드 청취 평가 프로토콜을 작성하는 것이다. 실제 서비스 승격은 독립 매칭 검토·권한 확인과 별개로 유지한다. 기존 프로젝트 종료 후 삭제 계획은 이번 비교 결과/빌드/보고서에도 적용한다.

## 동일 곡 집합의 로컬 추천 실험 데이터 (2026-10-20, 비교 실험 입력 근거)

최종 산출물은 `.local/music-experiment-20261020-v3/`다. 통합 원본 DB를 파일 단위로 복사한 `snapshot/pgdata`에서만 실험 객체를 생성했다. 원래 통합 DB 1,008개 파일과 수집 보호 파일 323개 SHA256는 불변이다. 중간 v1/v2 사본은 미완료이며 실험 입력으로 채택하지 않는다. 실제 verified 전환·외부 API/공유 DB·팀 백엔드·기존 추천 알고리즘 수정·commit/push는 없다.

### 테이블·영역과 FK의 의미

| 로컬 PGlite 영역 | 객체 | 실제 행 수 / 의미 |
|---|---|---|
| `music` | `songs` | 0, 승인된 canonical 곡 |
| `music` | `song_sources` | 118,356, MuSe 90,408 + ReccoBeats 27,948개의 원본 관측 |
| `music` | `emotion_scores` | 417,528, MuSe 361,632(소스당 4) + ReccoBeats 55,896(소스당 2) |
| 복사본의 `music_experiment` | `common_songs` | 27,948, 실험 ID·Spotify ID·두 원본 source PK의 명시적 매핑 |
| 복사본의 `music_experiment` | `model_a/b1/b2/c1/c2` | 각각 27,948행을 계산하는 VIEW, 점수 테이블에 추가 복제 적재하지 않음 |

원래 `music` 스키마의 FK 3개는 검증된 상태다. `emotion_scores.song_source_id → song_sources.id`는 점수 417,528행에서 고아 0을 확인했다. `song_sources.song_id → songs.id`와 `(song_id,candidate_spotify_id) → songs(id,spotify_id)`는 canonical 연결을 보호한다. 실제 모든 source의 song_id는 NULL이므로 이 연결은 보류이며, nullable 복합 FK의 검사를 통과하는 것을 곡 검증 완료로 해석하지 않는다. 실험 매핑은 별도 FK 2개로 실제 MuSe/ReccoBeats source PK를 참조하며 provider·Spotify ID·MuSe external_id 일치도 전수 검사했다.

### 실제 VIEW 0곡과 후보 집계

기존 `music.recommend_*`는 `songs`를 시작으로 verified+추천 선택된 source를 JOIN한다. songs=0·실제 source 전부 pending·선택=false·song_id NULL이므로 5종 모두 0곡이다. 실험 준비 전 후보 수는 이 상태를 승격하지 않고 candidate Spotify ID로 source와 필요한 score/버전을 연결하여 계산했다: A 27,948, B1/B2 각 59,678, C1/C2 각 27,948. B1/B2에서는 MuSe 중복 1,063그룹을 제외한다.

이번 비교 집합은 단일 MuSe 소스와 단일 ReccoBeats 소스가 같은 Spotify ID를 갖고, 저장된 MuSe external_id 참조까지 일치하는 27,948개다. MuSe 4점수와 ReccoBeats 2점수(총 167,688점)의 완전성·원본 raw 일치·정규화 일치를 검사하고, 5개 모델 모두 같은 매핑으로 제한했다. 중복 그룹에서 min/first/latest 대표 선정·평균·병합을 하지 않으며, 미반환/메타데이터 불일치/특징 부재 등 기존 보류 데이터는 이 ReccoBeats 적재 집합에 포함하지 않는다. 독립 검토 미완료의 pending 상태는 그대로이며 실험 허용이 실제 서비스 승인을 뜻하지 않는다.

### 모델별 전수 검증

| 모델 | 좌표 수 | V 최소~최대 | A 최소~최대 | 같은 좌표 그룹 / 초과 곡 |
|---|---:|---|---|---:|
| B1 | 27,948 | -0.913589 ~ 0.882222 | -0.938095 ~ 0.615556 | 1,270 / 9,714 |
| B2 | 27,948 | -0.962658 ~ 0.998786 | -0.952399 ~ 1 | 1,270 / 9,714 |

모든 모델의 결측·비유한·[-1,1] 위반·실험 곡 ID/Spotify ID 중복은 0이다. 곡 매핑 SHA256는 전 모델 `de595519b1665d54152b519c8e394f03b9cbac3faa426a281d64cfdafd8d7845`로 동일하다. 좌표 동률은 서로 다른 곡의 유효 관측으로 보존한다. C1/C2의 V/원본 PK는 A와, A/원본 PK는 B1/B2와 각각 일치한다. ReccoBeats는 정확 Decimal 비교, MuSe는 기존 SQL 범위를 재사용한 독립 Decimal 정규화와 오차 1e-15 이내 비교로 279,480개 축 좌표 검사를 통과했다. 수치/구조 검증이며 매칭·감정 품질의 독립 검증은 아니다.

### 실험 조회 및 TypeScript 입력 계약

- `db/004_local_experiment.sql`은 새 실험 복사본 전용 DDL이며 운영 migration 목록(기존 001~003)에 추가하지 않는다. `prepare_local_experiment.mjs`는 기존 `candidateAudit`/`fingerprints`/PGlite 도구를 재사용한다. 통합 검증기의 두 함수를 export하고 직접 실행 guard만 추가했으며 통합 로직은 유지한다.
- `common-songs.jsonl`은 실험 ID와 두 source PK 매핑이다. `A.jsonl`~`C2.jsonl`은 기존 `RecommendationViewRow`와 같은 14열이며 모든 ID/numeric 좌표·raw 점수는 문자열이다. source PK·버전·정규화 설정도 보존한다. 이 행의 song_id는 `music_experiment.common_songs.experiment_song_id`이고 `music.songs.id`가 아니다.
- manifest/envelope는 `dataset_kind=unverified-local-experiment-v1`, `id_namespace=music_experiment.common_songs`, `canonical_song_ids=false`, `verified=false`를 필수로 한다. `db/experiment_input.ts`의 `experimentRows`는 명시적 `allowUnverifiedLocalExperiment:true`가 있어야 기존 순수 TypeScript 추천 함수에 구조 호환 행을 전달한다. 서비스 repository/라우터에는 연결하지 않는다.
- `db/query_local_experiment.mjs`의 `openLocalExperiment`도 같은 opt-in을 요구하고 로컬 실험 snapshot만 연다. READ ONLY transaction에서 `model('A'|'B1'|'B2'|'C1'|'C2')`로 envelope를 반환한다. 별도 프로세스 재개봉 후 전체 139,740행이 JSONL과 일치했으며 실제 source/VIEW 상태는 유지됐다.
- 재현: `node src/music/db/prepare_local_experiment.mjs src/music/.local/새-실험-폴더` → `python -B src/music/collectors/verify_experiment_coordinates.py src/music/.local/새-실험-폴더` → 기존 로컬 TypeScript로 어댑터 컴파일 → `node src/music/db/test_experiment_input.mjs src/music/.local/새-실험-폴더` → `node src/music/db/query_local_experiment.mjs src/music/.local/새-실험-폴더`. 기존 출력은 덮어쓰지 않는다.

최종 요약은 v3의 `result.json`이고 상세 근거는 `manifest.json`, `decimal-verification-v2.json`, `algorithm-input-verification.json`, `database-query-verification.json`이다. 추천 기존 22개·실험 입력/guard/Top-10 51개 PASS, TypeScript strict NodeNext 검사 PASS. 기존 로컬 TypeScript 7 컴파일 시 `--ignoreConfig`와 새 `.local/music-experiment-runtime-20261020-v1/build`를 사용했고 기존 컴파일 산출물은 보존했다. `pnpm build`는 pnpm 부재로 미실행이며 전체 앱/서비스 연동은 검증하지 않았다.

다음 작업은 이 고정 공통 집합에서 목표 좌표·가중치·제외 조건·반경·Top-K를 동일하게 고정한 추천 비교 실험과 결과 기록이다. 실제 verified 전환은 별도의 원본별 독립 근거 검토·중복 처리·권한 확인이 필요하다. 기존 연구 데이터 보관/2026년 12월 프로젝트 종료 후 삭제 계획을 새 실험 사본·JSONL·빌드·보고서에도 적용한다. 이번에는 삭제하지 않는다.

## MuSe·ReccoBeats 격리 영속 통합 (2026-10-20, 실험 입력 근거)

사용자가 이번 단계에서 허용한 새 로컬 영속 DB 통합이다. 원본 수집 SQLite·기존 MuSe DB·SQL 001~003·5개 VIEW·추천 알고리즘·팀 백엔드는 변경하지 않는다. 공유 PostgreSQL/Railway/API/commit/push는 사용하지 않는다. 제공자 저장 권한 미확정과 운영/공유 이용 조건은 별도 미해결 사항으로 유지한다.

- 새 DB: `.local/music-integrated-20261020-v1/database/pgdata`, 기존 로컬 PGlite 0.5.10/PostgreSQL 18.6 파일 저장 사용. 기존 DB를 복사·덮어쓰지 않고 원본 산출물에서 새로 적재한다.
- 변환기: `collectors/stage_reccobeats_integration.py`. 최종 검증 v2 PASS와 보호 파일 SHA256 323개를 확인하고 최종 SQLite를 immutable/read-only로 읽는다. `memory_records`를 재사용하여 UUID·Spotify ID·관측 시각·소스 버전·원본 V/E 문자열·MuSe 원본 참조를 보존한다. 원문 API JSON을 재구성했다고 주장하지 않으며 raw_payload에 checkpoint 관측임을 표시한다. 새 staging 외에는 쓰지 않고 네트워크/외부 프로세스를 차단한다.
- 통합/검증기: `db/integrate_local_music.mjs`. 기존 `inputs`, `openDatabase`, MuSe `load`/`loadBatches`, `replayQuery`, 자연 키→PK 연결과 SQL을 재사용한다. 신규 ReccoBeats 2점수 배치 로더는 500개 소스 단위 트랜잭션으로 source PK를 받아 해당 배치 점수 FK를 해소한다. Node 네트워크 연결/fetch/http를 차단한다.
- 실제 적재: MuSe 90,408 sources/361,632 scores + ReccoBeats 27,948 sources/55,896 scores = **118,356 sources/417,528 scores**. `songs=0`, 실제 verified=0, 모든 실제 source는 pending·song_id NULL·추천 선택 false다. canonical 곡 연결은 독립 승인 전 수행하지 않는다. songs→source→score 연결 동작은 rollback되는 합성 fixture로만 검증한다.
- 고유 Spotify 후보 60,741개, 양쪽 좌표를 연결할 수 있는 고유 후보 27,948개다. MuSe ID 누락 28,506행·중복 1,063그룹/2,224행·1 미만 VA 333행을 그대로 보존한다. 중복 소스 병합·점수 평균·자동 대표 선정은 하지 않는다.
- 원본 점수는 numeric 입력 문자열로 보존한다. ReccoBeats V/E 각각 `reccobeats-v1`로 정규화하며 DB가 normalized_value를 생성한다. 55,896개 raw/normalized 값을 staging Decimal preview와 SQL numeric으로 정확 비교한다. MuSe는 기존 이론/관측 버전 4점수와 전체 원본 고정 범위를 재사용하고 기존 로더의 정확 raw 비교/정규화 오차 1e-15 검증을 적용한다.

### 재적재·중단/재개 계약

provider/external_id/source_version 자연 키와 score의 source PK/metric/normalization_version 키로 이미 적재된 행을 재사용한다. 기존 값이 다르면 `INPUT_CONFLICT`로 트랜잭션을 rollback하며 기존 행을 UPDATE하지 않는다. 원본 파일·SQL·staging 해시는 schema manifest와 대조한다. 진행 로그는 재개의 유일한 근거가 아니며 DB의 자연 키와 원본을 다시 대조한다.

MuSe 500 sources/2,000 scores 커밋 후 중단→별도 프로세스 재개, 이후 ReccoBeats 500 sources/1,000 scores 커밋 후 중단→재개를 수행했다. 전체 적재 후 재적재는 추가 sources/scores 모두 0이다. 초기 행 해시 검증의 문자열 PK 정렬 오류를 숫자 PK 정렬·전 행 수 대조로 수정했고, 이미 적재된 새 DB에서 controller 재개까지 검증한다. 기존 입력·DB·이전 실행 로그는 덮어쓰지 않는다. 재개 실행은 `runs/<UUID>/`에 새 근거를 남긴다.

```powershell
python -B src/music/collectors/stage_reccobeats_integration.py --output-dir src/music/.local/새-통합-폴더/reccobeats-staging
node src/music/db/integrate_local_music.mjs src/music/.local/새-통합-폴더
# 동일한 통합 DB의 중단 복구 또는 재적재 검증: 새 보고서 디렉터리 사용
node src/music/db/integrate_local_music.mjs --resume src/music/.local/기존-통합-폴더
# 완료된 resume/replay 근거가 있고 마지막 verify만 중단된 경우
node src/music/db/integrate_local_music.mjs --finish src/music/.local/기존-통합-폴더 src/music/.local/기존-통합-폴더/runs/UUID
```

### VIEW 후보와 실제 노출의 구분

실제 VIEW는 SQL의 verified+selected 조건을 적용한다. 후보 검증과 실제 서비스 노출을 구분하며, 공개 코호트 규모는 reports의 공통 집합 설명을 따른다. A/C1/C2의 원본 점수·후보별 분석 수치는 로컬에 보존한다. Hybrid 출처·PK·좌표 연결 검증은 모델 계약에 따라 수행하고 그 검사로 상태를 승격하지 않는다.

### 검증 기록 및 후속 조건

최종 **PASS** 근거는 `.local/music-integrated-20261020-v1/runs/333f56bc-995c-41b6-82a7-c6f30b238697/result.json`이다. 초기 경계 중단 2개 프로세스의 보고서와 재개/resume·replay·verify 3개 별도 프로세스 근거를 보존했다. 최종 검증 조회 지연으로 verify 작업만 종료 후 조회 통계/CTE를 개선하고 `--finish`로 마지막 단계를 재실행했다. 실제 적재 및 검증 로그를 초기화하지 않았다.

- 적재/좌표 관련 assertion 8,920,356개, hybrid 좌표/source PK 비교 223,584개 PASS. 재적재 추가 sources/scores=0, 재개봉 전후 모든 행의 숫자 PK 순회 SHA256 fingerprint 일치다.
- 신규 16개 제약/연결 사례 PASS: source 자연 키/PK·score UNIQUE/FK·songs PK/UNIQUE·복합 song/Spotify FK·미검증 canonical 연결/승격/선택 거부·원본/점수 불변·충돌 replay 거부·범위 위반 거부·합성 3테이블 및 VIEW 연결. 합성 fixture는 transaction rollback했고 실제 source 승격 0이다. 실제 score orphan=0, PK 3/FK 3/UNIQUE 4개 제약을 확인했다.
- 기존 `node src/music/db/validate.mjs` 합성 67개 PASS. 원본 보호 파일 323개 SHA256 불변, 외부 API/DB 연결 0이다. 새 Python AST/Node 구문 검사도 PASS다.
- `pnpm build`는 pnpm 명령 부재로 실행 불가이며 설치·공용 의존성 변경은 하지 않았다. 허용된 격리 DB 검증 결과를 운영 PostgreSQL의 동시성/성능/배포 검증으로 일반화하지 않는다.

다음 작업은 원본별 독립 매칭 근거(method/reference/reviewer) 검토·중복 그룹 해결·명시적 소스 선택이다. 승인 전 실제 source를 verified로 전환하거나 songs에 연결하지 않는다. 저장/재사용 조건과 팀 DTO·배포 계약을 확정한 후 별도 허용 범위에서 공유 통합을 검토한다. 기존 2026년 12월 프로젝트 종료 후 연구 데이터/통합 DB/산출물/백업 삭제 계획을 새 통합 경로에도 동일하게 적용한다. 이번에는 삭제를 수행하지 않는다.

## 전체 수집 최종 검증 기준 (2026-10-20, 통합 입력 근거)

이번 범위는 기존 파일 읽기 전용 검증과 문서 갱신이다. 아래 과거 준비·중단 기록의 수집 진행 상태는 이 절로 대체한다. 외부 API·공유 DB 접속, 기존 수집 데이터 변경, verified 전환, Git commit/push는 수행하지 않았다.

- 검증기: `collectors/verify_reccobeats_full_results.py`. 기존 `population`, `load_configs`/`normalize`, `distribution`, `readonly`/`digest`를 재사용한다. 체크포인트 생성자·수집 진입점은 호출하지 않으며 socket/외부 프로세스를 차단한다. WAL이 남은 원본은 무시하지 않고 거부한다. 출력은 새 `.local` 디렉터리만 허용한다.
- 최종 근거: `.local/reccobeats-final-verification-20261020-v2/verification.json`, PASS. `v1`은 검증기에서 comparisons에 없는 `id_match` 필드를 요구한 초기 오판 기록이며 채택하지 않는다. ID 일치는 기존 `matched_href` 상태로, 원본 연결은 comparisons의 external_id와 refs 대조로 확인하도록 수정했다. 원본 데이터 문제는 아니며 v1도 덮어쓰지 않았다.
- MuSe 전체 고유 ID 모집단과 원본 SHA를 대조하고 조회 완료 여부·미확정 작업·배치 자식 작업과 실제 요청의 구분을 검사한다. ReccoBeats 실측 요청량은 비공개 로컬 검증 결과에만 보존한다.
- 11,000~60,741의 51개 누적 SQLite 모두 integrity_check=ok, FK 오류 0. 각 직전 체크포인트(최초 10,000 포함)의 jobs/attempts/research_calls/research_features 전체 행이 다음 구간에 그대로 보존됐다. 보호 대상 수집·입력 파일의 전후 SHA256와 파일 목록도 일치한다.

### 매칭·결측·중복

검증기는 원본별 ID 연결·메타데이터 비교·좌표 결측/범위·중복/UUID 충돌·정규화 일치를 검사한다. 미반환·불일치·feature 부재를 구분하고 누락을 0으로 대체하지 않는다. 실제 조회·매칭률·상태별 수치·ReccoBeats 좌표 분석은 비공개 로컬 검증 JSON에만 보존한다. 이 검사는 실제 verified 승격을 대신하지 않는다.

### VIEW 사용 가능 수의 정의

현재 SQL `verified AND is_recommendation_source` 조건으로 노출 가능한 이번 실제 데이터는 **A/B1/B2/C1/C2 모두 0곡**이다. 아래는 상태 전환 없이 계산한 좌표·소스 조건 충족 후보 수이며, 공유 DB에서 조회한 결과나 승인된 곡 수가 아니다.

| VIEW | 좌표 출처 | 독립 검토·소스 선택 후 사용 가능한 보수적 후보 |
|---|---|---:|
| A | ReccoBeats V/E | 공개 보류 |
| B1 | MuSe V/A, 이론 0~9 | 59,678 |
| B2 | MuSe V/A, 전체 관측 범위 | 59,678 |
| C1 | ReccoBeats V + MuSe A 이론 | 공개 보류 |
| C2 | ReccoBeats V + MuSe A 관측 | 공개 보류 |

MuSe 전체 ID 연결 상한은 60,741곡/61,902행이다. B1/B2 후보는 중복 ID 1,063그룹을 전부 보류하여 59,678곡으로 산정했다. 중복을 원본별 검토·명시적 대표 소스 선택으로 해결할 경우 ID 기준 상한은 각각 60,741곡이다. 이번 ReccoBeats 좌표에는 이 중복 그룹이 없다. MuSe 모든 단일행 후보는 기존 SQL의 네 정규화 설정으로 범위 검증했고, 1 미만 점수도 유지했다. 5개 VIEW 공통 좌표 후보 교집합은 27,948곡이다. 자동 병합·평균·first/latest 대표 선정은 금지한다.

### 분포·이상값

ReccoBeats raw/정규화 값의 분포·분위수·사분면·경계·이상값 수치는 공개 조건 확인 전 공유하지 않는다. 원본 검증 JSON은 수정하지 않았다. 구현의 [-1,1] 범위 검사, 모집단 표준편차·분위수·IQR 정의 및 Energy를 Arousal 대리지표로 쓰는 모델 계약은 유지한다.

### 다음 DB 통합의 절차 제안 — 이번에는 실행하지 않음

1. 기존 제공자 저장/재사용 권한·rights_reference·보관/삭제 조건과 허용 환경을 확정한다. 최종 감사 JSON 및 입력 SHA256를 통합 manifest에 고정하고 원본 SQLite는 계속 읽기 전용으로 둔다.
2. 기존 `memory_records`·자연 키와 `load_muse_batches.mjs`/`persistent_muse.mjs` 구조를 재사용하는 ReccoBeats 변환기를 별도 구현한다. UUID를 external_id로, 버전·observed_at·원본 V/E 문자열·후보 Spotify ID를 보존한다. 산출물은 27,948 pending sources/55,896 scores이며 song_id=NULL·선택=false다. normalized_value는 INSERT하지 않고 기존 DB 정규화로 생성한다.
3. 기존 DB를 덮어쓰지 않는 새 격리 PGlite에 SQL 001~003과 기존 MuSe 90,408 sources/361,632 scores를 재사용한다. ReccoBeats 추가 후 기대 sources=118,356·scores=417,528, songs=0·VIEW 전부 0을 확인한다. 기존 로더를 그대로 ReccoBeats에 적용할 수 있는지는 별도 구현·검증 사항이다.
4. 자연 키→발급 PK 매핑, 원본별 pending/hold, 정규화 Decimal 대조, 중복 재적재 0건, 별도 프로세스 재개봉·rollback·제약 검증을 수행한다. 원본/manifest 해시 불변과 404/보류 곡 제외를 확인한다.
5. 실제 원본별 method/reference/reviewer 근거를 별도 검토하고 승인된 소스에만 canonical 연결·verified·명시적 provider별 선택을 적용한다. 중복 1,063그룹은 원본별 해결 전 보류한다. 승인 전후 VIEW 수와 5개 공통 교집합을 다시 실측한다. 이번 검증 결과만으로 상태를 승격하지 않는다.
6. 팀 DTO·좌표 변환·ReccoBeats ID 결측·duration 단위 및 배포 migration을 합의한 후, 별도 허용된 범위에서 공유 DB/백엔드 통합을 진행한다. 이 계획은 실행 권한을 부여하지 않는다.

## 전체 60,741-ID 수집 준비 (2026-10-18, 최신 범위)

이번 범위는 준비·오프라인 검증이며 실제 API 수집 시작은 포함하지 않는다. 기존 전체 모집단 기본 `live_transport` 잠금과 10,000개 전용 진입점의 상한은 유지한다. 후속 명시 실행용 `reccobeats_full.py --research-live`만 전체 연구 확대 경로를 사용한다.

- 기준 데이터: MuSe 원본 90,408행, 고유 Spotify ID 60,741개. 원본 SHA256 `56be88aea7dfa2c0446e0d7cc033d95c3550a3dc4364ac91c815cf998265fd2b`. `population()`의 기존 원본/정제 검증을 먼저 수행한다.
- 이전 완료 체크포인트는 읽기 전용 감사 및 인계 원본이다. jobs/attempts/research_calls/research_features의 보존과 재개 안전성을 검증하며 실측 매칭·확보량은 공유하지 않는다.
- 추가 대상은 기존 seed `muse-spotify-unique-100-v1`, `SHA256(UTF8(seed + NUL + ID))` 오름차순/ID 동점 순서의 10,001~60,741위다. 기존 10,000개와 교집합 0이며 전체와 합집합이 일치한다. 50,741개 목록은 `.local/reccobeats-full-preparation/additional-spotify-ids.txt`; LF 종료 UTF-8 바이트 SHA256은 `82a30e7507d2683aea6aff1a97912b8875e5e04a3e25eb7168287170fbe80c45`다.
- 실제 후속 경로 `.local/reccobeats-full-v1/`, 합성 경로 `.local/reccobeats-full-dry-v1/`는 분리한다. 실행 종류가 manifest에 고정돼 합성 상태를 실제 수집으로 재사용할 수 없다. 구간별 누적 11,000~60,000개, 마지막 60,741개 체크포인트와 `milestones.json`을 저장하고 실제 실행은 20요청마다 `progress.json`을 원자 갱신한다.
- 완료된 요청·미반환·불일치·보류 후보를 다시 요청하지 않는다. 기존 후보·jobs·attempts·calls·features와 원본 참조를 원자 인계하고, 매 구간 전후 기존 감사로 보존/정규화/무결성을 확인한다. 403·uncertain·실패 시 다음 구간으로 넘어가지 않는다. 강제 종료 inflight는 자동 재전송하지 않는다.
- 기존 최소 시작 간격 3초, 동시성 1, 403 sticky 중단, 429 Retry-After 전역 대기(재개 후에도 보존), 5xx/네트워크 작업당 최대 3시도와 엔진의 누적 시도 상한을 유지한다. 엔진 상한은 `Qmax=ceil(N/10)+N`, `Qmax+ceil(0.05*Qmax)`다. 전체 최종 상한은 70,157시도(기존 시도 포함)이며 실제 계획 요청량의 5%만 재시도하도록 제한하는 구현은 아니다. IP/UA/프록시/클라이언트 전환·호출 제한 우회는 없다.
- dry-run은 동일 모집단·원본 인계·체크포인트·연구 엔진에 `SyntheticProvider`와 가상 시계를 주입한다. PowerShell 전송·소켓·외부 프로세스 실행을 실패하도록 잠근다. 합성 좌표/반환율을 실측 커버리지로 해석하지 않는다. 기존 실제 결과에 새 합성 결과를 더한 값이며 실제 API 호출은 0이다.

추가 요청량은 미완료 metadata 배치 수와 적격 특징 작업 수로 산정한다. 실제 관측 확보율·시작 간격·checkpoint에 기초한 추정 수치는 공개하지 않고 기존 로컬 결과에 보존한다.

2026-10-18 공식 [이용 약관](https://reccobeats.com/docs/documentation/terms-of-service)과 [호출 제한](https://reccobeats.com/docs/documentation/rate-limiting)을 재확인했다(수집 API는 호출하지 않음). 무료 접근도 과부하/서비스 방해를 허용하지 않으며 제공자는 차단할 수 있다. 메타데이터는 Spotify 유래로 제3자 조건 준수 책임이 사용자에게 있다. 내부 제한 수치는 공개되지 않았고 429에서는 Retry-After를 확인해야 한다. 60,741개 일괄 수집·저장/재사용·필드별 TTL의 명시 허용은 미확인이다. 연구용 임시 보관도 해당 조건의 적용 대상이다. `.local` 밖 배포/공유 DB 편입 없이, 2026년 12월 실제 프로젝트 종료 직후 모든 기존/추가 데이터·중간/최종 체크포인트·WAL/SHM·목록·로그·보고서·내보내기·백업/동기화 사본을 삭제하고 잔존을 확인한다. 정확한 종료일/삭제 담당자 확정과 자동 TTL은 미구현이다.

PowerShell 실행/재개 명령은 collectors/README.md의 전체 확대 절을 따른다. 이번에는 `--prepare`, `--dry-run`, 테스트만 실행한다.

## 누적 10,000-ID 연구 검증 (2026-10-17, 이전 실행 범위)

- 최신 사용자 승인으로 기존 1,000개를 포함하는 **누적 고유 Spotify ID 10,000개까지만** 실행한다. 같은 SHA256 seed 순위의 2,000→3,000→…→10,000개 prefix를 사용하고, 매 구간에서 직전 완료 체크포인트의 요청·판정·점수를 원자적으로 인계한다. 기존 결과를 포함한 미반환/불일치는 재요청·대체하지 않는다. 메타데이터 배치 키에 누적 크기를 넣어 이전 요청 키와 충돌하지 않게 한다.
- `collectors/reccobeats_tenthousand.py`가 기존 `reccobeats_research.py`와 배치 엔진·PowerShell 전송을 재사용한다. 각 추가 1,000개에 대해 메타데이터→적격 후보 V/E 조회를 끝내고 다음 구간으로 진행한다. 전체 모집단 live 잠금은 유지하며 10,000개를 넘는 입력/CLI 옵션은 없다.
- 최소 시작 간격 3초, 429 Retry-After의 전역 대기, 네트워크/5xx 작업당 최대 3시도와 기존 총 요청 예산, 403 sticky 중단을 유지한다. 인계 시 미완료/실패/불확실/차단 작업이 있으면 진행하지 않는다. 재시도 소진·파싱/연결 오류·실행 예외가 나면 다음 구간으로 확대하지 않고 체크포인트를 보존한다. 강제 종료 시 inflight는 기존 규칙대로 uncertain으로 보류하며 자동 재전송하지 않는다.
- `.local/reccobeats-research/expansion-10000-v1/progress.json`에 약 20회 요청마다 진행 결과를 원자 저장하고 `milestones.json`에 1,000개 누적 완료 구간별 ID/메타데이터 일치율·좌표·오류·요청 수·활성 실행 시간을 기록한다. 각 구간 DB는 `fixed-2000-v1`…`fixed-10000-v1`에 저장한다. 과거 100/1,000개 폴더는 수정하지 않는다. 여러 구간의 API 구간 span을 합산할 때 과거 실행 사이 공백을 처리 시간에 포함하지 않는다.
- ID·UUID·모든 원본 제목/아티스트·유한 0~1·Decimal `2*x-1` 검증과 중복/충돌 보류를 유지한다. 모든 실제 소스 pending/hold·verified 전환 0, 음악/공유 DB 적재 0. 원본 MuSe·추천 알고리즘·팀원 백엔드는 수정하지 않는다.
- 완료 표본의 유효 V/E 비율과 평균 시작 간격·재시도율을 이용해 60,741개 확보량/활성 시간의 **조건부 점추정**을 기록한다. 필터 통과 비율이 모집단에도 유지된다는 가정이며 서버 제한·장애·새 충돌·미반환 변동에 따른 불확실성이 있다. 예상 곡 수는 verified 곡 수가 아니며 전체 수집 실행 권한도 아니다. 진행 중 미완료 구간의 V/E 비율은 최종 확보율 추정에 사용하지 않는다.
- 비상업적 대학 연구·단기 보관에도 이용 조건이 적용되며 제공자의 대량 수집/저장/재사용 허용은 여전히 미확인이다. 2026년 12월 실제 프로젝트 종료 직후 아래 기존 삭제 계획을 **이번 2,000~10,000개 중간/최종 체크포인트·진행/구간 보고서·내보내기·백업/동기화 사본에도 적용**한다. 모든 연구 산출물은 gitignored `.local` 내부에만 보관한다.

실행/재개: `python -B src/music/collectors/reccobeats_tenthousand.py --research-live`. 추가 API 없는 저장된 상태 조회: 같은 명령에 `--report-only`. 실제 `--max-requests 1` 경계 중단 후 재개를 수행했다. 신규 합성 3개 및 기존 77개 테스트 통과. 이후 아래 1,000-ID 절은 이전 실험 기록이다.

## 이전 연구용 1,000-ID 확대 실험 (2026-10-17)

- 비상업적 대학 캡스톤의 Valence–Arousal 추천 비교 평가에 한정한다. 사용자 승인 범위는 **누적 고유 MuSe Spotify ID 1,000개**이며 전체 모집단 live 잠금은 유지한다. 이전 100개는 아래 과거 실험 기록으로 보존한다.
- 기존 SHA256(seed + NUL + ID) 순위를 1,000개까지 확장한다. 기존 100개의 후보·완료 요청·매칭 판정·감정 좌표를 새 `fixed-1000-v1` 체크포인트로 원자적으로 인계한다. 이전 체크포인트는 수정하지 않는다. 완료된 미반환·불일치도 다시 요청하거나 대체하지 않고 추가 900개만 메타데이터 배치에 편성한다. 인계 후 재실행은 체크포인트에서 이어간다.
- 기존 PowerShell → Python 전송·파싱을 재사용한다. 최소 시작 간격 3초, 429는 Retry-After 전역 대기, 작업당 최대 3시도와 기존 총 요청 예산, 403은 즉시 sticky 중단이다. 클라이언트 전환·우회·자동 체크포인트 초기화는 없다. 메타데이터 단계 완료 후 엄격한 제목/아티스트 일치와 비중복 후보에만 UUID 특징 조회를 진행한다.
- Spotify href ID·UUID·모든 MuSe 원본 제목/아티스트·유한한 0~1 V/E 및 Decimal `2*x-1`을 검증한다. 중복·불일치·누락·UUID 충돌은 보류하며 실제 곡을 verified로 전환하지 않는다. 원격 제목/아티스트·원문 응답·오디오는 보관하지 않는다. UUID 충돌이 뒤늦게 발견되면 이전 연구 점수는 이력으로 보존하되 유효 좌표 분포에서 제외한다.
- 모든 결과는 gitignored `.local/reccobeats-research/`에만 임시 보관하며 외부 공유·서비스 운영·공유 DB 적재를 금지한다. 제공자의 대량 수집·저장·재사용 허용 범위는 여전히 미확인이다. **비상업적 연구와 단기 보관도 이용 조건의 적용 대상이며, 연구 목적·사용자 실행 승인·삭제 예정이 제공자의 권한 허용을 대신하지 않는다.**
- [공식 약관](https://reccobeats.com/docs/documentation/terms-of-service) 및 [호출 제한](https://reccobeats.com/docs/documentation/rate-limiting)을 확인했다. 수치 quota·연구 예외·임시 저장 TTL·자동 수집/재사용 권한은 명시적으로 확인되지 않았으며 허용으로 간주하지 않는다. 이번 1,000개를 넘는 실행은 별도 결정 없이 진행하지 않는다.

### 1,000-ID 실측 결과

이 단계의 실제 매칭률·특징 확보량·원격 응답 수·분포·실측 속도는 공개하지 않는다. 기존 .local/reccobeats-research/fixed-1000-v1/의 summary/verification과 체크포인트를 원본 그대로 보존한다. 재개·중복 요청 방지·원본 보존 계약은 위 구현 설명을 따른다.

### 2026년 12월 프로젝트 종료 후 삭제 계획

정확한 종료일은 팀이 확정하며, **2026년 12월 실제 프로젝트 종료 직후** 수집을 중지하고 연구 데이터·체크포인트·백업을 삭제한다. 현재 자동 TTL 삭제는 구현하지 않았으며 담당자가 실행·검증한다.

1. `.local/reccobeats-research/`의 기존 100개와 확대 1,000개 결과를 함께 목록화한다. `research_features`, 후보 ID/UUID/비교 판정, checkpoint.sqlite와 WAL/SHM, summary/report/verification, 임시 파일·내보내기·복사본을 포함한다.
2. 로컬 백업·외부 백업·동기화 사본 존재 여부를 확인하고 동일 데이터를 삭제한다. 불변 백업 등 즉시 삭제 불가 사본은 복원/재사용을 차단하고 만료·최종 삭제까지 확인한다. 코드나 원본 MuSe 전체를 이 삭제 범위로 오인하지 않는다.
3. 위 연구 데이터 및 연결 가능한 식별자·점수가 남지 않았는지 확인하고 원본 값을 포함하지 않는 삭제 확인 기록만 남긴다. 체크포인트 복원으로 재수집하지 않는다. 집계 결과의 후속 보존·공개 역시 이용 조건과 제공자 권한 확인 대상이다.


상태: VIEW 5종·정규화·파일 영속 PGlite·추천/DB/API 준비 모듈 구현. 추가 사용자 지시로 기존 100-ID 실험(5.3)을 재사용한 누적 고정 1,000-ID 연구 조회·임시 로컬 좌표 저장을 완료했다(위 최신 범위). 전체 모집단 수집·장기/운영 저장은 잠금·보류이며 공유 서버/팀 라우터 적용은 미수행이다.
MuSe는 The Musical Sentiment Dataset의 Zenodo v1.0.0 CSV 전체를 검증했다. 검증 대상 버전과 프로젝트 최종 채택 결정은 구분한다.

## 1. 데이터 모델

모든 객체는 PostgreSQL `music` 스키마에 둔다. 구현은 [db/README.md](db/README.md)와 001~003 SQL이다. PK는 bigint identity, 점수·범위는 원본 소수 문자열을 보존하는 numeric이다.

| 테이블 | 주요 필드 | 제약·역할 |
|---|---|---|
| songs | id, spotify_id, title, artist, duration_ms, created_at, updated_at | id PK, spotify_id NOT NULL UNIQUE. 저장이 허용된 메타데이터만 보관 |
| song_sources | id, song_id, provider, external_id, source_version, fetched_at, source_url, rights_reference, raw_payload | songs FK. 제공자별 원본·출처·권한 추적. raw_payload는 허용된 필드만 |
| emotion_scores | id, song_source_id, metric, raw_value, raw_min, raw_max, normalized_value, normalization_version | song_sources FK. 지표별 원본과 정규화 결과 분리 |

- 기존 컬럼명·PK·FK·UNIQUE를 유지했다. songs의 duration_ms는 비음수 integer, 시각은 timestamptz, raw_payload는 JSONB다.
- song_sources에 candidate_spotify_id, match_status, match_evidence, verified_at, is_recommendation_source를 추가했다. 검증 전 song_id는 NULL이며 동일 후보 Spotify ID의 원본을 별도 행으로 보존한다.
- verified는 song_id·후보 ID·검증 시각·근거(method/reference)가 필요하다. `(song_id,candidate_spotify_id)` 복합 FK로 songs의 Spotify ID와 일치를 보장한다. 실제 매칭 사실은 후속 검토 과정에서 확인해야 한다.
- 검증된 소스만 추천용 선택 가능하며 `(song_id,provider)` 부분 UNIQUE로 제공자별 선택 행을 하나로 제한한다. 검증 전 중복 병합·평균·임의 대표행 선택은 하지 않는다.
- emotion_scores에 normalization_config JSONB·created_at을 추가해 범위·산식·기준 모집단의 스냅샷을 보존한다. 설정 테이블을 추가하지 않고 테이블은 3개로 유지했다.

- provider: `reccobeats` 또는 `muse`; metric: `valence`, `energy`, `arousal`.
- song_sources의 `(provider, external_id, source_version)`을 고유 키로 적용한다. MuSe external_id는 원본 id이며 Spotify ID로 대체하지 않는다.
- emotion_scores의 `(song_source_id, metric, normalization_version)` 고유 제약으로 재수집 중복을 방지한다.
- normalized_value는 설정 범위로 계산하는 STORED 생성 열이다. NOT NULL 및 `CHECK (normalized_value BETWEEN -1 AND 1)`을 적용한다.
- raw_min < raw_max, 유한 숫자, 원본 범위를 검증한다. 잘못된 값은 조용히 보정하거나 적재하지 않는다.
- 필요한 좌표가 없으면 해당 점수 행을 만들지 않는다. 권한이 있는 원본 관측은 소스에 보존할 수 있다. MuSe 1 미만 값도 현재 승인 범위 안이면 유지한다.
- FK 조회 인덱스와 Spotify 고유 인덱스를 기본으로 한다. 별도 벡터 인덱스는 초기 필수 사항이 아니다.
- FK 삭제는 RESTRICT다. 점수 UPDATE/DELETE와 소스 identity/raw_payload 변경은 트리거로 차단하며 수정 관측은 새 source_version으로 추가한다. 같은 소스·지표의 여러 정규화 행에 다른 raw_value를 넣을 수도 없다.

## 2. Spotify ID 매칭

- ID/URI/URL 입력은 검증 후 트랙 ID로 통일하며 대소문자를 보존한다.
- 곡 제목·아티스트 유사도만으로 자동 연결하지 않는다.
- MuSe에서 Spotify ID가 없거나 유효하지 않은 행은 매칭 보류한다.
- ReccoBeats 외부 ID와 Spotify ID는 구분해 저장한다.
- 동일 ID의 중복 행은 출처와 버전을 비교한다. 상충된 점수는 임의 평균하지 않는다.
- 다른 발매판의 서로 다른 Spotify ID는 별도 곡으로 취급한다. 리링크 병합 정책은 미정이다.

### 2.1 후속 2단계 확정 정책: 원본별 판정·명시적 검토

정책 버전은 `source-scoped-review-v1`이다. 이번 확정은 프로젝트 내부의 오프라인 판정 기준이며 외부 제공자 권한이나 실제 verified 전환 승인을 의미하지 않는다. 구현은 collectors/matching_audit.py이며 네트워크·DB·상태 갱신 기능이 없다.

**중복 구조 실측** — 전체 원본 SHA-256 및 기존 정제 검증 기록을 확인하고 Spotify ID 대소문자를 보존해 그룹화했다. 제목·아티스트 비교는 기존 spotify_validate.canonical의 NFKC/casefold/공백 정리만 재사용한다. 구두점·악센트·괄호·live/remaster/feat 표시는 제거하지 않는다. 점수는 Decimal로 비교한다.

| 정규화한 메타데이터 충돌 유형 | 그룹 | 원본 행 | V/A 점수 충돌 그룹 |
|---|---:|---:|---:|
| 제목만 상이 | 870 | 1,824 | 804 |
| 아티스트만 상이 | 150 | 301 | 121 |
| 둘 다 상이 | 37 | 87 | 35 |
| 둘 다 동일 | 6 | 12 | 5 |
| 합계 | 1,063 | 2,224 | 965 |

그룹 크기는 2행 981개·3행 67개·4행 14개·5행 1개다. id를 제외한 CSV 전 필드가 완전히 같은 그룹은 0개다. Dominance까지 포함한 점수 충돌은 970그룹, 비어 있지 않은 MBID가 여러 개인 그룹은 304개다. MBID 결측은 충돌과 별도 집계하며 MBID 차이만으로 다른 녹음임을 단정하지 않는다. 이 수치는 원본 관측의 차이이며 잘못된 Spotify 매핑의 확정 건수가 아니다. 숫자 표기가 다른 동일 Decimal 값은 점수 충돌로 세지 않는다.

**판정 기준**

| 상황 | 판정 및 처리 |
|---|---|
| ID 누락·형식 오류 | 보류(hold). 원본 source 유지, song_id NULL·pending·미선택. 제목으로 ID를 추정하지 않는다 |
| HTTP 실패·미반환·리링크·응답 ID 불일치 | 보류. 미반환을 영구 삭제/존재하지 않음으로 판정하지 않는다 |
| ID와 정규화 제목·아티스트 일치 | 메타데이터 일치 후보일 뿐. 원본별 독립 근거 검토 전 보류. 기존 검증기의 success/엄격 일치 boolean은 DB verified와 다르다 |
| 제목/아티스트 불일치·복수 응답·중복 점수 충돌 | 보류. 부분 문자열·유사도·기호 제거로 자동 승인하지 않는다 |
| 동일 녹음에 대한 명시적 독립 검토 완료 | 검증 성공 후보(success). 정확한 provider ID 연결 및 원본 external_id+Spotify ID에 묶인 method/reference/reviewer/reviewed_at/same_recording=true가 필요하다. 불일치 해소 근거도 같은 검토에 포함한다 |
| 다른 곡/녹음임이 독립 근거로 확인됨 | 거절 후보(reject). 동일 원본·ID에 묶인 반증과 검토자가 필요하다. 제목 불일치·404·결측만으로 거절하지 않는다 |

아티스트는 기존 비교기와 같이 MuSe 원문 전체가 제공자 artists 목록의 한 이름과 정규화 후 일치하는지 비교한다. 협업 아티스트 문자열을 임의 분해하지 않는다. 독립 근거는 해당 녹음/발매판을 식별하는 허용된 자료의 reference와 검토 내용을 뜻하며 동일 API 응답의 반복 조회만으로 대체하지 않는다. 오프라인 assess는 근거 필드와 원본/ID 범위만 검사하며 진위는 증명하지 않는다. 결과의 success/reject는 검토 권고이며 실제 match_status는 항상 pending으로 출력한다. 권한 검토·실제 전환은 별도 작업이다.

**원본 보존·연결·전환 규칙**

1. songs는 검증된 Spotify ID당 하나이며 UNIQUE를 유지한다. 동일 ID 원본 여러 개를 같은 canonical song에 연결할 수 있으나 각 source를 개별 검토한다. 그룹 내 한 행의 성공은 나머지 행으로 전파하지 않는다.
2. song_sources는 `(provider, external_id, source_version)`별 관측을 보존한다. ID가 없는 행·거절된 매핑도 원본 삭제 대상이 아니다. 잘못된 후보 수정은 원본 raw_payload를 바꾸지 않고 정정 근거를 남기는 별도 검토가 필요하다.
3. pending→verified는 권한 확인 후 별도 명시적 작업에서만 수행한다. 같은 트랜잭션에서 songs의 ID 일치 확인, source.song_id 연결, match_evidence(method/reference 및 검토 정보), verified_at을 기록한다. SQL 복합 FK·CHECK를 충족해야 하며 자동 추천 선택은 하지 않는다.
4. pending→rejected는 원본별 확정 반증이 있을 때만 수행한다. song_id/verified_at은 NULL, 추천 선택 false를 유지하고 match_evidence에 거절 사유·근거를 남긴다. 근거 부족은 rejected가 아니라 pending이다.
5. verified의 검증 철회 시 추천 선택을 해제하고 song_id/verified_at을 NULL로 되돌리는 처리를 함께 수행한다. 새 근거로 rejected를 재검토할 때는 pending으로 재개한다. 이전 검토 이력을 덮어쓰지 않는 감사 기록 설계가 필요하며 이번에는 구현하지 않았다. 기존 SQL은 상태 형태만 제한하고 이 전환 순서·검토 진위·감사 이력까지 강제하지 않는다.
6. emotion_scores는 기존 source PK에 계속 연결한다. 원본 점수·정규화 설정·버전·생성 열을 수정/평균/삭제하지 않는다. 서로 다른 source의 점수를 합쳐 새 원본처럼 만들지 않는다.
7. 추천 소스 선택은 매칭 검증과 별도다. verified 소스 중 제공자별 하나를 명시 선택하고 선택 근거를 남긴다. 점수가 충돌하면 품질·녹음·버전 근거로 선택할 수 있을 때까지 미선택을 유지한다. 최신/최저 id/첫 행/평균을 자동 대표로 쓰지 않는다. 완전히 동일한 관측도 source를 합치거나 삭제하지 않는다.

**원본별 재검토의 비식별 설명**

가상 예시(실제 곡·관측 아님): SOURCE_A가 CANDIDATE_ID_A와 아티스트 표기는 같지만 버전 제목이 다르면 pending·추천 미선택으로 보류한다. 독립 녹음/발매 근거로 동일성을 확인하기 전에는 다른 ID로 교체하거나 자동 verified 처리하지 않는다. 실제 원본 ID·곡명·메타데이터 비교 표는 공유하지 않는다.

## 3. 원본 보존과 정규화

- 원본값·척도·데이터 버전·변환 버전을 함께 기록한다. 원본값을 정규화값으로 덮어쓰지 않는다.
- 사용자 승인 정책(2026-10-17): 목표 -1~1, ReccoBeats 0~1은 `2*x-1`, MuSe 이론 범위 0~9는 `2*x/9-1`을 사용한다. 이는 프로젝트 기준이며 사전 원평가 척도와 매칭률 문제를 해결했다는 뜻은 아니다.
- MuSe 관측 방식은 전체 원본 90,408행의 지표별 최소/최대로 `2*(x-min)/(max-min)-1`을 사용한다. 10,000곡 표본·매칭 성공·중복 제외 이후의 범위로 다시 계산하지 않는다.
- 관측 Valence 범위: `0.23500000000000001`~`8.475`, Arousal: `0.1081132075471698`~`7.27`. CSV를 Decimal로 읽어 기존 분석과 대조했다.
- 버전: reccobeats-v1 / muse-theoretical-v1 / muse-observed-v1. 설정은 002_normalization_v1.sql에 있고, 각 점수에 raw_min/raw_max·전체 설정 스냅샷을 복사한다. MuSe는 source_version=zenodo-4281165-v1.0.0, 전체 원본 SHA-256과 90,408행을 기록한다.
- 기준 변경은 새 버전·migration으로 추가한다. 기존 함수의 발급 설정을 덮어쓰거나 기존 점수를 갱신하지 않는다. VIEW가 참조하는 버전 변경도 명시적 migration으로 기록한다.
- 비정상 숫자·범위 역전·분모 0·원본의 설정 범위 이탈은 거절한다. 임의 클리핑·결측의 0 대체는 없다. MuSe 1 미만 점수의 제외 규칙은 도입하지 않았다.
- ReccoBeats Energy는 A의 세로축 대용 지표다. MuSe Arousal과 동일 측정치라는 가정을 두지 않는다.

## 4. VIEW 계약

| 논리 VIEW | 이름 | valence | arousal |
|---|---|---|---|
| A | music.recommend_a | ReccoBeats Valence (0~1) | ReccoBeats Energy (0~1) |
| B1 | music.recommend_b1 | MuSe Valence (0~9) | MuSe Arousal (0~9) |
| B2 | music.recommend_b2 | MuSe Valence (전체 관측 범위) | MuSe Arousal (전체 관측 범위) |
| C1 | music.recommend_c1 | ReccoBeats Valence (0~1) | MuSe Arousal (0~9) |
| C2 | music.recommend_c2 | ReccoBeats Valence (0~1) | MuSe Arousal (전체 관측 범위) |

- 공통 열: song_id, spotify_id, valence, arousal, 각 축의 source_id·source_version·normalization_version·raw_value·normalization_config. 좌표 열은 모두 -1~1이다.
- 양쪽 좌표가 유효한 곡만 반환한다. 결측을 0으로 대체하거나 다른 VIEW로 묵시적으로 전환하지 않는다.
- A/B1/B2의 두 지표는 동일하게 검증·선택된 소스 행에서 가져온다. C1/C2는 동일 song_id의 두 제공자 소스를 결합한다.
- 검증된 추천용 소스를 명시 선택하고 각 VIEW의 정규화 버전을 고정했다. 여러 소스가 있어도 최신 버전·첫 행을 자동 선택하지 않는다.
- 여러 버전의 직접 JOIN으로 중복되지 않도록 곡당 한 행을 보장한다.
- 5개 방식 비교 시 같은 교집합 곡으로 평가하고 VIEW별 커버리지도 별도 보고한다.

## 5. 수집과 전체 MuSe 로컬 처리 목표

권한 검증 → 배포본/버전 고정 → 허용된 표본 검증 → 중복 없는 확대 순서로 진행한다.
구현 범위를 구분한다: 기존 MuSe 로더는 메모리 DB 배치 트랜잭션·진행 로그까지, 기존 ReccoBeats probe는 최대 10곡 조회·2초 간격·오류 중단까지다. 이 두 기존 코드는 재개 기능이 없고 probe 자동 재시도는 0회다. 후속 3단계에서 별도 reccobeats_batch.py에 영속 체크포인트·재개·제한적 재시도를 구현했으며 실제 호출과 점수 저장은 잠겨 있다(5.1).
현재 승인 범위는 MuSe 원본 전체 90,408행의 정제·격리 로컬 배치 시험이다. 이론 0~9와 전체 원본 관측 범위 정규화 2종을 유지한다. 기존 고유 곡 10,000개 목표와 구분하며 5개 VIEW의 곡 수 확보를 보장하지 않는다.
집계 항목: 고유 곡 수, 제공자별 매칭률, VIEW별 유효 곡 수, 교집합, 결측·중복·오류 수.

전체 원본 보관 및 적재 대상은 `(provider, external_id, source_version)`별 song_sources 90,408행이다. candidate_spotify_id는 중복을 허용하고 점수 361,632행은 DB 발급 source PK로 연결한다. 원본 누락·중복 행을 삭제하거나 곡 대표행으로 선택하지 않는다.
canonical songs 적재 대상은 별도 검증 절차로 결정한다. 전체 고유 Spotify ID 60,741개(단일 원본 ID 59,678개·중복 그룹 1,063개)는 미검증 후보이며 현재 songs 적재 허용 수는 0개다. 같은 ID 원본들의 점수는 병합하지 않는다.
시험은 JSONL 순차 읽기·다중 행 INSERT·배치별 트랜잭션 및 COMMIT 후 원본/정규화 재검증을 사용한다. 배치 진행·성공 건수·시간·프로세스 최대 메모리는 .local에 기록한다. 메모리 PGlite는 종료 시 폐기하며 운영 PostgreSQL의 성능·내구성·동시성을 입증하지 않는다.

### 5.1 후속 3단계: 운영 배치 구조·오프라인 검증

3단계 구현은 collectors/reccobeats_batch.py, 테스트는 test_reccobeats_batch.py다. 기존 PowerShell transport/파서와 2단계 규칙을 재사용한다. 전체 모집단 CLI는 `--dry-run` 전용이며 LIVE_COLLECTION_ENABLED=false 및 Engine 기본 전송 차단을 유지한다. 후속 100개 연구만 별도 `--research-live` 분기를 추가했고 해당 제한/실측 결과는 5.3을 따른다. 아래 3단계의 전체 모집단 검증은 합성 전송 이력이다.

**전체 모집단·단계 분리**

- 기존 전체 정제 stats/validation 및 원본 checksum을 확인하고 Spotify ID 60,741개를 정렬해 고정 10개 묶음 6,075개 메타데이터 작업으로 등록한다. ID 관련 원본 61,902행·중복 1,063그룹을 모두 보존한다. 수집 체크포인트의 중복 요청 제거는 원본 병합이 아니다.
- 메타데이터 작업이 모두 정상 종료된 후 별도의 특징 작업을 계획한다. 미반환·복수 응답·잘못된 UUID는 특징 요청에서 제외한다. 같은 UUID에 다른 Spotify ID가 연결되면 양쪽 모두 격리한다.
- 중복 ID 전체 1,063그룹은 held_duplicate, 불완전/불일치 메타데이터는 held_metadata로 특징 큐에서 보류한다. 검토 없이 대표 원본을 선택하지 않는다. 단일 원본의 ID·메타데이터 일치도 진단용 특징 조회 후보일 뿐 verified 승격 근거는 아니다.
- 특징은 ReccoBeats UUID 경로로 조회하고 payload의 UUID·Spotify href를 다시 확인한다. Valence/Energy는 기존 Decimal 파서·0~1 검사·2*x-1 메모리 정제를 재사용한다. 결측/잘못된 값은 0 대체하지 않고 부분/실패로 기록한다.

**체크포인트·중복 방지·중단 복구**

- `.local/reccobeats-batch/<run>/checkpoint.sqlite`는 프로젝트 음악 DB와 분리된 로컬 진단 상태다. 후보 ID·원본 참조·UUID·충돌 분류·비교 boolean/hold·작업 상태·시도 횟수/HTTP 상태·대기 시각·검토 이벤트만 저장한다. 원격 제목/아티스트·응답 원문·감정 수치·SQL score 입력 객체는 저장하지 않는다.
- SQLite WAL+synchronous FULL, 원자적 트랜잭션, 작업 key/시도 번호 PK, OS 배타 잠금을 사용한다. 프로세스 종료 시 OS 잠금이 풀려 별도 stale-lock 삭제 없이 재개할 수 있다. manifest의 원본/모집단 fingerprint·버전·정책·설정이 다르면 재개를 거부한다.
- 요청 전 inflight·시도 번호를 커밋하고 응답 판정과 완료 상태를 함께 커밋한다. 동일 체크포인트 내 정상 완료 작업은 재전송하지 않는다. 새 경로의 별도 실행 간 중복까지 막는 전역 수집 이력은 없으므로 재개 시 같은 경로를 사용한다. 정상 경계 중단은 pending부터 계속한다.
- 전송 전후 강제 종료된 inflight는 재시작 시 uncertain으로 전환하고 자동 재전송하지 않는다. HTTP 서버와 로컬 커밋 사이의 exactly-once는 보장할 수 없다. 재시도는 retry_job의 명시적 중복 위험 확인과 이벤트 기록이 있어야 하며 남은 시도/전역 예산을 유지한다. 이는 저장된 감정 값을 복원하는 기능이 아니다.

**오류·호출 예산**

- 전역 최소 2초 직렬 간격을 체크포인트에 보존한다. 403은 blocked로 전체 중단하고 자동 클라이언트 전환/재시도를 하지 않는다. 재시작해도 명시적 검토 전 중단 상태다.
- 429는 Retry-After의 초/HTTP-date를 파싱해 전역 대기하며 길이를 임의로 줄이지 않는다. 잘못된/누락 헤더는 60초를 사용한다. 5xx/네트워크 오류는 지수 대기한다. 작업당 총 최대 3회, 전역 추가 예산은 상한 Q의 ceil(5%)다.
- Q=ceil(60,741/10)+60,741=66,816, 추가 3,341회, 총 상한 70,157회다. 실제 승인된 quota는 미확정이며 이 수치를 제공자 허용 한도로 해석하지 않는다.
- 404 등 다른 4xx와 잘못된 JSON/응답 식별자는 자동 재시도하지 않는다. 실패·403·uncertain의 수동 재개는 시도 횟수/대기/예산을 초기화하지 않는다. 메타데이터 요청 실패가 남으면 특징 단계를 열지 않는다.

**이번 검증 해석**

전체 dry-run의 전송기는 원본 참조로 만든 명시적 합성 fixture다. 실제 응답률·곡 일치율·감정 데이터 확보량을 측정한 것이 아니다. 중복 그룹 fixture의 첫 원본은 가짜 제공자 응답 구성에만 쓰며 실제 추천 소스 선택에 쓰지 않는다. 독립 근거가 없으므로 모든 원본 판정은 hold, 실제 verified는 0개다. 결과·시간은 STATUS에 기록한다. 제공자 허용 조건에 맞춘 점수 저장 sink/TTL/삭제/재사용 정책은 미구현이며 운영 배포·DB 적재는 이번 범위가 아니다.

전체 검증 완료: 60,741개 후보를 등록해 메타데이터 6,075개·특징 59,678개, 총 65,753개 합성 요청을 처리했다. 중복 ID 1,063그룹은 특징 보류, 모든 원본 61,902행의 판정은 hold다. 200개 작업 경계 중단 후 재개와 완료 후 추가 전송 0회를 확인했다. 신규 배치 18개+기존 51개 테스트가 통과했고 SQLite integrity_check=ok다. 결과는 .local/reccobeats-batch/full-dry-run-v1/summary.json·verification.json에 있다. 실제 호출·감정 점수 영구 저장·verified 전환은 0이다.

### 5.2 후속 4단계: MuSe 파일 영속 PGlite

환경은 기존 설치된 PGlite 0.5.10의 Node 파일시스템 backend다. 네이티브 PostgreSQL 서비스/컨테이너/드라이버를 설치하지 않으며 연결 URL·Railway·공유 서버를 사용하지 않는다. 구현은 db/persistent_muse.mjs, 실행 검증은 db/test_persistent_muse.mjs다. music 테이블 3개·VIEW 5개 SQL은 수정하지 않고 재사용한다.

- 원본/정제 결과/SQL 해시를 확인하고 전체 MuSe를 로컬 `.local/muse-persistent/stage4-v1/pgdata`에 저장한다. schema/input manifest는 DB 밖 sidecar로 유지한다. 최초 설치만 3개 SQL 본문을 단일 트랜잭션으로 적용하고 재실행 때 DROP/덮어쓰기/자동 migration은 하지 않는다.
- 기존 load_muse_batches의 500개 source·2,000개 score 트랜잭션 및 원본·정규화 전수 대조를 재사용한다. DB PK는 자연 키에서 조회한다. 동일 source의 모든 입력 컬럼이 같을 때만 재사용하고 점수는 같은 PK/metric/version·원본 값인지 확인한다. 이미 있는 행은 변경하지 않으며 누락분만 INSERT한다. 상충 관측은 INPUT_CONFLICT로 중단하고 현재 배치를 ROLLBACK한다.
- candidate_spotify_id 중복/누락·메타데이터/점수 충돌은 원본별 source/raw_payload에 보존한다. 대표곡/대표점수 자동 선택·평균·삭제는 없다. 모든 실제 source는 pending/song_id=NULL/verified_at=NULL/근거 NULL/추천 미선택이며 canonical songs는 0개다. ReccoBeats 데이터는 영속 적재하지 않는다.
- 검증은 서로 다른 OS 프로세스에서 500개 source 커밋 후 close, 전체 재개, 입력 전체 replay, 최종 재개봉을 수행한다. replay 추가 건수는 0이어야 하며 전체 행 ID/내용 fingerprint가 재개봉 전후 같아야 한다. PK/FK/UNIQUE·pending 선택 금지·근거 없는 verified 금지·원본/점수 불변·충돌 replay·트랜잭션 ROLLBACK·manifest 불일치를 검사한다. 실제 source를 verified로 바꾸는 양성 전환은 하지 않는다.
- VIEW 5종은 각 14열을 유지하며 실제 pending 데이터에서는 모두 정상 빈 결과다. 양성 결과와 축/출처/정규화는 기존 메모리 합성 SQL 검증 67개로 별도 확인한다. 이는 실곡 매칭·API/백엔드 연결 검증과 다르다.
- sidecar와 DB 커밋 사이 비정상 종료, 컨트롤러의 stale run.lock은 수동 확인 대상이다. 단일 프로세스/정상 close 재개봉 검증이며 네이티브 PostgreSQL 동시성·권한·배포·강제 전원 차단 복구는 미검증이다. 문서의 이전 메모리 적재 결과와 이번 파일 영속 결과를 구분한다.

최종 결과(2026-10-17): songs=0/sources=90,408/scores=361,632를 파일에 유지하고 별도 프로세스 4개의 재개봉·전체 입력 replay·제약 검증을 통과했다. 두 전체 replay의 추가 행은 0건이며 전수 assertion 8,137,812개·예상 거절 12건·정상 빈 VIEW 5종을 확인했다. 전체 행 fingerprint는 숫자 PK 순서로 계산하고 행 수까지 대조했다. 초기 검사 코드 정렬 오류 진단은 보존하고 수정 후 최종 PASS는 `.local/muse-persistent/stage4-v1/runs/35168d92-10a6-4a4a-b4ee-0b0148c44e96/result.json`으로 구분한다. 기존 메모리 합성 SQL 67개도 통과했으며 실제 source 승격/ReccoBeats 영속 적재는 없다.

### 5.3 연구용 고정 100-ID 실험 (2026-10-17)

이 절은 초기 연구 모드의 구현 계약이다. 기존 배치/PowerShell 전송·매칭·Decimal 처리·SQLite 체크포인트를 재사용하며, 고정 표본과 실행 모드의 범위를 검증한다. 최소 시작 간격 3초·429 Retry-After 전역 대기·작업당 최대 3시도·총 상한 116시도·403 sticky 중단은 구현 설정이며 실측 성능 수치가 아니다.

research_features의 좌표·관측 시각과 job 완료를 원자적으로 기록하고 원본 checkpoint를 초기화하지 않는다. 실제 소스는 hold/pending·미선택을 유지한다. 원격 응답·개별 곡과 실측 분포/성공률/비용 결과는 공유하지 않는다. 기존 .local/reccobeats-research/fixed-100-v1/의 결과와 체크포인트는 그대로 보존한다.

연구 실행 지시는 제공자의 저장·재사용·공개 허용을 대신하지 않는다. 이용 조건·보관/폐기 정책은 별도 확인하며 자동 TTL은 구현하지 않았다. 합성 fixture 검증과 실제 제공자 관측을 구분한다.

## 6. 추천과 기존 API 경계

- 구현: algorithm/recommend.ts의 recommend/compareViews. 입력은 해당 SQL VIEW 공통 14개 열, VIEW(A/B1/B2/C1/C2), 목표 valence/arousal(-1~1), limit, 제외 곡 ID다. DB 조회·매칭 상태 변경은 수행하지 않는다.
- 기준 점수: `wv*(v-targetV)^2 + wa*(a-targetA)^2`; 기본 가중치는 각각 1이며 음수/비유한/모두 0/오버플로 위험 가중치는 거절한다.
- 작은 점수 우선, 동점은 spotify_id로 정렬한다. 입력·가중치·limit은 런타임 검증한다.
- 거리 계산은 TypeScript 순수 함수로 분리한다. DB 조회 및 매장 상태 결합은 별도 계층으로 둔다.
- 대기열 제외 정보는 외부 입력으로 받는다. requestStatus는 songs에 저장하지 않는다.
- 반경은 기본 0.1부터 2배씩 확대하고 기본 상한 2*sqrt(wv+wa)로 전체 좌표를 포함한다. 경계는 포함한다. limit 충족 또는 지정 상한에서 종료, 최장 64단계이며 0 반경·극소 반경도 종료를 보장한다. limit는 0~100 정수(기본 100), 부족하면 실제 확보된 수만 반환한다.
- 원본 행/출처/정규화 설정을 반환하고 numeric은 거리 계산에만 JS number로 변환한다. bigint ID는 정밀도 손실 없는 문자열/bigint 또는 safe integer만 받는다. 결측·범위 오류·VIEW 버전 혼용·출처 충돌은 거절하고 0 대체/재정규화하지 않는다.
- 같은 곡의 완전히 동일한 VIEW 관측 반복은 결과 표시만 1개로 제한한다. 같은 ID의 좌표·원본·출처 충돌이나 Spotify ID→canonical ID 충돌은 오류로 거절한다. DB 원본을 병합/삭제하거나 첫 버전을 임의로 택하지 않는다.
- compareViews는 제외 조건 후 5개 VIEW의 동일 canonical song_id/Spotify ID 교집합만 사용하며 개별 커버리지도 보고한다. SQL VIEW의 verified/추천 선택 필터는 호출자의 신뢰 경계이고 함수가 실제 매칭을 검증하거나 승인하지 않는다.
- 현재는 전체 후보를 메모리에서 검증·한 번 정렬하는 O(n log n) 구현이며 DB 반경 쿼리/공간 인덱스 최적화는 미구현이다. 사용법과 합성 검증은 algorithm/README.md를 따른다.
- 기존 Track의 필수 reccobeatsId와 응답 좌표 척도는 통합 전에 합의한다. DB 타입을 그대로 응답하지 않는다.
- 초기 10,000곡에 대한 처리 시간 측정 후 조회·상위 K 선택을 최적화한다.

### 6.1 좌표 경계 계약 권장안 — 팀 합의 전

확인 사실: 기존 Track은 number 타입만 정의하며 0~1 런타임 검증·단위 선언은 없다. 현재 storeRouter 예시와 이번 작업의 전제는 API 좌표 0~1이다. DB VIEW와 RecommendationRequest는 -1~1이다. 아래는 기존 백엔드 코드를 변경하지 않는 후속 어댑터 제안이다.

| 경계 | 권장 처리 |
|---|---|
| API 입력 → 추천 목표 | 두 축 각각 `internal = 2 * api - 1`; 유한 number 및 0~1 검증 후 한 번만 변환 |
| DB VIEW → 추천 후보 | 이미 -1~1이므로 재변환하지 않는다. SQL numeric 소수 문자열을 그대로 넘긴다 |
| 추천 행 → API 응답 | 각 축 `api = (internal + 1) / 2`; -1/0/1 → 0/0.5/1. 원본 점수·DB 생성 열은 변경하지 않는다 |
| 부정확한 입력/결측 | NaN/무한대/범위 밖/결측을 거절한다. clamp·0 대체·범위 자동 추정 없음 |
| 거리·반경 | 현재 알고리즘의 -1~1 척도를 사용한다. 거리/반경을 기존 Track 좌표 단위로 혼용하지 않는다 |

추천 API에는 view 및 coordinateSpace(예: `unit-interval-v1`)를 명시하는 응답 envelope를 권장한다. 실제 이름·경로·배치는 팀 미확정이다. B1/B2/C1/C2의 0~1 값은 선택된 정규화 좌표를 재표현한 값이며 Spotify/ReccoBeats 원본 값과 동일하다는 뜻이 아니다. Energy는 A에서 arousal 대리지표로 쓰며 MuSe Arousal과 의미가 완전히 같다고 보지 않는다. 원본/정규화 버전은 내부 결과에 보존한다.

대안은 별도 추천 API가 -1~1을 그대로 노출하고 클라이언트가 변환하는 것이다. 서버 경계 변환을 권장하며 후속 5단계의 별도 초안 모듈(6.4)에서 구현·검증했다. 기존 팀 API에는 합의 전 적용하지 않는다.

### 6.2 VIEW ↔ TypeScript 형식 호환성 — 코드 대조 결과

003_recommendation_views.sql의 RETURNS TABLE과 RecommendationViewRow는 아래 14열이 일치한다. VIEW A/B1/B2/C1/C2의 정규화 버전 조합도 알고리즘 VERSIONS와 일치한다.

| 열(개수) | SQL → TypeScript 전달 권장 |
|---|---|
| song_id, valence_source_id, arousal_source_id (3) | bigint → 양의 정수 문자열. 안전 범위를 넘는 JS number로 변환 금지 |
| spotify_id (1) | text → string |
| valence, arousal (2) | numeric → 소수 문자열, 값 범위 -1~1 |
| valence_raw_value, arousal_raw_value (2) | numeric → 원본 소수 문자열 |
| valence_normalization_version, arousal_normalization_version (2) | text → string |
| valence_source_version, arousal_source_version (2) | text → string |
| valence_normalization_config, arousal_normalization_config (2) | jsonb → 파싱된 JSON 객체. 드라이버가 문자열 반환 시 어댑터에서 명시 파싱 |

recommend 입력은 VIEW 행 배열과 목표 좌표/VIEW/limit/제외 ID 등이다. 결과는 `view, tracks[{row,distanceSquared,distance}], steps, availableCandidates, duplicateRowsIgnored, reason`이며 Track[]와 직접 호환되지 않는다. 행의 numeric 문자열은 그대로 반환되므로 API 좌표 변환 시 별도 유한 숫자 변환이 필요하다. bigint는 JSON 직렬화 전에 문자열로 통일하는 것을 권장한다. VIEW 이름은 VIEW_NAMES 허용 목록으로 선택하고 외부 문자열을 SQL 식별자로 직접 연결하지 않는다.

현재 소스 strict 검사 및 5종 합성 호환성/비교 테스트는 통과했다. 후속 5단계에서 로컬 영속 PGlite의 빈 결과와 별도 메모리 합성 데이터로 DB 어댑터의 text/jsonb 전달·추천 흐름까지 검증했다(6.4). 네이티브 pg client·실곡 양성 종단 흐름은 미확인이다. verified/추천 선택 조건은 SQL VIEW의 신뢰 경계로 유지하고 어댑터가 pending을 승격하지 않는다.

### 6.3 Track 표시 필드·미확정 선택지

| 기존 Track 필드 | 차이와 권장안 |
|---|---|
| spotifyId | row.spotify_id를 매핑. song_id는 내부 canonical ID로 별도 유지하며 둘을 혼동하지 않는다 |
| reccobeatsId | VIEW에 없으며 source_id는 DB PK이므로 UUID 대체 불가. 검증된 ReccoBeats 소스 external_id를 별도 조회해야 한다. MuSe 전용 곡은 없을 수 있다 |
| title, artist | VIEW에 없음. 허용된 songs 메타데이터를 canonical song_id로 결합. 필수값 부재 정책은 팀 결정 필요 |
| duration | SQL은 nullable duration_ms. 기존 예시 207959는 ms와 부합하지만 타입에 단위 없음. API도 ms(비음수 정수) 명시 권장. 결측을 0으로 위장하지 않는다 |
| albumImageUrl | 기존 테이블/VIEW에 전용 필드 없음. 권한이 확인된 별도 메타데이터 공급 또는 nullable 필드 권장. 임의 URL/새 수집 없음 |
| valence, arousal | 6.1의 경계 변환. 원격 원본 값을 그대로 대입하지 않는다 |
| requestStatus | 매장/대기열 문맥에서 계산. 추천 함수가 제공하지 않는다. already-queued 우선 여부·out-of-mood 판정 반경·제외 시 응답 정책은 팀 합의 필요. 전부 available로 기본화하지 않는다 |

선택지 ① 기존 Track 그대로 유지하고 필수 필드가 완비된 곡만 응답: 호환성은 유지되나 MuSe 전용 곡을 제외하고 100곡 미만일 수 있다. 선택지 ② 별도 추천 DTO에서 reccobeatsId/duration/albumImageUrl 등의 결측을 명시적으로 nullable 처리하고 매핑 계층을 둠: B1/B2 독립 사용과 원본 보존에 유리하므로 권장한다. 기존 Track 타입을 일괄 변경하거나 빈 문자열/가짜 UUID로 채우지 않는다. DTO 도입·프런트 대응·필수 메타데이터 결측 정책은 팀 승인 전 확정하지 않는다.

### 6.4 후속 5단계: DB 어댑터·추천 서비스·DTO 초안

구현 전 실제 파일 DB를 READ ONLY로 점검했다. music.songs 0행은 canonical 곡, music.song_sources 90,408행은 원본 관측, music.emotion_scores 361,632행은 원본당 4개 정규화 점수다. 점수 FK는 song_sources.id를 참조하며, pending source의 song_id NULL은 정상이다. song_sources→songs의 단일/복합 FK와 emotion_scores→song_sources FK 총 3개가 validated이고 고아·ID 충돌·비pending source는 0이었다. 구조 불일치가 없음을 확인한 후 구현했다(근거 `.local/api-validation/stage5-v1/gate.json`).

구현은 integration/dto.ts·repository.ts·service.ts다. 기존 algorithm/recommend.ts와 SQL 3개는 수정하지 않는다. DB client를 주입받고 VIEW_NAMES 허용 목록만 조회하며 제외 ID는 `$1::bigint[]`로 바인딩한다. 단일 SELECT에서 14열과 songs 표시 정보/검증·선택된 ReccoBeats external_id를 결합해 동일 snapshot을 사용한다. 조회 단계에서 임의 LIMIT 100을 적용하지 않고 전체 후보를 기존 거리/반경 알고리즘으로 정렬한 뒤 상한 100을 적용한다. raw pending source를 fallback 조회하거나 verified로 갱신하지 않는다.

| 계약 | 구현 초안 |
|---|---|
| 입력 | coordinateSpace='unit-interval-v1', view=A/B1/B2/C1/C2, valence/arousal 유한 number 0~1, limit 선택(기본 100, 0~100 정수), excludeSongIds 선택(양의 bigint 범위 정수 문자열 배열) |
| 서버 문맥 | 매장 대기열 canonical song ID를 RequestContext.excludeSongIds로 주입. 클라이언트 제외와 합쳐 중복 제거. 권한/대기열 조회 자체는 팀 백엔드 책임 |
| 내부 좌표 | 목표만 2*x-1 변환. DB VIEW는 이미 -1~1이며 재변환하지 않음. JSONB 파싱·ID/numeric text 전송 후 기존 recommend 검증 재사용 |
| 출력 envelope | coordinateSpace, view, tracks, returnedCount, reason. 0건/부족/limit=0도 정상 결과이며 0으로 패딩하지 않음 |
| track | songId/spotifyId/reccobeatsId/title/artist/durationMs/albumImageUrl/valence/arousal/normalization. ID 문자열, durationMs 및 reccobeatsId null 가능, albumImageUrl 현재 null, 좌표 (x+1)/2로 0~1 재표현 |
| 정상/오류 | HTTP bridge: 200 정상/빈 배열, 400 입력 오류, 503 DB 조회 실패, 500 데이터 불일치/서버 문맥 오류. SQL/접속 오류 원문 비노출. DB 실패를 정상 빈 결과로 숨기지 않음 |

이는 후속 1단계 권장안을 구현한 **별도 추천 endpoint용 초안**이며 기존 Track/라우터 계약을 변경하거나 팀 합의가 완료됐다는 뜻이 아니다. requestStatus는 계산하지 않고 이미지/UUID도 위조하지 않는다. 같은 14열 관측 반복은 기존 recommend가 표시만 중복 제거하고 좌표/출처/표시 메타데이터 충돌은 500으로 중단한다. 출력은 JSON 직렬화 가능한 string/number/null뿐이며 내부 bigint/원본 응답 객체를 노출하지 않는다.

검증: 신규 18+기존 추천 22=40개 테스트 통과, strict TypeScript 컴파일 통과. 별도 메모리 합성 125곡의 실제 SQL VIEW 5종에서 추천 순서를 기존 함수와 대조했다. 실제 영속 DB의 모든 VIEW는 READ ONLY 조회로 0곡 정상 결과를 확인했고 실제 음악 상태는 유지했다. 전체 앱 noEmit 검사는 기존 루트 의존성 부재로 14개 진단이 남아 있다. 실제 pg 클라이언트·HTTP 서버·매장 권한/대기열 연동·대규모 실곡 성능은 미검증이다.

라우터 예시와 팀 변경 목록은 integration/README.md를 따른다. 제안 경로는 기존 mount 아래 POST /api/stores/:storeId/recommendations이며 이번에 등록하지 않았다. 팀은 승인 DB client/수명주기·대기열 ID 공급·별도 DTO/null·매장 권한/상태 정책을 합의한 뒤 서버에서 연결해야 한다. 이미 있는 express.json은 중복 추가하지 않는다.

## 7. 데이터 출처·접근·권한 검증

아래는 조사 당시의 결과와 승인 전 정책 검토 이력이다. 정규화 보류·관측 범위 금지 등 과거 제안은 현재 사용자 승인으로 1~6절의 정책으로 대체되었다. 원본 태그 미확보·감정/매칭률 혼합 등의 데이터 품질 한계는 해결되지 않았으며 별도 연구 항목으로 유지한다.

확인일: 2026-10-17. 기존에 확인한 약관 내용은 재사용했다. MuSe CSV는 전체 다운로드·분석했으며, Spotify/ReccoBeats 인증 API 호출은 수행하지 않았다.

### 7.1 MuSe

**확인된 사실**
- [저자 공식 Zenodo 배포본](https://zenodo.org/records/4281165): v1.0.0, 2021-03-01, 설명상 90,408곡. 현재 Kaggle 버전과 동일한 파일이라고 보지 않는다.
- 실제 다운로드 경로: [CSV](https://zenodo.org/records/4281165/files/muse_dataset.csv?download=1), [JSONL](https://zenodo.org/records/4281165/files/muse_dataset.jsonl?download=1).
- CSV 전체를 `src/music/.local/music-muse/zenodo-4281165-v1.0.0/muse_dataset.csv`에 원본 그대로 보관했다. 10,026,011바이트, 90,408행(헤더 제외), 8컬럼이다.
- [공식 레코드 API](https://zenodo.org/api/records/4281165)에서 이전 확인한 라이선스는 `cc-by-4.0`이다. 전체 파일 MD5가 게시값 `fd653643f1fdcec68cfdbbe98fc979d0`과 일치한다. SHA-256: `56be88aea7dfa2c0446e0d7cc033d95c3550a3dc4364ac91c815cf998265fd2b`.
- 배포 설명은 Spotify ID를 약 68% 곡에 대한 잠정 매칭으로 명시한다. ID 컬럼 존재가 정확성·현재 API 조회 성공을 보장하지 않는다.
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)은 복제·재배포·변형과 상업적 재사용을 허용한다. 저자/출처·라이선스 링크·변경 사실 표시 등 조건이 있다.

**사용 판단 / 미확정**
- 해당 라이선스 범위의 배포 데이터는 대량 다운로드·장기 보관·재사용 후보로 사용할 수 있다. 추가 API 데이터·오디오·이미지·Last.fm 태그까지 허용되는 것은 아니다.
- 실제 관측 범위·분포는 아래에 기록했다. 사전 평가 척도는 1~9지만, 2020년 원문은 미매칭 태그에 V/A/D=0을 부여한다. 이를 포함한 가중평균은 1 미만 값을 설명할 수 있다. 실제 분모 구현·행별 태그 재현·최종 축 방향 검증은 구분한다(7.1.4~7.1.7).
- [Kaggle 배포처](https://www.kaggle.com/datasets/cakiki/muse-the-musical-sentiment-dataset)는 이번 접근에서 본문/컬럼을 추출하지 못했다. 이전 확인된 CC BY 표기 외에 현재 버전의 전체 컬럼은 확정하지 않는다.
- [저자 저장소](https://github.com/cakiki/themusedataset)의 dataset.ipynb는 점수 컬럼을 사용하는 탐색 코드다. 2021년 논문에 이어 2020년 원문도 확보해 미매칭 태그의 0 처리 설명을 확인했다. 기존 조사에서의 범위 모순 해석은 7.1.7로 보완한다.
- 다음 확인: 채택 버전 선택, 해당 버전 점수 생성식·척도 근거 확보, 1 미만 값 원인 및 중복 Spotify ID 처리 정책 검토. 실제 Spotify API 매칭 정확성은 미검증이다.

#### 7.1.1 CSV 전체 검증 결과

분석은 Python 표준 라이브러리 csv/statistics로 수행했다. 원본을 변경하지 않았으며 분석 전후 SHA-256이 같다.
CSV 자체에 타입 선언은 없다. 아래 타입은 결측이 아닌 전체 값의 파싱 결과다.

| 컬럼 | 추론 타입 | 결측 행 |
|---|---|---:|
| id | 정수 | 0 |
| track | 문자열 | 0 |
| artist | 문자열 | 0 |
| valence_tags | 실수 | 0 |
| arousal_tags | 실수 | 0 |
| dominance_tags | 실수 | 0 |
| mbid | 문자열 | 28,784 |
| spotify_id | 문자열 | 28,506 |

결측 판정은 공백/빈 문자열 또는 대소문자 무시 nan/null/none/na/n/a이며, 실제 결측은 모두 빈 문자열이다.
세 점수 컬럼 모두 숫자 변환 실패·NaN·무한대는 0행이다. id는 90,408개 모두 고유하다.

| 통계 | Valence | Arousal |
|---|---:|---:|
| 최소 | 0.235000 | 0.108113 |
| 최대 | 8.475000 | 7.270000 |
| 평균 | 5.453879 | 4.317195 |
| 모집단 표준편차 | 1.552985 | 1.154653 |
| 1백분위 | 1.715000 | 1.500000 |
| 25백분위 | 4.280000 | 3.528000 |
| 중앙값 | 5.650000 | 4.330000 |
| 75백분위 | 6.695476 | 5.150000 |
| 99백분위 | 8.000000 | 6.900000 |
| 1 미만 행 | 112 | 289 |
| -1~1 밖의 행 | 90,293 | 90,116 |

분위수는 정렬 후 `(n-1)*p` 위치의 선형 보간이다. 원본 소수값은 반올림하지 않고 유지하며 표만 소수 6자리로 표시했다.
Valence의 가운데 50%는 4.28~6.695476, Arousal은 3.528~5.15다. 동일 좌표의 여러 곡을 중복 곡으로 판단하지 않는다.

| Spotify ID·중복 지표 | 결과 |
|---|---:|
| ID 포함 행 / 전체 | 61,902 / 90,408 (68.4696%) |
| ID 결측 행 | 28,506 (31.5304%) |
| 포함 ID의 22자리 영숫자 형식 적합 행 | 61,902 (형식 오류 0) |
| 고유 Spotify ID | 60,741 |
| 중복 Spotify ID 그룹 | 1,063 |
| 중복 그룹에 속한 행 / 고유 ID 대비 초과 행 | 2,224 / 1,161 |
| 서로 다른 track/artist 문자열을 가진 중복 ID 그룹 | 1,063 |
| Valence 또는 Arousal 값이 다른 중복 ID 그룹 | 965 |
| 완전히 동일한 CSV 행 / 동일 id 중복 | 0 / 0 |
| track+artist 원문 일치 중복 | 0 |
| NFKC·casefold·연속 공백 정리 후 track+artist 중복 후보 | 13그룹, 26행 (초과 13행) |

중복 그룹은 개수 2 이상인 키, 초과 행은 각 그룹의 `행 수-1` 합계다. 이름 정리 결과는 검토 후보이며 같은 녹음이라는 증거가 아니다.
Spotify 형식 적합은 실제 곡 매칭/활성 상태 검증이 아니다. 공유 ID의 표기 차이와 잘못된 매칭도 현재 구분되지 않는다.
비중복 Spotify ID는 59,678개다. ID와 유한한 VA가 있는 고유 ID 60,741개는 후보 규모이며 즉시 적재 가능한 확정 곡 수가 아니다.

#### 7.1.2 -1~1 정규화 적용 검토

- 항등 변환과 0~1 전제의 `2*x-1`은 이 파일 전체에 적용할 수 없다.
- 1~9를 가정한 `(x-5)/4`도 Valence 최소 -1.191250, Arousal 최소 -1.222972를 만들어 범위를 벗어난다. 적어도 한 축이 1 미만인 행은 333개(두 축 모두 68개), 그중 Spotify ID 보유 행은 239개다.
- 관측 최댓값만으로 척도를 정하지 않는다. 0 처리 포함 가중평균의 수학적 범위 0~9는 원문 절차에서 따로 검토한다(7.1.7). 1 미만 값을 오류라고 확정하거나 임의 삭제·클리핑하지 않는다.
- 관측 최소/최대 기반 min-max는 기존 표본 의존 정규화 금지 원칙에 맞지 않으므로 채택하지 않는다.
- 원본 보존 및 정규화 결과 -1~1 계약은 유지한다. 0 처리와 가중 매칭률에 따른 의미·축 방향·예외 처리 정책이 확정될 때까지 변환·점수 적재는 보류한다. `raw_min/raw_max`에 관측 최솟값/최댓값을 이론적 척도처럼 기록하지 않는다.
- 후속 검토안: 중복 ID 1,063그룹을 우선 격리하고 333행을 척도 검토 대상으로 별도 표시한다. 자동 평균·대표행 선택은 하지 않는다. 기존 테이블/VIEW 구조는 변경하지 않았다.

#### 7.1.3 로컬 보관·재현

- 루트 `.gitignore`의 `/src/music/.local/` 규칙으로 원본·분석 파일을 제외한다. 음악 영역의 `.env`·개인 키·secrets·Python 캐시도 제외한다. 기존 `.git/info/exclude`의 이전 위치 전용 규칙은 제거했다.
- 원본 옆 `provenance.json`에 저자 Christopher Akiki·Manuel Burghardt, 배포 URL·버전·라이선스·해시·수신 시각을 기록했고 README에 귀속과 원본 무변경을 명시했다.
- 집계는 원본과 별도 `analysis.json`에 저장했다. 저장소 루트에서 재현: `python src/music/.local/music-muse/analyze.py`. 스크립트는 자신의 위치를 기준으로 데이터 경로를 계산하므로 로직 수정은 필요 없다.
- 문서는 `src/music/` 직속, 향후 Python 수집 코드·SQL·TypeScript 추천은 각각 `src/music/collectors/`, `src/music/db/`, `src/music/algorithm/`에 둔다. 이번에는 디렉터리만 만들고 구현하지 않았다.
- 원본 CSV 재작성, 오디오 수집, 추가 API 데이터 저장, PostgreSQL 접속, Git commit/push는 수행하지 않았다.

#### 7.1.4 공식 산출 방식·이론적 범위 조사

확인일: 2026-10-17. 기존 CSV·analysis.json과 기존 분석 코드의 결측·NFKC/casefold/공백 정리 기준을 재사용했다. 추가 집계는 메모리에서만 수행했고 원본·기존 분석 스크립트·집계 파일을 수정하지 않았다.

- **공식 확인:** [MuSe 데이터 논문](https://openhumanitiesdata.metajnl.com/articles/10.5334/johd.33)의 Method/Mapping은 Last.fm 감정 태그를 Warriner 등(2013)의 13,915개 표제어 VAD 사전에 연결하고, Last.fm의 태그 관련성 값을 가중치로 가중평균한다고 설명한다. 오디오를 직접 평가한 값이나 Spotify Audio Features가 아니다.
- **공식 확인:** [Warriner 원논문 PDF](https://link.springer.com/content/pdf/10.3758/s13428-012-0314-x.pdf), Method/Data collection(1192~1193쪽)은 단어 감정을 1~9로 평가하며 5를 중간값으로 둔다. 참가자 지침의 Valence/Arousal 방향과 배포 사전·MuSe의 최종 축 방향을 동일하다고 단정하지 않는다. 출판된 단어 예시와 참가자 지침의 방향을 구분해 후속 확인한다.
- **조건부 수학적 귀결:** 매핑에 성공한 태그만으로 양의 가중평균을 계산하면 결과는 1~9다. 그러나 2020년 원문의 미매칭 태그 0 처리까지 포함하면 그 전제가 성립하지 않는다. 따라서 배포값을 이 범위 밖이라는 이유만으로 버그라 단정하지 않는다(7.1.7).
- **공식 통계:** 2021년 MuSe 논문 Table 1 자체가 Valence 최소 0.23, Arousal 최소 0.11을 보고한다. 낮은 값은 로컬 파싱·이동에서 생긴 것이 아니다. 2020년의 0 처리 절차는 낮은 값의 가능한 공식 방법상 설명이다.
- **버전 구분:** 2021년 논문은 v3/90,001곡을 설명한다. 로컬 Zenodo v1은 90,408행이므로 논문의 반올림된 최소값과 일치하더라도 동일 333행이나 동일 생성 코드를 확인한 것으로 보지 않는다.

#### 7.1.5 333행·중복 Spotify ID의 원인 분석

**1 미만 333행**
- 기존 집계: Valence 112행, Arousal 289행, 교집합 68행. 추가 확인: 세 축 모두 1 미만인 행 66개, 중복 Spotify ID 그룹 소속 8행이다.
- 가상 예시(실제 곡·관측값 아님): SOURCE_LOW_A와 SOURCE_LOW_B에 낮은 점수가 있더라도 당시 태그·가중치 없이 원인을 확정하거나 좌표를 보정하지 않는다. 실제 원본 ID·곡명·좌표는 공유에서 제외한다.
- CSV에는 태그 목록·개별 태그 가중치·매핑 성공 여부·분모가 없다. [저자 Last.fm 예제](https://github.com/cakiki/themusedataset/blob/master/Last.fm_API.ipynb)는 태그 조회만, [Spotify 예제](https://github.com/cakiki/themusedataset/blob/master/spotify_API.ipynb)는 기존 ID의 API 조회만 제공한다. 확인한 예제들에서 생성 당시 점수 계산·ID 매칭 코드를 확보하지 못했다.
- **갱신:** 미매칭 태그의 0 처리는 2020년 원문에서 확인했다(7.1.7). 가중평균에 이를 유지하면 낮은 값을 설명할 수 있지만, 각 행의 실제 태그·분모는 CSV에 없어 333행 전체를 원인까지 재현한 것은 아니다. 임의 보정계수는 적용하지 않는다.

**동일 Spotify ID의 상이한 점수**
- 기존 집계: 중복 1,063그룹 중 VA가 다른 그룹 965개, 같은 그룹 98개다. 점수는 원래 Last.fm 곡 객체의 태그에서 산출되고 Spotify ID는 추가 메타데이터로 붙으므로, Spotify ID 자체가 점수 산출의 기본 키였다고 볼 수 없다.
- 추가 집계(서로 배타적 분류 아님): NFKC/casefold/공백 정리 후 아티스트가 같은 그룹 876개, 곡명이 같은 그룹 156개, 두 이름이 모두 같은 그룹 6개. 서로 다른 비결측 MBID가 2개 이상인 그룹은 304개다.
- 가상 예시(실제 곡·ID 아님): SOURCE_A/SOURCE_B가 CANDIDATE_ID_A에 연결되어 있어도 버전 표기와 감정 점수가 다를 수 있다. 문자열·후보 ID 일치만으로 동일 녹음이라 판단하거나 평균으로 병합하지 않는다.
- **근거 있는 해석:** 곡명 표기·버전별로 다른 태그 집합에서 별도 점수가 만들어지고, 후속 매칭이 같은 Spotify ID로 수렴했을 가능성이 있다. 문자열 차이·상이한 MBID는 조사 단서다. 각 그룹의 원인을 표기 차이/리믹스/잘못된 매칭으로 일괄 확정할 수는 없다.
- 태그 가중치·표본 신뢰도가 없으므로 단순 평균, 최댓값, 첫 행 또는 최소 id 선택을 정당화할 근거가 없다. 점수가 같은 98그룹도 매칭 확인 없이 자동 병합하지 않는다.

#### 7.1.6 정책 선택안 — 사용자 결정 대기

아래는 제안이며 **미적용**이다. 기존 테이블·VIEW 계약, 원본 및 분석 결과는 변경하지 않았다.

| 선택 | 정규화 기준 | 이상·중복 처리 | 의미 |
|---|---|---|---|
| A. 근거 확정 후 진행 (권장) | 생성식·축 방향 확인까지 모든 MuSe 정규화 보류 | 333행·중복 1,063그룹은 검토 대상으로만 표시하는 정책 제안. 원본 보존 | 범위 안의 값에도 있을 수 있는 산출 문제를 확인한 뒤 결정 |
| B. 제한된 실험용 기준 채택 | 1~9를 가정한 실험임을 명시하고 축 방향 확인 후 고정 선형식 채택 | 두 축 모두 1~9이며 Spotify ID가 한 번만 나오는 59,447행을 실험 후보로 제한. 나머지는 보존·선택 대상에서 제외하는 정책 제안 | 범위 안이라는 사실은 정확한 점수·매칭을 보장하지 않음 |

- B의 후보식: 높은 값이 양의 축 방향임이 확인되면 `(x-5)/4`, 반대 방향이면 `(5-x)/4`. 5는 척도 중간값이며 두 데이터 소스의 심리적 중립·측정 동등성을 보장하지 않는다. 축별 방향과 변환 버전을 명시해야 한다.
- 0~9는 0 대입을 포함한 가중평균의 수학적 포괄 범위로 검토할 근거가 생겼다(7.1.7). 그러나 감정과 매칭률을 섞은 값이므로 바로 채택하지 않는다. 관측 min-max·무조건 클리핑은 권하지 않는다. 선택 B도 공식 정규화가 아닌 프로젝트 실험 정책이며, 1 이상이라는 조건만으로 희석 문제가 없어지지 않는다.
- 중복은 일단 모두 미해결로 두는 정책을 권장한다. 후속 개별 매칭·동일 녹음 확인 후 원본별 점수를 모두 보존하고 대표 소스 행을 선택하는 규칙을 별도 결정한다. 평균 집계는 그 근거가 확보될 때 다시 검토한다.
- 설계상 후속 검토: `song_sources.external_id`에 MuSe 원본 id를 써서 관측을 구분하고, VIEW의 곡당 한 행 규칙에는 명시적으로 선택된 소스만 참여시키는 방안. 미해결 행을 저장할 별도 격리 테이블이나 스키마 변경은 이번에 도입하지 않는다.
- **대기 중인 결정:** A/B 선택 및 중복 전체 보류 원칙 채택 여부. 결정 전 실제 데이터 변환·중복 삭제·DB 적재를 수행하지 않는다.

#### 7.1.7 2020년 원문 추가 검증 — 0 처리·분모·품질

근거: [Akiki & Burghardt (2020)](https://ceur-ws.org/Vol-2723/short26.pdf), Mapping stage(논문 228~229쪽, PDF 4~5쪽), Figure 1. 이번에 본문 접근에 성공했다.

**확인 수준**
- **원문 명시:** VAD 사전에 없는 감정 태그는 세 축 모두 0을 반환한다. 이후 태그별 Last.fm 가중치로 음악 점수를 가중평균한다. 이는 전체 top-100의 모든 장르 태그가 아니라 필터링 후 감정 태그·추가 seed 태그에 관한 절차다.
- **분모 해석:** 원문 절차대로 0을 부여한 항목도 가중평균에 유지하면 분모는 매칭·미매칭 감정 태그 가중치의 합이다. 다만 본문에는 분모 수식이나 미매칭 항목을 제외하는지에 관한 별도 구현 설명이 없다. Figure 1의 예시 태그는 모두 매칭돼 두 분모를 구분하는 검증 예가 되지 않는다. 따라서 **논문 절차상 포함으로 해석되지만 실제 배포 코드의 분모는 직접 확인하지 못했다**.
- 기존 원본·analysis.json과 분석 기준을 재사용했다. 새 데이터 수집·점수 변환 없이 메모리에서 아래 모델의 일관성만 확인했다.

**333행에 대한 설명력**
- `M`은 매칭된 감정 태그 집합, `T`는 가중평균 대상 전체 감정 태그 집합, `W=sum_T(w)>0`로 둔다. 0 처리 항목이 분모에 남으면 `raw_d=sum_M(w*s_d)/W=q*mu_d`, `q=sum_M(w)/W`, `mu_d=sum_M(w*s_d)/sum_M(w)`다.
- `q`가 작으면 `mu_d`가 1~9 안에 있어도 raw는 1 미만일 수 있다. 이 방식의 수학적 포괄 범위는 0~9이며, 양의 매칭 가중치가 있으면 실제 점수는 0보다 크다. 미매칭 가중치를 분모에서 제외하면 결과는 `mu_d`이므로 이 메커니즘으로는 1 미만이 되지 않는다.
- 세 축이 같은 `q`를 공유한다면 필요조건은 `max(raw_V,raw_A,raw_D)/9 <= q <= min(1,raw_V,raw_A,raw_D)`다. 기존 333행 모두 이 구간이 비어 있지 않다(모델 불일치 0행). **모델이 설명 가능하다는 검사이며 실제 q 측정·원인 확정이 아니다.**
- 개별 원본의 q 구간 예시는 공유하지 않는다. 위 필요조건은 이론적 조건부 경계이며 실제 태그 매칭률로 저장하거나 보정에 사용하지 않는다.

**0~9 적용과 의미 왜곡**
- `2*raw/9-1`은 수치상 -1~1로 옮길 수 있지만, 0은 감정의 최저 강도 외에 미매칭 정보도 뜻한다. 선형 변환만으로 정보 부족을 극단적 부정/저각성으로 해석하는 편향이 해소되지 않는다.
- 가상 예시(실제 곡·관측 아님): 매칭 태그 평균이 모두 6이어도 q=1이면 raw=6, q=0.1이면 raw=0.6이다. q 변화는 감정 평균과 별도로 raw에 영향을 주며 이 숫자는 설명용일 뿐 연구 결과가 아니다.
- 따라서 0~9는 출판된 혼합 점수의 저장·표시 범위 후보이며, 깨끗한 감정 강도 척도라는 뜻이 아니다. 333행만 제외해도 1 이상인 희석 점수는 남을 수 있다. 원본 보존·변환 보류와 사용자 결정 대기는 유지한다.

**태그 매칭률 기반 품질 검증 제안 — 미적용**
1. 수집·재사용 권한을 확인한 원래 시점의 감정 태그·Last.fm 가중치·seed 추가 규칙·사전 버전을 확보한다. 현재 Last.fm 재조회는 과거 상태 재현과 구분하며 배포점수의 확정 원인 증거로 삼지 않는다.
2. 곡별 가중 매칭률 `q`, 개수 매칭률 `|M|/|T|`, 매칭 태그 수, 전체/매칭 가중치 합을 분리 기록한다. 논문상의 전체 태그 발생 기준 88.1%를 개별 곡 q로 대입하지 않는다. 가중치 0·전체 가중치 합 0·seed 가중치 미정은 별도 예외로 둔다.
3. 근거가 확보되면 전체 분모식·매칭 전용 분모식을 각각 재현해 배포 원본과 오차를 비교한다. 이번에는 재계산·실제 변환을 수행하지 않는다.
4. q 구간별로 333행 비율, 각 축 분포, 버전·표기별 중복 그룹을 비교하고, 동일 q 수준의 표본으로 감정 타당성을 별도 검토한다. 태그 수가 적은 경우·특정 태그 가중치 집중도도 함께 본다.
5. q 임계값은 검증 표본 결과와 사용자 결정으로 정한다. `raw/q` 보정이나 매칭 전용 평균 채택도 현재 승인되지 않은 정책이다. q가 낮으면 오차가 커지고, 미매칭이 무작위라는 보장도 없다. CSV만으로 q를 정확히 역산할 수 없다.

**현재 결론:** 0 처리는 공식 확인, 분모 포함은 원문 절차에 따른 해석, 333행 설명 가능성은 수학적으로 확인. 실제 분모 구현·행별 원인·품질 임계값·정규화 정책은 미확정이다. 0~9 자동 적용·원본 수정·DB 적재는 하지 않는다.

#### 7.1.8 품질 검증 실행 결과 — 확보 자료와 재현 범위

확인일: 2026-10-17. 기존 원본·analysis.json·분석 기준을 재사용했고 계산은 메모리에서 수행했다. 원본·기존 집계·분석 스크립트·백엔드는 변경하지 않았다.

**자료 확보 여부**

| 자료 | 확인 결과 | 검증 한계 |
|---|---|---|
| 원본 곡별 태그·가중치 | 로컬 CSV에는 없음. 공식 Zenodo JSONL도 첫 레코드를 직접 확인했으나 동일한 8개 필드만 존재 | 전체 곡의 당시 태그 스냅샷은 확보하지 못함. 첫 레코드 확인을 전체 JSONL의 필드 부재 증명으로 일반화하지 않음 |
| 저자 공개 저장소 | 공식 GitHub의 재귀 파일 목록 확인. 노트북·브라우저 탐색기 등이 있으나 당시 곡별 태그/가중치 원본 파일은 발견하지 못함 | 알려진 공식 공개 경로에서 미확보이며, 비공개 자료까지 없다는 뜻은 아님 |
| Warriner 감정 사전 | 출판사 공식 부록 ZIP을 메모리에서 열어 `BRM-emot-submit.csv` 13,915행 확인. `Word`, `V.Mean.Sum`, `A.Mean.Sum`, `D.Mean.Sum` 제공 | MuSe 생성 시 사용 파일과의 체크섬 동일성은 미확인. 논문 그림의 6개 태그 VAD와는 일치 |
| 정상 곡의 당시 예시 | 공식 논문 그림의 태그·가중치를 검토한 로컬 이력은 보존 | 개별 곡명·태그/가중치·사전 값은 공유하지 않으며 일반 품질 검증과 구분 |
| 현재 Last.fm 태그 | 공식 track.getTopTags는 태그명과 count 제공. API key 필수, 사용자 인증 불필요. 과거 날짜 지정 인자는 문서에 없음 | 이번 작업에 키가 제공되지 않아 API 호출하지 않음. 현재 조회가 가능해도 생성 당시 원본 대체 불가 |

새로 확인한 공식 출처:
- [Warriner 출판사 부록 ZIP](https://media.springernature.com/original/springer-static/esm/art%3A10.3758%2Fs13428-012-0314-x/MediaObjects/13428_2012_314_MOESM1_ESM.zip)
- [MuSe 공식 JSONL](https://zenodo.org/records/4281165/files/muse_dataset.jsonl?download=1)
- [저자 저장소 파일 목록 API](https://api.github.com/repos/cakiki/themusedataset/git/trees/master?recursive=1)
- [공식 논문 그림 원본](https://storage.googleapis.com/jnl-up-j-johd-files/journals/1/articles/33/submission/proof/33-10-589-1-17-20210707.png) — 2021년 논문 Figure 2, 2020년 Figure 1을 재사용한 그림
- [Last.fm track.getTopTags](https://www.last.fm/api/show/track.getTopTags)

사전·외부 자료는 검증용으로 메모리에서만 읽었다. MuSe CC BY 4.0을 사전·Last.fm 자료의 별도 저장·재배포 허가로 확대 적용하지 않았다.

**표본과 포함/제외 가중평균 비교**

개별 곡명·원본 행 ID·실제 태그/가중치·감정 사전 값·좌표 비교 표는 공유에서 제외했다. 로컬 연구 이력과 원본 계산은 변경하지 않았다. 일반 수식 q·가중평균·분모 포함/제외의 차이는 위 이론 설명을 따르며, 가상의 설명을 실제 실험 결과로 사용하지 않는다.

**권장안 — 정책 미확정**
- 기존 제한된 사례 검토만으로 품질 임계값이나 정규화식을 확정하지 않는다. 개별 사례의 수치·식별정보는 공유하지 않는다. 전체 원본 정규화·자동 제외·raw/q 보정의 정책은 별도 근거와 승인으로 결정한다.
- 다음 우선순위는 저자의 당시 태그/가중치·seed 규칙·실행 코드·사전 버전 확보다. 실제 연락은 별도 지시 없이 보내지 않는다. 확보 불가 시 현재 Last.fm 표본 실험을 별도 연구로 선택할 수 있으나 과거 배포점수 재현과 분리해야 한다.
- 근거 확보 후 q, 매칭 태그 수, 매칭 가중치 합 및 특정 태그 집중도를 함께 평가한다. 두 분모식의 원본 재현 오차·q 구간별 감정 타당성을 확인한 뒤 사용자 승인으로 기준을 선택한다.
- 미확인 곡을 낮은 점수만으로 부정적/저각성 또는 불량이라고 확정하지 않는다. 원본은 보존하고, 미검증 상태와 후속 선택 대상 제외 여부를 구분하는 정책을 제안한다. 중복 Spotify ID 문제도 q와 별개로 유지한다.

### 7.2 ReccoBeats

#### 7.2.1 첫 공식 문서 및 소규모 실측 이력 (2026-10-17, 최신 결과는 7.2.5)

이 절은 초기 접근 조사 이력이다. 오류 코드와 클라이언트별 응답 차이의 해석·공식 인터페이스만 설명하며, 실제 곡별 응답과 매칭률·특징 확보 수치는 비공개 로컬 결과에 보존한다.

PC PowerShell 추가 사용자 보고: HTTP 200, 테스트한 Spotify ID의 content=[]였다. 이는 아래 Codex 실행 환경의 403과 별도 관측이며 API 전체 장애로 일반화하지 않는다. PC에서 기존 고정 10-ID 표본 전체의 결과는 아직 미수신이다. reccobeats_probe.py의 --lookup-only는 metadata 요청 1건으로 HTTP 상태·반환 곡 수·정확한 href ID 매칭을 기록하고 특징 조회는 생략한다. 환경 라벨과 새 결과 경로를 사용해 두 환경의 결과를 분리한다. 공식 ids 반복/쉼표 조회 형식은 다시 확인했다.

| 항목 | 현재 확인 결과 |
|---|---|
| 접근/인증 | [약관](https://reccobeats.com/docs/documentation/terms-of-service)은 2026-05-25 갱신본으로 무인증·무료 개인/상업 사용을 명시. Python 실제 API 요청은 HTTP 403이며 추가 문서 조회 도구도 단일 ID URL 접근 실패. 서비스/보안 게이트/실행 환경 중 원인은 구분 불가 |
| Spotify ID 입력 | [공식 요청/응답](https://reccobeats.com/docs/documentation/request-and-response)의 `GET /v1/track?ids=...` 예시는 22자리 Spotify ID를 반복/쉼표 인자로 받음. 응답 예시의 ReccoBeats `id`는 UUID, `href`는 Spotify track URL. 문서상 직접 조회 경로를 확인했지만 MuSe 실제 매칭은 미검증 |
| 감정 특징 | [단일 곡 특징 조회](https://reccobeats.com/docs/apis/get-track-audio-features)는 `GET /v1/track/:id/audio-features` 지원. [분석 설명](https://reccobeats.com/docs/documentation/Analysis/audio-features-extraction)의 Valence·Energy 범위는 각 0~1. 이 설명은 업로드 분석 결과이므로 기존 곡 GET 응답에서도 동일 필드·정의가 보장되는지는 실측 전 미확정 |
| 문서상 제공 필드 | metadata 예시는 id/trackTitle/artists/durationMs/isrc/ean/upc/href/availableCountries/popularity. 업로드 분석 예시는 acousticness/danceability/energy/instrumentalness/liveness/loudness/speechiness/tempo/valence. 실제 조회에서 확인된 필드는 없음 |
| 요청 한도 | [호출 제한](https://reccobeats.com/docs/documentation/rate-limiting)은 내부 설정·숫자 미공개, 429·Retry-After·캐싱·과도한 요청 차단 안내. 요청당 ID 최대 수/동시성/하루 quota 미확정. 예시나 무인증이라는 사실로 전체 수집 가능량을 추정하지 않음 |
| 저장/재사용 | 약관의 무료 상업 이용 허용과 분석 자체 생성 설명은 확인. 대량 수집·영구 DB 복제·원본/정규화 지표 재배포의 명시 범위는 확인되지 않음. Spotify 유래 메타데이터는 제3자 조건 준수 책임이 명시됨. 캐싱 권고를 무기한 저장 허가로 해석하지 않음 |

초기 접근 점검은 기존 고정 표본을 사용했으며 다른 곡으로 대체하지 않았다. HTTP 오류는 통신/요청 맥락의 관측으로 분류하고 전체 카탈로그의 매칭률로 일반화하지 않는다. 실제 응답 수·매칭률은 공유하지 않는다.

결과는 `.local/reccobeats-probe/trial-10-v1/`의 sample.json/results.jsonl/stats.json/access-checks.json이다. MuSe 입력 ID·원본 참조·HTTP 상태·판정·필드명/유효성 boolean만 기록하며 원격 제목·아티스트·UUID·감정 수치·응답 본문은 저장하지 않는다. 권한 확인 전 특징을 DB/파일로 영구 보관하지 않는다. 원본과 전체 정제 해시는 유지했다. 합성 transport의 7개 테스트와 기존 23개, 총 30개 통과. 실측 성공을 합성 성공으로 대신하지 않는다.

#### 7.2.2 DB-A/C1/C2 구축 판단 및 수집 제안

공식 인터페이스와 기존 구현 계약을 기준으로 한 설계 판단이다. ReccoBeats 실측 커버리지·분포·추천 성능은 공개하지 않으며 저장·재사용·재배포 조건과 곡 매칭 품질은 별도 검토 대상이다.

| VIEW | 필요한 실제 값과 검증 | 현재 판단 |
|---|---|---|
| A | 같은 검증·선택된 ReccoBeats 소스의 Valence+Energy. 모두 유한한 0~1 값이며 `2*x-1`, reccobeats-v1 | GET 특징 필드와 권한 확인 전 실데이터 구축 보류 |
| C1 | 같은 song_id의 ReccoBeats Valence + MuSe Arousal(0~9 이론 정규화) | 양 제공자의 곡 매칭 검증·추천 소스 선택·권한 확인 필요. ReccoBeats Energy는 C1 필수 조건 아님 |
| C2 | 같은 song_id의 ReccoBeats Valence + MuSe Arousal(전체 원본 고정 관측 범위 정규화) | C1과 같은 검증·권한 필요. 표본/매칭 성공분으로 MuSe 관측 범위를 재계산하지 않음 |

다음 수집 순서를 제안한다(이번에는 미실행).

1. API 403 원인을 확인하고 공식 지원 경로에서 접근 조건·요청당 ID 수·속도·bulk 허용량을 확인한다. 현재 차단을 우회하거나 요청량을 늘리지 않는다.
2. 제공자에게 MuSe 연동 목적의 장기 저장 가능 필드, 보관 기간, 정규화·추천 이용, 대량 수집/재배포, 귀속·갱신·삭제 조건과 Spotify 유래 메타데이터의 제3자 조건을 확인한다. 연락은 별도 지시 없이 보내지 않는다.
3. 동일 10-ID 표본으로 metadata 조회 → 반환 href의 Spotify ID 정확 대조 → **모든** 연결된 MuSe 원본의 제목/아티스트 비교 → ReccoBeats UUID별 특징 GET을 검증한다. Spotify URL/ID와 ReccoBeats UUID를 혼용하지 않는다. 제목/아티스트 일치만으로 verified 처리하지 않는다.
4. 이후 승인된 범위에서만 중복 제거된 후보 ID를 소규모 배치 조회하고 UUID별 특징을 취득한다. bulk 특징 경로는 [GET /v1/audio-features](https://reccobeats.com/docs/apis/get-audio-features)에 있으나 허용 입력/요청 상한/실제 응답을 먼저 확인한다. 체크포인트·속도 제한·429 Retry-After·상한 있는 재시도와 누락 사유를 기록하고 빈 좌표를 0으로 채우지 않는다.
5. 허용된 필드만 원본/출처/버전/검증 근거와 보관하고, 명시적으로 검증·선택된 제공자별 소스를 같은 canonical song_id로 연결한다. 중복 MuSe ID 원본은 병합하지 않는다. VIEW별 유효 곡 수와 A/C1/C2 교집합은 별도 집계하며 전체 60,741개 후보의 커버리지로 일반화하지 않는다.

#### 7.2.3 PowerShell 재현·ID 대조·기존 곡 특징 실측 (2026-10-17)

공개 설명은 전송/판정 구조로 한정한다. PowerShell HTTPS 응답을 메모리 파이프로 Python에 전달하고, 요청 ID와 반환 href·UUID를 대조한 뒤 모든 연결 원본의 제목/아티스트를 검사한다. 환경 라벨만으로 실제 HTTP 클라이언트를 추정하지 않는다.

실제 곡 ID·클라이언트별 실측 응답 수·매칭률·특징 확보량은 공유하지 않는다. 원본은 .local/reccobeats-probe/에 보존하며 원본 관측을 새로운 수치나 예시로 덮어쓰지 않는다. 파싱/ID 계약 검사는 독립 매칭 승인이나 공개 권한을 대신하지 않는다.

#### 7.2.4 감정 값 확보 실패 원인 분석 및 실제 JSON 재확인 (2026-10-17)

구현은 metadata의 content 배열과 audio-features의 root 객체를 구분하며, valence/energy의 존재·타입·유한성·0~1 범위 및 ID 연결을 검증한다. HTTP 성공만으로 유효 좌표를 인정하지 않는다. raw 값의 2*x-1 변환과 SQL 입력 계약은 유지한다.

실제 곡의 요청/응답·좌표·진단별 확보 수치는 공유하지 않는다. 기존 .local/reccobeats-probe/feature-structure-2-v1/의 로컬 진단을 보존하며, 공식 경로/필드 계약과 실제 데이터 공개 허용을 별개로 취급한다.

#### 7.2.5 수집 파이프라인 소규모 안정화 및 SQL 입력 계약 (2026-10-17)

후보 선택→metadata href 대조→모든 원본의 제목/아티스트 비교→중복/충돌 보류→UUID별 특징 확인→Decimal 정규화·SQL 입력 검증의 흐름을 유지한다. metadata와 feature의 ID가 일치해야 하고, 소스 상태는 pending·미선택으로 남긴다.

source 입력과 score 입력을 구분하고 DB 생성 열에 계산값을 직접 INSERT하지 않는다. A는 ReccoBeats V+Energy, C1/C2는 ReccoBeats V+MuSe A의 이론/관측 정규화다. 이 구조는 실제 곡의 verified 전환이나 제공자 재배포 허용을 뜻하지 않는다.

원본 .local/reccobeats-probe/pipeline-stable-10-v1/의 실측 수치·응답·개별 곡 기록은 수정하지 않고 비공개 보존한다. 합성 테스트의 경계/오류 검증은 실제 응답 성능 평가와 구분한다.

#### 7.2.6 확대 전 권한 확인·불일치 검토·요청량 계획 (2026-10-17, 문서 검토만)

공식 [약관](https://reccobeats.com/docs/documentation/terms-of-service)(Last Updated: May 25, 2026)과 [호출 제한](https://reccobeats.com/docs/documentation/rate-limiting)을 다시 확인했다. **명시되지 않은 권한은 허용으로 간주하지 않는다.** 이번 작업은 문서 검토·기존 결과 집계만 수행했고 데이터 API 요청·수집·DB 저장·문의 발송은 하지 않았다.

| 구분 | 확인된 범위 | 미확인·현재 적용 방침 |
|---|---|---|
| 접근·비용 | API 키/인증 불필요, 무료 개인·상업 프로젝트 이용 명시 | 대규모 자동화·서비스 안정성/접근 지속 보장은 아님 |
| 호출량 | 과도한 요청의 제한/차단 가능, 429 대기·Retry-After 확인 안내 | 수치 quota·동시성·요청당 ID 상한·전체 카탈로그 수집 허용량 미공개. 확대 미실행 |
| 캐싱 | 트래픽 감소를 위한 캐싱 권고 | 허용 필드·TTL·갱신·삭제 범위 미명시. 무기한/영구 DB 보관 근거로 사용하지 않음 |
| 분석 값 | 특징·추천 분석은 ReccoBeats 자체 생성이라고 설명 | 원본 V/E 장기 저장, 변환·결합 값의 별도 보관/재배포 라이선스는 미확정 |
| 재사용 | 일반 개인·상업 프로젝트의 API 이용은 허용한다고 명시 | MuSe 결합·2*x-1 정규화·추천 결과 API/좌표 공개·데이터셋 배포의 구체적 권한을 따로 확인 |
| 메타데이터 | Spotify 출처이며 사용자에게 제3자 조건 준수 책임 명시 | ReccoBeats의 일반 허용만으로 Spotify 유래 필드의 저장·갱신·삭제 요건 충족을 확정하지 않음 |

**제공자 문의 질문 초안 — 미발송**

1. MuSe 고유 Spotify ID 60,741개를 한 번 조회하고 매칭 곡의 V/E를 취득한 뒤 정기 갱신하는 자동 수집이 허용되는가? 10개씩 metadata+개별 특징 방식은 최초 최대 66,816요청인데, 허용 규모·기간·사전 승인 절차는 무엇인가?
2. V/E 원본·수신 시각·provider UUID·Spotify ID/href·ISRC·제목/아티스트 중 어떤 필드를 비공개 PostgreSQL에 장기/영구 저장할 수 있는가? 일시 캐시와 DB 보관의 구분, TTL, 갱신 주기, 백업 보관·삭제 조건은 무엇인가?
3. V/E를 2*x-1로 정규화하고 MuSe 좌표와 결합해 거리 기반 추천에 사용하는 것이 허용되는가? 내부 계산, 사용자에게 추천 결과 제공, 정규화 좌표 공개, 원본/가공 데이터셋 재배포를 각각 구분해 답변받는다.
4. 요구되는 라이선스·귀속 문구·링크·로고와 유료 서비스 이용 조건은 무엇인가? 자체 분석 값과 Spotify 유래 metadata의 권한 범위가 어떻게 다른가? 제3자 조건을 충족하기 위해 별도 확인해야 할 근거/권리자가 있는가?
5. metadata·특징 API 각각의 요청당 ID 수, 분/일 quota, 동시성, bulk 특징 입력 ID 종류/상한, 자동화 클라이언트 정책은 무엇인가? PowerShell 접근과 urllib 403 차이를 공식적으로 지원하는 접근 방법은 무엇인가?
6. 429 Retry-After·재시도·서비스 장애 시 권장 정책과 재개 조건은 무엇인가? 승인된 수집/갱신 작업의 속도를 어떤 기준으로 합의할 수 있는가?
7. 약관 변경·권한 철회·서비스 종료·삭제 요청 시 수집본/정규화 값/백업의 처리 요건은 무엇인가? 가능하면 적용 약관 버전과 허용 범위를 명시한 서면 답변을 요청한다. 삭제 의무가 있다면 기존 append-only/RESTRICT 설계와 양립할 삭제 절차를 도입 전 별도 검토한다.

답변은 제공자의 권한 범위 안에서 해석하며 제3자 권리를 자동으로 대체하지 않는다. 답변 부재·조건 불명확 시 현행 소규모 진단 범위에서 멈추고 대량 수집·영구 저장을 보류한다. 실제 연락은 별도 지시 없이 보내지 않는다.

**제목/아티스트 불일치 처리 기준 — 검토 규칙, DB 미적용**

제목·아티스트 비교만으로 동일 녹음을 확정하지 않는다. 실제 재검토 대상 ID·곡명·관측별 메타데이터는 공유하지 않고, 아래 원본별 판단 규칙만 유지한다.

| 검토 상황 | 처리 기준 |
|---|---|
| 제목/아티스트 미해결 | pending 유지·추천 소스 미선택·A/C1/C2 제외. 원본과 후보 ID를 보존하고 자동 병합/평균/대표행 선택 금지 |
| 서식 차이만 확인 | 기존 NFKC·casefold·공백 정리 정책으로만 재비교. 기호/괄호/feat/버전 문자열을 무조건 삭제하지 않으며 문자열 일치도 자동 verified 근거로 사용하지 않음 |
| live/remix/remaster/acoustic/edit/다른 발매판 가능성 | 별도 버전 후보로 검토. 허가된 자료의 녹음/발매 정보·MBID/ISRC·재생 길이 등 독립 근거를 사용. MuSe 원본에 ISRC/길이가 없으므로 ReccoBeats의 단일 응답만으로 동일성 확인 완료라고 하지 않음 |
| 같은 녹음임을 근거로 확인 | 원본별 method/reference·검토자·시각을 남긴 뒤, 권한과 별도 승인된 검증 절차에 따라 연결/추천 소스 선택. 현재 DB 상태는 변경하지 않음 |
| 다른 곡/녹음임을 확인 | 후보 연결을 거절 대상으로 분류하고 원본/기존 점수 보존. 자동으로 다른 Spotify ID로 바꾸지 않음 |
| 근거 부족·외부 자료 이용 권한 불명 | 계속 pending. 아티스트 불일치가 새로 발견되어도 같은 검토 원칙 적용 |

동일 후보 ID에 MuSe 원본이 여럿이면 원본별로 따로 검토한다. 문자열 일치만으로 실제 녹음 동일성이나 verified 상태를 자동 승인하지 않는다.

**확대 시 요청량 산정 — 실행 권한 아님**

요청용 고유 후보 수를 N, metadata 배치 크기를 B, 실제 특징 조회 수를 M이라고 하면 단곡 특징 방식의 Q=ceil(N/B)+M이다. 배치 특징 방식은 적격 작업을 배치 상한으로 묶어 계산한다. VIEW 간 동일 source를 재사용하며 지표별로 중복 조회하지 않는다.

실제 표본 반환율·일치율을 넣은 비용/시간 예시는 공개에서 제외했다. 알려진 모집단 크기나 구현 배치 설정만으로 실제 확보량·처리 시간을 보장하지 않는다. 일반 대기 산술은 최소 간격을 d라 할 때 d*(Q-1)이며 네트워크·서버 대기·재시도·검토 비용은 별도다.

**당시 권한 승인 후 호출 대응 제안 이력**

아래는 당시 제안이다. 후속 3단계에서는 5.1의 체크포인트/대기/제한적 재시도를 오프라인 엔진에 구현했다. 실제 호출·점수 영구 캐시·TTL/갱신/삭제 sink는 여전히 미실행/미구현이며 제공자 허용 조건을 기다린다.

- 제공자의 명시 허용량·ID 상한을 우선하고 동시성 1, 초기 간격 최소 2초를 내부 보수적 설정으로 사용한다. 분/일 허용량과 배치별 예산·중단 조건을 별도로 합의한다. 프록시/IP/UA를 바꾸며 차단을 회피하지 않는다.
- 403은 즉시 중단·원인 확인, 429는 모든 후속 호출을 전역 정지하고 Retry-After 전체를 기다린다. 헤더가 없을 때만 제한된 지수 backoff+jitter를 사용하고 서버 대기를 잘라 재시도하지 않는다. 대기 예산을 넘으면 중단/재개 예정으로 남긴다.
- 네트워크/타임아웃/5xx의 재시도와 추가 요청 예산은 코드 버전·승인된 실행 조건으로 제한한다. Q 기반의 비율 예산은 내부 계획이지 공식 허용 quota가 아니며, 실제 관측에 기초한 예산/시간 수치는 공개하지 않는다.
- 400/404·빈 응답은 분류 후 종료하고 같은 입력을 반복 요청하지 않는다. 허용된 필드/TTL 안에서 UUID별 중복 특징 조회 방지, 체크포인트, 갱신/재개 절차를 설계한다. 승인 전 영구 캐시/응답 저장은 구현하지 않는다.

**이전 확인된 사실**
- 기존 확인: API base URL `https://api.reccobeats.com`, 인증키 불필요. 개인/상업 이용은 무료다.
- 문서상 엔드포인트: [단일 곡](https://reccobeats.com/docs/apis/get-track-by-id) `GET /v1/track/:id`, [복수 곡](https://reccobeats.com/docs/apis/get-tracks) `GET /v1/track`, [단일 특징](https://reccobeats.com/docs/apis/get-track-audio-features) `GET /v1/track/:id/audio-features`, [복수 특징](https://reccobeats.com/docs/apis/get-audio-features) `GET /v1/audio-features`.
- [요청/응답 설명](https://reccobeats.com/docs/documentation/request-and-response)은 `/v1/track?ids=...`의 반복 또는 쉼표 구분 인자와 응답의 Spotify 트랙 URL `href`를 제시한다. 외부 UUID와 Spotify ID를 구분할 근거다.
- [특징 설명](https://reccobeats.com/docs/documentation/Analysis/audio-features-extraction)에 `valence`, `energy` 및 각각 0.0~1.0 범위가 명시되어 있다. 이 설명은 업로드 분석 API에 관한 것이며, 기존 곡 조회 응답의 실제 필드·동일 척도 적용은 표본 확인 전이다.
- [호출 제한](https://reccobeats.com/docs/documentation/rate-limiting): 상한은 내부 설정이며 수치 미공개. 초과 시 429, Retry-After 확인·대기, 과도한 요청 시 차단 가능. 캐싱을 권장한다.

**사용 판단 / 미확정**
- [기존 확인 약관](https://reccobeats.com/docs/documentation/terms-of-service)(문서 표기 2026-05-25): 메타데이터는 Spotify 유래, 분석 지표는 자체 생성이라고 명시하며 제3자 조건 준수 책임을 사용자에게 둔다.
- 일반 API 이용·캐싱 안내는 확인됐으나 **10,000곡 일괄 수집, 영구 복제 DB, 원본/변형 지표 재배포의 명시적 허가는 미확정**이다. 금지 문구가 없다는 이유로 허가로 간주하지 않는다.
- 이전 조사에서는 Spotify ID 직접 입력을 확정하지 못했으나 현재 공식 예시의 직접 입력 경로를 확인했다(7.2.1). 요청당 ID 상한·MuSe 실제 매칭·기존 곡 특징 응답 상세는 여전히 미확정이다.
- 다음 확인: 제공자에게 위 저장·재사용 범위와 메타데이터의 제3자 조건을 질의할 항목 정리. 실제 연락은 별도 지시 없이 보내지 않는다.

### 7.3 Spotify

**100개 ID 검증 준비 구현 (2026-10-17)**
- collectors/spotify_validate.py: 기존 전체 정제본의 고유 ID 60,741개에서 고정 seed SHA-256 순위로 100개를 선정한다. 선택된 ID의 모든 MuSe 원본을 비교하며 중복 대표행을 고르지 않는다. 선정 seed·원본 해시·API 실행 조건과 상세 실행 명령은 collectors/README.md에 기록했다.
- Python 표준 라이브러리의 Client Credentials 또는 환경 Bearer 토큰, 개별 Get Track·명시 market를 사용한다. 인증과 --execute가 없으면 토큰 발급도 하지 않는다. 응답은 메모리에서만 비교하며 Spotify 메타데이터 영구 저장 기능은 구현하지 않았다.
- 1초 직렬 간격·429 Retry-After·5xx/네트워크 지수 backoff/jitter 최대 3회 재시도·120초 총 대기 예산을 적용한다. 긴 Retry-After를 줄여 호출하지 않으며 인증/403/429 소진은 전체 실행을 중단하고 남은 ID를 확인 불가로 표시한다.
- 판정은 success/mismatch/unconfirmed다. NFKC·casefold·공백 정리 후 제목과 개별 아티스트가 정확히 일치해야 success이며 ID별로 연결된 모든 원본이 일치해야 한다. relinking·404·불완전/제한 응답은 확인 불가다. 문자열 일치가 곡/녹음의 동일성 입증이나 DB verified 전환은 아니다.
- .local에는 MuSe 원본 참조·판정 boolean·상태/사유 코드·통계만 보관한다. 토큰·Spotify 응답 제목/아티스트·원문 오류·새 반환 ID는 기록하지 않는다. 인증 환경은 설정 유무만 기록한다. 인증 변수 부재로 실제 API 호출은 보류했으며 현재 성공률은 미측정이다. 공식 인증·Get Track·Rate Limits 문서를 필요한 범위만 재확인했다.

**확인된 사실**
- [Get Track](https://developer.spotify.com/documentation/web-api/reference/get-track): OAuth 2.0 기반 `GET https://api.spotify.com/v1/tracks/{id}`로 Spotify ID에 해당하는 곡 정보를 조회할 수 있다. 접근 가능 여부는 앱 권한·토큰·market에 좌우된다.
- 외부 배포본끼리 동일 Spotify ID를 대조하는 작업 자체에는 API 호출이 필요 없다. 이는 로컬 매칭에 대한 설계 판단이며, ID의 정확성·활성 상태 검증과는 별개다.
- [개발 모드 변경 안내](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide): 2026-02-11 신규 앱부터, 03-09 기존 개발 모드 앱에도 변경 적용. 소유자 Premium 필요, 신규 앱은 개발자당 Client ID 1개·앱당 사용자 5명 제한(기존 초과분 예외 명시). 개발 모드의 `GET /tracks` 일괄 조회는 제거되고 개별 조회를 안내한다.
- [호출 제한](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)은 30초 이동 구간 기준이며 앱 모드에 따라 다르다. 수치 상한은 해당 문서에 공개되지 않았고 429/Retry-After 대응이 필요하다.
- [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)는 개발 모드에 별도 quota 제한도 명시한다. 이 프로젝트의 앱 모드·허용량은 미확인이다.
- [공식 변경 공지](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)는 신규 사용 사례의 Audio Features/Analysis 등 접근을 제한한다. 예전 MuSe 노트북을 현재 접근 가능성의 근거로 사용하지 않는다.

**사용 판단 / 미확정**
- 기존 확인 [개발자 약관](https://developer.spotify.com/terms): 운영상 엄격히 필요한 범위를 제외한 Spotify Content의 저장·집계·DB 구축을 제한한다. **범용 10,000곡 영구 DB 수집원으로 허용됐다고 판단할 수 없다.**
- Get Track 문서는 메타데이터·이미지의 Spotify 링크/귀속 표시와 ML/AI 입력·학습 금지를 명시한다. 단순 거리 추천의 구체적 이용 조건도 데이터 출처·목적에 맞춰 검토해야 한다.
- API 조회 가능성과 대량 저장 허용은 별개다. 이 프로젝트의 앱 접근 상태, 필드별 보존/갱신/삭제 조건 및 서비스 종료 시 처리는 미확정이다.

### 7.4 기존 설계 수정 필요 사항 검토

다음은 후속 확정 대상이며, 이번 검증으로 1~6절의 테이블·VIEW·추천 계약을 변경하지 않았다.

| 항목 | 검토 결과 |
|---|---|
| MuSe 입력 매핑 | Zenodo v1은 `valence_tags`→valence, `arousal_tags`→arousal 매핑 필요. Kaggle 다른 버전으로 일반화 금지 |
| 정규화 | ReccoBeats 계약은 0~1 값을 2*x-1로 변환한다. 실제 추출/분포 수치는 비공개로 보존한다. MuSe는 고정 이론/관측 버전을 재사용하며 개별 좌표를 공유하지 않는다. |
| ID 신뢰도 | SPEC 2.1의 source-scoped-review-v1으로 ID 보유·문자열 일치·원본별 독립 검토를 구분한다. 실제 검증 전환·감사 이력 영속화는 미구현 |
| 소스 버전 | Zenodo/Kaggle의 곡 수·버전을 혼용하지 않도록 배포 URL·파일명·체크섬 기록 방식 검토 |
| 원본 보존 | 허용된 필드에만 적용. raw_payload 전체 응답의 무기한 저장으로 해석 금지 |
| 수집·접근 | 공개 호출 상한을 임의 설정하지 않음. Spotify 개발 모드 일괄 조회에 의존하지 않음 |
| 목표 10,000곡 | 소스별 유효 ID·특징·권한 교집합 규모는 미검증. 목표 달성 가능성 확정 금지 |

DB 역할 권한은 실제 접속 전 별도 검토한다. 현재는 서버에 접속하지 않는다.

## 8. 후속 검증 기준

- 정규화 끝점·중앙값, 비정상 숫자·범위, 원본 불변성.
- Spotify ID 중복/누락, 외부 ID 충돌, 같은 배치 재실행 시 중복 방지.
- VIEW의 축 출처·버전·결측 제외·곡당 한 행 보장.
- 추천 거리·동점·제외 곡·입력 검증, 10,000곡 커버리지와 성능.
- 후속 구현 시 전체 빌드 및 허용된 테스트 DB 검증. 2026-10-17 후속 1단계는 문서만 수정하고 기존 도구로 noEmit 검사를 수행했다. 전체 소스 검사는 루트 의존성 누락으로 실패, 추천 모듈 검사는 통과, 기존 JS 기반 추천 테스트 22개 통과다. pnpm build/새 emit/의존성 설치/API·DB 호출은 하지 않았다. 이전 Python·SQL 검증은 재실행하지 않았으며 상세 명령은 STATUS를 따른다.

## 9. ReccoBeats 다중 특징 조회 (2026-10-19)

### 계약 및 식별

- [공식 다중 특징 문서](https://reccobeats.com/docs/apis/get-audio-features)의 내장 스키마: `GET /v1/audio-features`, 필수 `ids` 배열 1~40개, ReccoBeats UUID/Spotify ID/ISRC 지원. [배열 인자 문서](https://reccobeats.com/docs/documentation/request-and-response)의 CSV 방식을 사용한다. 실제 API 검증은 이번에 하지 않았다.
- 요청은 기존 메타데이터 엄격 매칭을 통과한 canonical ReccoBeats UUID로 구성한다. 응답 `{content:[{id,href,valence,energy,...}]}`에서 UUID와 Spotify href의 저장된 SID를 모두 검증한다. 순서는 무관하며, 요청하지 않은 ID·중복 UUID·불일치/누락 href는 배치 전체 파싱 실패다.
- 메타데이터는 기존 10곡 조회·제목/아티스트 엄격 일치·원본 중복/UUID 충돌 보류를 유지한다. V/E 및 `2*x-1` Decimal 처리·임시 research_features 저장을 재사용하며 verified 전환은 없다.

### 체크포인트 및 실패 처리

- 기존 manifest/config·테이블 구조를 바꾸지 않는다. 별도 meta `feature_batch_protocol=uuid-href-v1`과 이벤트만 추가한다. 미시도 pending 단곡 작업 최대 40건을 `features:batch:<SID목록 SHA256>` 부모와 연결하고 자식은 `batched`로 보존한다. 이미 시도한 단곡·완료/보류·저장된 점수는 묶거나 다시 요청하지 않는다.
- 묶기/이벤트를 한 트랜잭션, 전송 전 inflight 예약/attempt/not_before를 한 트랜잭션, 응답 점수/결과/부모·자식 완료를 한 트랜잭션으로 커밋한다. WAL·synchronous=FULL 유지. 20요청 단위는 JSON 보고만 해당한다.
- 부분/빈 성공 응답은 반환 곡만 저장하고 누락 곡은 `held_batch_missing`으로 종결한다. 0 채움·개별 fallback·자동 재조회는 없다. 이는 제공자의 곡 부재 확정이 아니며 원격 누락 의미는 실제 소규모 검증 대상이다.
- 파싱/식별/점수 검증 실패는 SAVEPOINT로 해당 배치 점수/후보 갱신을 전부 롤백하고 부모 실패·응답 진단을 남긴다. 부모 실패 시 다음 구간 인계를 막는다. 자식 독립 재시도는 거부한다. 반환 성공곡이 저장된 배치는 다시 보내지 않는다.
- 배치 404는 곡별 not_found로 해석하지 않고 실패 처리한다. 403은 sticky 중단, 429 Retry-After는 재개 후에도 전역 대기, 5xx/통신 실패는 부모 단위 최대 3회다. 기존 단곡 404 정책은 유지한다. 실패 부모의 수동 재시도는 기존 예산/403 제한을 유지한다.
- Ctrl+C는 전송/저장을 마친 뒤 정지한다. 강제 종료 시 inflight 부모는 uncertain이 되며 자동 재요청하지 않는다. 부모 계획 후 전송 전 중단도 같은 부모로 재개한다. `--feature-batch-size 1`은 새 묶기를 중지하되 이미 생성된 부모는 다중 조회로 처리한다. 배치 생성 후에는 이 구현을 사용해야 하며 옛 실행 코드로 역호환을 보장하지 않는다.
- 합성 검증 사본에는 `offline_synthetic_validation` meta를 둬 live 전송과 후속 수집의 seed 입력을 거부한다. 사본의 숫자를 실제 확보량/커버리지로 사용하지 않는다.

### 검증과 비용 비교

검증기는 기존 checkpoint를 immutable 읽기 전용으로 확인하고, 새 로컬 사본에 합성 응답만 주입해 배치·중단/재개·완료 작업 재실행·lineage 보존을 검증한다. 원본의 lock·DB·WAL/SHM을 수정하지 않는다.

배치 비용의 구조적 차이는 적격 미완료 작업 수를 M, 배치 상한을 B라고 할 때 단곡 M회와 배치 ceil(M/B)회로 비교한다. 이는 일반 산술이며 실제 카탈로그의 요청량·속도·확보율 예측이 아니다. 실측 checkpoint에 기초한 비용 추정·요청 절감률은 비공개 로컬 결과에만 보존한다. 재시도·429 대기·감사·중단 비용은 별도로 고려한다.

### 별도 지시 후 실제 소규모 검증

이번 작업에서는 아래 명령을 실행하지 않는다. 현재 보존된 28,000 구간에는 특징 150건만 대기하므로, 별도 실행 지시 후 다음 명령은 과거 완료 작업을 건너뛰고 최대 1회/40곡만 요청한다.

```powershell
python -B src/music/collectors/reccobeats_full.py --research-live --feature-batch-size 40 --max-requests 1
```

`progress.json`·현재 구간 `verification.json`에서 배치 요청 증가 1회 이하·기존 점수/완료 이력 보존·UUID/href 대조·누락 보류·403/429/지연을 확인하고 종료한다. 누락/404 의미와 실제 반환 형식을 확인한 뒤 전체 재개를 별도로 결정한다. 데이터 초기화·완료 요청 재조회·클라이언트 우회는 하지 않는다.
