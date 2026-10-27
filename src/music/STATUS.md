# 현재 상태

갱신일: 2026-10-27

## Commit/push 직전 독립 실행 검증 — PASS

- 사용자가 feature/music-db의 최종 검증 후 commit 및 일반 push를 명시적으로 승인했다.
  원격과 HEAD가 같은 상태에서 업로드 후보가 예상한 21개와 정확히 일치함을 확인했다.
- Git 공유 파일 116개만 복사한 새 임시 작업 폴더에서 frozen lockfile로 의존성 104개를
  설치하고 빌드했다. 기존 node_modules/dist/.local은 복사하지 않았으며,
  해당 환경에 .local 및 PGlite 패키지가 없음을 실행 시 확인했다.
- 공개 파일 기반 테스트는 14개 PASS, 기존 PGlite 원본이 필요한 2개는 의도적으로 SKIP.
  별도 컴파일 앱 HTTP 검증에서 기본 데이터 소스로 5모델 × 2목표=10개 추천 목록이
  원본 모델 JSONL의 해시를 확인한 직접 추천 결과와 일치했다. 기존 B1 Top-5도 일치했다.
- catalog/tracks의 전체 예시 응답 회귀, health, 잘못된 입력 400, production에서
  활성화 플래그를 켜도 5모델 모두 404, opt-in 미설정 차단을 독립 환경에서 확인했다.
- 곡 수 27,948개·고유 Spotify ID 27,948개·15개 문자열 컬럼과 payload의 바이트 수/SHA-256을
  재검증했다. 원본 .local DB는 열거나 변경하지 않았고 원본 모델 JSONL은 읽기만 했다.
- 출처/사용 조건 기록을 보존했다. 추천 알고리즘·정규화 SQL·기존 라우터·공용 의존성의
  변경은 없으며 제외 대상 DB/체크포인트/인증정보/빌드 산출물은 업로드하지 않는다.

## 승인된 축소 추천 데이터셋 v1 — 완료

- 사용자가 공유 권한 확보와 GitHub 포함을 확인했다. `data/experiment-v1`에 songs.jsonl,
  normalization.json, manifest.json, README 및 LF 고정 .gitattributes를 생성했다.
  허가 원문·추가 라이선스 조건은 미제공 상태로 명시하고 임의 오픈 라이선스는 부여하지 않았다.
- 27,948곡을 15개 문자열 필드로 저장한다. 고유 정규화 축 6개·원본 축 4개·실험/Spotify/source ID·
  곡별 ReccoBeats source version과 공통 MuSe 버전을 보존한다. 데이터는 8,386,373 bytes,
  정규화 설정은 2,928 bytes이며 원본 점수/좌표를 Number로 다시 저장하거나 정규화하지 않았다.
- 기존 PGlite VIEW의 5모델 × 27,948행=139,740행 전체 14필드와 생성·재조회 결과가 일치했다.
  원본 실험 디렉터리 파일 전체 SHA-256은 생성 및 HTTP 비교 전후 불변이다.
- 개발용 API는 기본 dataset 파일 어댑터를 사용하며 명시 source=pglite는 기존 방식을 유지한다.
  운영 서비스·기존 GET·production 차단·미검증 상태는 유지하고 데이터 소스 오류를 fallback하지 않는다.
- 빌드·엄격 타입 검사 PASS. 신규 데이터셋 및 기존 HTTP 검사 34개 모두 PASS:
  5모델의 전곡 필드 일치, 각 모델 2요청의 두 방식 HTTP 응답 전체 일치, checksum 손상 거절,
  verified=true 거절, 누락 파일 503, 운영 404와 기존 API 회귀를 포함한다.
- 원본 CSV/DB/체크포인트·응답 본문·추가 메타데이터·인증정보는 공유하지 않는다.
  실제 데이터의 Git 포함은 이번 승인된 data/experiment-v1만 예외이며 .local 제외는 유지한다.
  Spotify 호출·재수집·DB migration·원본 쓰기·검증 상태 변경·commit/push는 수행하지 않았다.

## GitHub 업로드 전 최종 검토 — 완료

- `.gitignore`에 dist, TypeScript 증분 빌드 산출물, 루트 로컬 환경파일 제외를 추가했다. 기존 파일은 삭제하지 않았다. node_modules와 음악 .local의 기존 제외 규칙도 확인했다.
- 기본 앱의 실제 환경변수 설정에서도 production+활성화 플래그가 404인지 검사하는 회귀 테스트를 보강했다. 빌드와 HTTP 검사 13개 모두 PASS, 컴파일된 앱의 B1 Top-5도 이전 결과와 정확히 일치했다. HTTP 검사 전후 원본 실험 파일 전체 SHA-256 불변을 확인했다.
- 업로드 후보 12개 파일에서 실제 Spotify ID 리터럴, 로컬 절대경로, 주요 비밀키·인증정보 패턴이 발견되지 않았다. 제외 대상의 Git 추적은 0개이며 기존 라우터·타입·추천·정규화·공용 의존성은 변경하지 않았다.
- 최종 후보는 신규 5개와 수정 7개다. 스테이징·commit·push는 수행하지 않았다. 비공개 로컬 입력과 PGlite 의존성이 없는 환경에서는 실제 데이터 테스트가 불가능하며, 개발용 API는 누락 시 503을 반환한다.

## 개발용 실험 추천 HTTP 통합 — 완료

- `/api/dev/music/recommendations` 추가. development와 명시 활성화 플래그를 모두 요구하며 production/test/미설정 환경은 404다. 기존 catalog/tracks는 유지한다.
- 기존 DTO·추천·실험 경계와 조회기를 재사용한다. 원본 DB의 임시 사본을 READ ONLY로 조회하며 Spotify ID 목록과 실험 표시만 반환한다. 운영 RecommendationService에 실험 ID/가짜 메타데이터를 전달하지 않는다.
- `corepack pnpm install --frozen-lockfile` 및 `corepack pnpm build` 성공. 공용 package/잠금 파일 변경 없음. 엄격 integration 타입 검사도 통과했다.
- 실제 localhost HTTP 검사 12개 PASS: 5모델 직접 추천 대조, 잘못된 입력/누락 DB·manifest, 운영 비활성화, 기존 GET, 동시 요청과 전체 원본 실험 파일 SHA-256 불변. 컴파일된 앱의 별도 HTTP B1 요청도 이전 로컬 Top-5와 일치했다. 실제 ID는 추적 파일에 기록하지 않았다.
- 기존 추천 22개와 합성 SQL/정규화/VIEW 검사 67개 PASS. Spotify 호출·재수집·운영 DB 적재·원본 DB 쓰기·verified 전환·commit/push 없음.
- 실행/계약은 integration/README.md를 따른다. 정식 운영 전환에는 이용 조건·원본별 매칭 검증, canonical songs/메타데이터, PostgreSQL 연결, 매장 인증·대기열·프런트엔드 계약을 별도 확정해야 한다.

## Git 공유 문서 정제

실제 곡 식별정보·개별 감정값·태그 가중치를 제거하고, 공개 조건이 미확정인 ReccoBeats 기반 실측 결과는 로컬 보존 위치만 안내한다. 가상 예시는 실제 관측이나 연구 결과가 아니다. [공유 결과/범위](reports/README.md)와 [재현 안내](reports/REPRODUCING.md)를 기준으로 읽는다. 원본 연구·구현·DB를 수정하거나 실험을 다시 실행하지 않았다. 최종 파일 검사는 reports/verification.json에 기록한다.

## MuSe 선정·매칭 편향 검증 완료 — PASS (연구 이력)

- 전체 90,408행→ID 보유 61,902행→고유 ID 60,741개→공통곡 27,948개를 재확인했다. 단일행 ID 59,678개, 중복 1,063그룹/2,224행 중 V/A 충돌 965그룹이며 병합·대표좌표 확정 없이 별도 분석했다.
- 전체→공통 raw 평균은 V 5.45388→5.49709, A 4.31720→4.29112다. SMD +0.02783/−0.02246, KS 0.01702/0.02459, SD 비 0.99922/1.01140으로 전역 이동은 작다. 사분면 최대 변화는 이론 1.038%p·관측 1.668%p다. ID 보유 단계 변화 일부를 이후 매칭이 상쇄했다.
- 세부 밀도 차이는 남는다. 전체→공통 TV는 20/40/80-bin 이론 0.0599/0.0808/0.1204, 관측 0.0655/0.0875/0.1338이다. 표본 크기·bin 의존성을 명시했고 이를 편향된 곡 비율이나 독립표본 유의확률로 해석하지 않는다. 중복의 ID 균등 가중 민감도 및 가능한 고유 ID 평균/사분면 범위도 저장했다.
- 기존 반경 .4에서 B1 빈 목표 7개·B2 빈 목표 4개는 전체 MuSe에서도 모두 주변 0행이다. B1의 나머지 부족 목표는 전체 9행→공통 5곡이다. 주요 경계 빈 영역은 최종 매칭 이전부터 존재하며, B1/B2 거리 차이는 고정 정규화의 축척/원점 변화와 구분해 해석한다. 추천 품질·감정 정확도 우열은 검증하지 않았다.
- `.local/muse-selection-bias-20261020-v1/`: 통합/개별 PNG 4개·REPORT·14집합 통계·단계 비교·중복 근거·재현 코드/입력 SHA. 좌표 전수 대조·원본 불변·50건 목표 주변 검증·PNG CRC/크기 PASS. 실제 verified/서비스 상태·원본·기존 실험·추천 함수·팀 백엔드 불변, 외부 API/공유 DB/commit/push 없음.
- 다음 작업: 동일 공통곡의 중앙/경계·밀집/희박 영역을 층화한 블라인드 청취 평가 프로토콜 확정. 중복 ID는 수동 검토 전 보류하며 전체 음악 카탈로그로 일반화하지 않는다.

## 5모델 비교 실험 완료 — PASS (비교 실험 근거)

기존 5모델 비교 실행과 검증 이력은 비공개 로컬 결과에 그대로 보존했다. 공개 수치와 한계는 [B1/B2 공유 보고서](reports/model-comparison-20261020/REPORT.md)를 따른다. A/C1/C2 실측 거리·부족률·겹침률·좌표 분포는 공개 조건 확인 전 제외했다.

모델 정의·공통 집합·25개 고정 목표·Top-20·동일 가중치/제외/초기 반경/확대 조건은 유지한다. 짧은 거리나 높은 충족률은 감정 정확도의 증거가 아니며 청취 평가는 별도다. 기존 추천 함수와 팀 백엔드, 실제 verified 상태를 변경하지 않았다.

## 동일 공통곡의 5모델 실험 데이터 준비 — PASS (비교 입력 근거)

- 확인한 건수는 로컬 PGlite의 `music.songs=0`, `music.song_sources=118,356`(원본 관측), `music.emotion_scores=417,528`(정규화 버전별 점수)이다. 점수→source FK는 실제 연결됐고 고아 0, source→song의 단일/복합 FK는 validated지만 모든 song_id는 NULL로 보류다.
- 실제 `music.recommend_*`는 songs와 verified+selected source를 JOIN하므로 모두 0곡이다. 후보 수는 candidate Spotify ID와 필요한 점수를 연결해 A/C1/C2 각 27,948·B1/B2 각 59,678로 재확인했다. 이번에는 그 교집합 27,948곡으로 5모델을 동일하게 제한했다.
- 최종 실험 경로: `.local/music-experiment-20261020-v3/`. 별도 snapshot의 `music_experiment.common_songs` 27,948행/실험 VIEW 5개와 JSONL 5개를 구성했다. 실험 ID는 canonical song_id가 아니며 실제 verified=0·실제 VIEW=0을 유지한다. 중간 v1/v2 사본은 미완료/미채택이며 v3 PASS manifest만 사용한다.
- 모델마다 공통 코호트와 ID 매핑·범위·결측/중복을 대조했다. MuSe B1/B2의 좌표 동률은 보존하고 ReccoBeats 기반 동률/분포 수치는 공유하지 않는다. 중복 원본의 임의 병합·verified 승격은 없다.
- 검증 PASS: 원본 점수 167,688개·Decimal 축 좌표 279,480개·재개봉 READ ONLY 조회/JSONL 전수 139,740행 일치. 기존 추천 테스트 22개·실험 입력/guard/Top-10 51개·strict TypeScript 검사 PASS. 원래 통합 DB 1,008개 파일과 수집 보호 파일 323개 SHA256 불변.
- 기존 SQL/PGlite/후보/행 해시 도구를 재사용했다. 새 실험 전용 SQL·준비/조회기·14열 타입 어댑터·검증기를 추가했고 기존 추천 알고리즘/팀 백엔드는 변경하지 않았다. 외부 API/공유 DB·Git commit/push 0. `pnpm build`는 pnpm 부재로 미실행이다.
- 요약 근거: v3의 `result.json`. 상세는 `manifest.json`, `decimal-verification-v2.json`, `algorithm-input-verification.json`, `database-query-verification.json`이다. 다음 작업은 고정한 목표 좌표·가중치·제외·반경·Top-K 조건에서 5모델 추천 결과 비교다. 실제 서비스 승격·원본별 독립 검토·저장 권한/팀 통합 문제는 별도로 유지한다.

## MuSe·ReccoBeats 격리 통합 완료 — PASS (실험 입력 근거)

- 새 DB `.local/music-integrated-20261020-v1/database/pgdata`에 sources=118,356·scores=417,528 적재 완료. 고유 Spotify 후보 60,741개, 양쪽 좌표 공통 후보 27,948개다. 실제 songs·verified=0이며 원본 소스는 모두 pending·미선택·song_id NULL이다.
- 기존 SQL/VIEW/변환기/영속 로더/replay를 재사용했다. MuSe 원본 90,408행과 중복·결측·1 미만 VA를 보존하고 ReccoBeats 27,948 sources/55,896 scores를 추가했다. 팀 백엔드·알고리즘·공용 의존성은 변경하지 않았다.
- MuSe/ReccoBeats 각 500 sources 커밋 후 중단·별도 프로세스 재개, 전체 재적재 추가 0건 확인. 초기 fingerprint의 문자열 PK 정렬 오류는 숫자 순회·전 행 수 대조로 수정하고 같은 새 DB에서 controller 재개했다. 입력/이전 로그를 덮어쓰지 않았다.
- 최종 검증 이력은 로컬 결과에 보존한다. 실제 서비스 VIEW는 verified+selected source를 요구하며 후보 집계와 구분한다. 모델별 후보/좌표 분석 수치는 공개 보류하고, 출처/PK·좌표 연결 및 상태 미전환 계약은 유지한다.
- 기존 SQL 합성 67개 + 신규 PK/FK/UNIQUE·불변/충돌 replay·범위·합성 연결 16개 PASS. 적재/좌표 assertion 8,920,356개, score orphan=0, 모든 행 fingerprint 재적재/재개봉 일치. 보호 입력 323개 SHA256 불변, 외부 API/DB 연결 0, Git commit/push 0이다. 구문 검사 PASS, 앱 빌드는 pnpm 부재로 미실행이다.
- 최종 근거: `.local/music-integrated-20261020-v1/runs/333f56bc-995c-41b6-82a7-c6f30b238697/result.json`. 후보 검증 조회 지연으로 verify 작업만 종료하고 새 DB의 ANALYZE/NOT MATERIALIZED CTE 적용 후 `--finish`로 통과했다. 기존 입력·적재 데이터·앞선 실행 근거는 보존했다.
- 남은 문제: 독립 원본별 검토·중복 ID 1,063그룹 해결·명시적 소스 선택·제공자 저장/재사용 조건·팀 DTO/배포 합의. 실제 verified 전환·운영/공유 DB 적용은 수행하지 않는다.

## 전체 수집 최종 검증 완료 (통합 입력 근거)

전체 수집 완료·원본/체크포인트 보존·SQLite/FK/정규화·매칭 상태의 검증 이력은 .local/reccobeats-final-verification-20261020-v2/에 보존했다. 초기 v1은 검증기의 스키마 가정 오류 이력으로 남기며 채택 결과와 구분한다.

공개 문서에는 ReccoBeats 실측 요청/응답·매칭/확보율·좌표/분포·단계별 분석 수치를 싣지 않는다. 모집단/공통 코호트 규모와 원본 상태 보존, verified 미전환은 프로젝트 메타데이터로 설명한다. 원본 결과는 수정하지 않았다.

## 이전 단계 기록 (2026-10-19)

당시 사용자 중단 checkpoint와 완료/미완료 작업·시도 이력은 그대로 보존했다. 실측 확보량·대기량·통신 수치는 로컬에만 남기며 여기서는 다중 조회 구현과 오프라인 검증의 경계를 설명한다.

### 다중 특징 조회 구현 (2026-10-19)

- `collectors/reccobeats_multifeature.py` 추가. 기존 Engine의 선택/URL/응답/완료 훅을 사용하며 `reccobeats_full.py`는 기본 최대 40곡, `--feature-batch-size 1`은 미묶음 작업의 기존 단곡 처리다. 이미 묶인 배치는 옵션 변경 후에도 부모로 재개한다. 옛 코드 버전으로 되돌려 실행하지 않는다.
- 메타데이터 10곡 조회·엄격 매칭·보류 정책 유지. UUID와 Spotify href를 함께 검증해 순서 변경을 허용하고, 누락은 별도 보류·자동 재조회 없음. 중복/불일치/잘못된 응답은 점수/완료 원자 롤백. 배치 404는 실패 보류, 403 sticky 중단, 429 전역 대기, 5xx/통신 실패 최대 3시도 유지.
- 기존 checkpoint를 읽기 전용으로 확인한 뒤 새 사본에 합성 응답을 주입해 배치·중단/재개·완료 재실행·원본/lineage 보존을 검사했다. 실제 점수/시도/완료 건수는 로컬에만 보존한다.
- 근거: `.local/reccobeats-multifeature-offline-20261019-v1/copied-checkpoints-v2/verification.json`, `request-estimate.json`. 최초 검증은 0바이트 WAL 존재를 엄격 차단해 중지했으며, 빈 WAL만 허용한 뒤 새 v2 폴더에서 완료했다. 기존 원본은 수정하지 않았다.
- 검증: Python 전체 105/105 PASS(신규 12개 포함, 33.68초), 추천 회귀 22/22 PASS, 격리 메모리 PGlite 정규화/VIEW·적재 검증 4,065개 PASS. `pnpm build`는 pnpm 명령 부재로 실행 불가이며 설치하지 않았다. 기존 `.local` 파일 2,520개 SHA256 대조에서 변경/삭제 0건 PASS. 로그·보존 검증은 위 새 검증 폴더의 `python-tests.log`, `sql-view-validation.json`, `protected-verification.json`에 있다.
- 예상 잔여 비용은 약 18,488회/15.41시간 → 3,672회/3.06시간. 3초 간격과 현재 적격률 약 46.01%를 가정한 조건부 추정이며 실제 배치 속도·누락 의미는 미검증이다.
- 실제 API/수집 재개/verified 전환/공유 DB·팀원 백엔드 변경/Git commit·push 없음. 실제 소규모 검증은 SPEC 9절의 1요청 명령을 별도 실행 지시 후 사용한다.

### 이전 준비 단계 기준 (2026-10-18)

당시 누적 연구 checkpoint의 완료·원본 보존·SQLite/FK·정규화·hold 상태를 읽기 전용으로 감사했다. 실제 매칭/확보율·요청/응답 건수는 공유하지 않으며 원래 기록과 그 이후 완료 이력을 구분한다.

### 전체 60,741-ID 수집 준비 (2026-10-18)

- 추가 대상 50,741개를 기존 seed/hash 순위의 정확한 여집합으로 고정했다. 원본 체크섬·seed·ID 목록 SHA256·기존 결과 감사·추정은 `.local/reccobeats-full-preparation/preparation.json` 및 `additional-spotify-ids.txt`에 있다. 원본/이전 수집 폴더는 초기화하지 않았다.
- 새 `collectors/reccobeats_full.py`는 기존 수집 엔진/전송/선정/체크포인트를 재사용한다. 기존 연구 모듈은 명시적 full 모드의 1,000개 단위/마지막 741개 인계를 허용하고, 기존 10,000개 진입점의 상한은 유지한다. 실제 수집 경로는 `.local/reccobeats-full-v1/`이며 아직 시작하지 않았다.
- 전체 dry-run 완료: 누적 60,741개·51개 구간(1,000개 단위 및 마지막 741개), 추가 합성 요청 54,942회. 기존 실제 이력 5,542회까지 포함한 체크포인트 시도는 60,484회다. 합성 좌표와 실측 커버리지는 구분한다. 실제 API 호출 0, 기존 요청 재호출 0, 모든 완료 구간 재실행 추가 요청 0, 첫 1요청 경계 중단 후 동일 체크포인트 재개 PASS. 최종 SQLite/FK·정규화·전체 10,000개 원본 직접 대조 감사 PASS.
- 결과는 `.local/reccobeats-full-dry-v1/`의 구간별 `verification.json`·`replay-verification.json`·`milestones.json`에 있다. 최종 독립 감사는 `.local/reccobeats-full-preparation/verification.json`, 자동 테스트는 `tests.log`에 기록했다. 기존 연구 결과/체크포인트와 알고리즘·DB·연동 모듈·백엔드·기존 `.gitignore` 등 보호 대상 103개 파일의 SHA256 불변 PASS. 실제 수집 경로 미생성도 확인했다.
- 추가 수집 조건부 추정: metadata 5,075 + 특징 약 23,036 = 28,111요청, 약 23.43시간(3초 간격); 모두 특징 조회하는 보수적 시나리오 55,816요청·46.51시간. 5% 계획 여유 시 약 24.60/48.84시간. 로컬 인계/감사·지연·429·중단은 별도이며 공식 quota나 확보량 보장이 아니다.
- 공식 약관/호출 제한 문서만 재확인했다. 수집 API 호출 0, 실제 verified/공유 DB 적재 0, Git commit/push 0. 알고리즘·팀원 백엔드·DB 코드·기존 `.gitignore` 변경 없음. SPEC/PLAN/collectors README에 조건/명령을 기록했다.
- 2026년 12월 실제 프로젝트 종료 후 모든 기존/추가 연구 데이터·목록·로그·체크포인트/WAL/SHM·보고서·내보내기·백업/동기화 사본 삭제와 잔존 확인 계획 유지. 단기 연구 보관도 약관 적용 대상이며 대량 저장/재사용 권한은 미확인이다.
- `pnpm build`는 pnpm 명령 부재로 실행 불가. 설치/공용 의존성 변경은 하지 않았다. 이번 변경은 Python 수집 준비에 한정되며 Python 전체 검증을 별도로 기록한다.
- Python 전체 자동 테스트 85/85 PASS (`tests.log`, 약 24.57초). 추가 테스트는 full 범위/최종 741개 상한, 완료 미반환 재호출 금지, 429 대기·재개, 403 sticky 중단, 5xx 최대 3시도/실패 시 확대 중단을 검증했다. 기존 80개도 포함하며 모든 테스트는 합성/모의 전송이다.

### 사용자 요청 일시 중단 (2026-10-17)

- 새 요청을 차단하기 위해 수집 프로세스를 일시 정지하고 체크포인트 `not_before`에 보수적 1시간 대기를 저장했다. 기존 진행 요청 1건만 정상 완료시킨 뒤 프로세스를 종료했다. 정리 전후 attempts=2,100으로 새 요청 0건. 수집 프로세스/자식 프로세스가 남지 않았으며 예약 재개도 없다.
- 당시 조회·매칭·확보·미완료 작업의 실제 수치는 비공개 pause/progress/summary 기록으로 보존한다. 완료/미확정 작업을 임의 초기화하거나 재전송하지 않는다.
- 기존 데이터·완료 기록을 삭제/초기화하지 않았다. 현재 DB `fixed-4000-v1/checkpoint.sqlite`, 정지 증거 `expansion-10000-v1/pause.json`, 최종 중단 집계 `paused-summary.json`·`progress.json`, 구간 기록 `milestones.json`은 모두 기존 gitignored 연구 경로에 보존했다. WAL 체크포인트 정상 완료, SQLite/FK/Decimal/기존 요청 보존 감사 PASS.
- 내일 재개: `python -B src/music/collectors/reccobeats_tenthousand.py --research-live`. 기존 완료 구간은 추가 API 없이 통과하고 현재 4,000개 체크포인트의 미완료 요청부터 진행한다. 저장된 1시간 대기는 내일이면 만료되며 429/403·uncertain 안전 규칙은 유지한다. 현재 프로세스는 종료된 상태다.

### 이번 누적 10,000개 연구 검증 (2026-10-17)

단계별 실행·진단 이력은 .local/reccobeats-research/expansion-10000-v1/에 그대로 보존한다. 실제 곡 식별정보·제공자 응답/매칭률·좌표·실측 성능 분석은 공유하지 않는다. 체크포인트 인계·중복 요청 방지·상태 보류·오류 분류 계약과 합성 검증을 실제 데이터 공개 및 매칭 승인과 구분한다.

### 이전 1,000개 연구 실험 (2026-10-17)

단계별 실행·진단 이력은 .local/reccobeats-research/fixed-1000-v1/에 그대로 보존한다. 실제 곡 식별정보·제공자 응답/매칭률·좌표·실측 성능 분석은 공유하지 않는다. 체크포인트 인계·중복 요청 방지·상태 보류·오류 분류 계약과 합성 검증을 실제 데이터 공개 및 매칭 승인과 구분한다.

### 이전 100개 연구 실험 (2026-10-17)

단계별 실행·진단 이력은 .local/reccobeats-research/fixed-100-v1/에 그대로 보존한다. 실제 곡 식별정보·제공자 응답/매칭률·좌표·실측 성능 분석은 공유하지 않는다. 체크포인트 인계·중복 요청 방지·상태 보류·오류 분류 계약과 합성 검증을 실제 데이터 공개 및 매칭 승인과 구분한다.

### 이전 5단계 완료

후속 5단계(영속 DB↔추천 알고리즘·API 연동 모듈 준비) 완료. 실제 테이블/FK 선행 gate 통과 후 integration/에 어댑터·DTO·서비스·프레임워크 독립 HTTP 응답 모듈을 구현했다. 기존 백엔드/라우터/Track·추천 함수·SQL은 변경하지 않았다. 실제 HTTP 서버 연결은 하지 않았다.

### 이번 5단계 검증 (2026-10-17)

- 선행 구조 확인: songs 0행=검증된 canonical 곡, song_sources 90,408행=원본 관측, emotion_scores 361,632행=소스별 정규화 4점수. 점수 FK는 sources를 참조한다. sources.song_id의 NULL은 pending에 허용된다. FK 3개 validated·고아 score/고아 song 연결/ID 충돌/비pending source 모두 0. 구조 불일치 없음. 근거 .local/api-validation/stage5-v1/gate.json.
- repository.ts는 VIEW 허용 목록·바인딩된 제외 ID·text로 캐스팅한 bigint/numeric·JSONB를 처리한다. 14열과 같은 SELECT의 표시 정보를 분리해 기존 recommend에 전달한다. 조기 후보 LIMIT/점수 fallback/verified 승격/쓰기 SQL은 없다.
- DTO는 별도 endpoint 초안이다. 입력 0~1→내부 -1~1→응답 0~1. songId 등 문자열·durationMs/null·reccobeatsId/null·이미지 null·정규화 버전으로 반환하며 requestStatus/가짜 UUID를 만들지 않는다. 클라이언트·서버 대기열 제외를 합치고 중복/출처·표시 충돌/잘못된 값은 구분한다. 팀 기존 Track 계약은 미변경/미합의다.
- `node src/music/.local/algorithm-validation/node_modules/typescript/bin/tsc -p src/music/integration/tsconfig.check.json` PASS. 산출물은 .local/api-validation/build 아래에만 생성했다. 기존 recommend.ts 및 기존 알고리즘 산출물은 변경하지 않았다.
- `node --test src/music/integration/recommendation.test.mjs src/music/algorithm/recommend.test.mjs` → 신규 18+기존 22=40개 PASS, 약 3.986초. 합성 125곡의 실제 SQL VIEW 5종→추천 함수 순서 대조, 0/0.5/1 변환·상한/부족/빈 결과·중복/제외·SQL injection·bigint/JSONB·입력 400/DB 503/데이터 및 서버 문맥 500·오류 비노출을 확인했다. 이 시간은 API 응답 성능 보장이 아니다.
- 실제 파일 DB도 READ ONLY 트랜잭션에서 5 VIEW→서비스→DTO를 실행해 모두 no-candidates/0곡을 확인했다. songs/source/score 건수와 pending 유지. 양성 fixture는 별도 메모리 DB에만 생성하고 close로 폐기했다. 실제 음악의 verified 전환·실제 ReccoBeats 영속 적재는 0건이다.
- 전체 프로젝트 noEmit 검사도 실행했으나 기존 루트 의존성/타입 부재로 14개 진단(exit 1). pnpm/루트 node_modules가 없고 설치는 하지 않았다. 연동 모듈의 별도 strict 검사는 통과했다.
- integration/README.md에 제안 POST /api/stores/:storeId/recommendations 연결 예시·승인 client/매장 권한/대기열 canonical ID/DTO/null/수명주기 등 팀 적용 사항을 정리했다. 기존 express.json은 이미 있으므로 중복 추가하지 않는다. 실제 라우터 등록·앱 시작·공유 DB 연결은 미수행이다.
- 검증 기록/소스 해시는 .local/api-validation/stage5-v1/verification.json. 원본·기존 코드/SQL·백엔드/package/lock 변경 없음. 외부 API/공유 PostgreSQL/Railway 접속·새 의존성 설치·Git commit/push 없음. 5단계만 완료하고 종료한다.

### 이전 4단계 완료

후속 4단계(로컬 영속 저장·재실행·VIEW 5종 검증) 완료. 기존 PGlite 0.5.10을 파일 모드로 사용했고 새 의존성/시스템 환경을 설치하지 않았다. 기존 SQL·배치 로더·MuSe 원본·추천 알고리즘·팀원 백엔드는 변경하지 않았다.

### 이번 4단계 검증 (2026-10-17)

- 신규 파일: db/persistent_muse.mjs, db/test_persistent_muse.mjs. DB는 .local/muse-persistent/stage4-v1/pgdata에 보존한다. PostgreSQL 18.6 WASM 단일 프로세스이며 네이티브 서버 배포를 뜻하지 않는다. 외부 연결 URL/접속 환경변수를 사용하지 않는다.
- 저장 건수: songs 0, song_sources 90,408, emotion_scores 361,632. source 모두 pending/song_id NULL/verified_at NULL/근거 NULL/미선택. 고유 후보 60,741개·ID 누락 28,506행·중복 1,063그룹/2,224행·V/A 1 미만 333행을 보존했다. ReccoBeats 실제 source/점수 영속 적재 0건.
- 기존 loader의 500개 source/2,000개 score 배치·전수 정규화 검증을 재사용했다. 동일 자연 키의 source 전 입력 컬럼·점수 원본이 다르면 INPUT_CONFLICT로 거부한다. 이미 있는 행을 갱신/병합하지 않으며 누락분만 INSERT한다. canonical 곡이나 대표 source를 자동 선택하지 않는다.
- 최초 500개 source 커밋 후 프로세스 종료·다음 프로세스에서 500개/2,000개 유지 확인. 초기 체크섬 코드의 문자열 ID 정렬 오류를 숫자 PK 정렬+전수 행 수 assert로 수정했다. 당시 진단 파일은 보존했으며 데이터 삭제 없이 같은 DB에서 수정 후 전체 재검증했다.
- 최종 실행 `node src/music/db/test_persistent_muse.mjs` → PASS. Node 프로세스 4개를 순차 실행·종료했고 두 번의 전체 입력 감사/replay에서 각각 4,068,906개(총 8,137,812개) assertion 통과. 새 source/score 0건, 전체 저장 행 ID/내용 fingerprint가 재개봉 전후 동일하다. 최종 프로세스도 close 완료.
- 예상 제약/충돌 거절 12건: source PK/자연 키 UNIQUE, score UNIQUE/FK, songs Spotify UNIQUE, source 복합 FK, pending 추천 선택/불완전 verified 금지, 원본·점수 불변, 서로 다른 원본/점수의 replay 거부. 합성 source의 rejected→pending 및 전체 트랜잭션 ROLLBACK, manifest 불일치 거부도 통과했다. 실제 source의 verified 전환은 0건이다.
- VIEW A/B1/B2/C1/C2 모두 0행·각 14열 조회 성공. 실제 pending source의 정상 빈 결과다. 양성 VIEW·축/정규화·선택 규칙은 기존 `node src/music/db/validate.mjs`의 별도 메모리 합성 fixture 67개가 통과했다. 합성 검증은 실제 데이터에 섞지 않았다.
- 최종 보고서: .local/muse-persistent/stage4-v1/runs/35168d92-10a6-4a4a-b4ee-0b0148c44e96/result.json. SQL·입력 manifest는 같은 저장 루트의 schema-manifest.json. 초기 실패 진단과 최종 PASS를 구분한다. 신규 코드/문서·추가 검증 근거는 같은 최종 run의 verification.json에 기록한다.
- 외부 API 호출·Railway/공유 PostgreSQL 접속·새 의존성 설치·Git commit/push 없음. 실제 DB 드라이버/추천 API/백엔드 연결·네이티브 서버 동시성/권한/강제 종료 복구는 미검증이다. TypeScript는 변경하지 않아 반복 빌드하지 않았고 기존 전체 앱 빌드 차단은 유지한다.
- 4단계만 완료하고 종료한다. ReccoBeats 실제 수집/저장, 실제 곡 검증·승격, 배포나 다음 단계 구현은 수행하지 않는다.

### 이전 3단계 완료

후속 3단계(ReccoBeats 운영 배치 엔진 구현·오프라인 검증) 완료. 기존 PowerShell→Python 파서 및 2단계 정책을 재사용해 reccobeats_batch.py·test_reccobeats_batch.py를 추가했다. 실제 전송과 점수 저장은 잠겨 있으며 합성 dry-run만 실행했다.

### 이번 3단계 검증 (2026-10-17)

- 기존 전체 원본의 checksum/정제 검증 기록을 확인하고 60,741개 고유 ID를 고정 정렬·10개 묶음으로 등록했다. 관련 원본 61,902행을 보존하며 중복 1,063그룹은 특징 큐에서 보류했다. 원본별 판정은 전부 hold, 실제 verified는 0개다.
- `python -B src/music/collectors/reccobeats_batch.py --dry-run --max-requests 200` → 메타데이터 작업 200개 경계 중단. 같은 경로에서 `--dry-run`으로 재개 → completed. 총 메타데이터 6,075개+특징 59,678개=65,753개 합성 요청, 모두 시도 1회/정상 완료. 실패·재시도·중복 작업 key 0개.
- 완료 체크포인트 재실행은 전송 호출 0회·추가 시도 0회, SQLite integrity_check=ok. 최초 중단 실행 2.175초, 재개 실행 332.912초. 입력 로딩 전부를 포함한 시간은 아니며 실제 API 성능이 아니다. 합성 시계 누적 대기 131,504초는 벽시계 대기가 아니다.
- 특징 59,678개의 both_available은 합성 fixture 결과로 실제 V/E 확보/실매칭률이 아니다. 실제 API 호출 0회·감정 값 영구 저장 0건·공유 DB 변경 0회. UUID/ID/원본 참조·비교 boolean/hold·진행/시도만 로컬 SQLite에 저장했다.
- 신규 18+기존 51=69개 테스트 통과(1.000초). 명령: collectors에서 `python -B -m unittest test_reccobeats_batch test_matching_audit test_clean_muse test_spotify_validate test_reccobeats_probe`. 정상 중단/재개·완료 중복 방지·OS 잠금·manifest 불일치·403/429/5xx/네트워크·HTTP-date·전역 예산·inflight 강제 종료·UUID 충돌·부분/잘못된 특징·비저장을 검증했다.
- SQLite는 WAL+synchronous FULL이며 감정 데이터 적재 DB가 아닌 로컬 상태 저장소다. 강제 종료의 inflight는 uncertain으로 보류한다. 명시적 중복 위험 확인 전 재전송하지 않으며 외부 HTTP와 로컬 커밋 간 exactly-once를 보장한다고 주장하지 않는다.
- 산출물: .local/reccobeats-batch/full-dry-run-v1/checkpoint.sqlite·summary.json·verification.json. 현재 신규 코드/테스트 해시·입력 원본 해시·dry-run 결과를 verification.json에 기록했다. 기존 MuSe/추천/SQL/수집 코드·팀원 백엔드/package/lock 변경 없음. 기존 .gitignore 변경도 보존했다.
- SPEC 5.1/PLAN/PROJECT/collectors README의 현황을 갱신했다. TypeScript/SQL은 바꾸지 않아 해당 검증은 반복하지 않았으며 1단계의 의존성/전체 빌드 차단은 유지한다. API·대량 수집·점수 저장·DB/백엔드 연결·Git commit/push 없이 이번 단계에서 종료한다.
- 실수집 전 제공자 허용/제3자 조건/quota·클라이언트 확인, 저장 sink/TTL/삭제 정책, 별도 실행 허용과 소규모 실제 시험이 필요하다. 원본별 독립 매칭 검토도 미완료다.

### 이전 2단계 완료

후속 2단계(음악 ID 매칭·중복 처리·검증 기준) 오프라인 작업 완료. SPEC 2.1의 원본별 검토 규칙을 확정하고 matching_audit.py·test_matching_audit.py를 추가했다. 실제 소스/DB/verified 상태는 변경하지 않았다. 아래 1단계 내용은 이전 결과다.

### 이번 2단계 검증 (2026-10-17)

- 기존 전체 MuSe 원본 checksum·정제 stats 검증을 확인하고 90,408행을 오프라인 분석했다. 후보 60,741개, 누락 28,506행, 형식 오류 0행. 원본 SHA-256은 실행 전후 동일하다.
- 중복 1,063그룹/2,224행: 2행 981그룹·3행 67·4행 14·5행 1. 정규화 제목만 충돌 870, 아티스트만 충돌 150, 둘 다 충돌 37, 둘 다 동일 6. 원본 id 제외 전 필드 동일 그룹 0, V/A 충돌 965, VAD 충돌 970, 비결측 MBID 충돌 304. 제목·아티스트 동일 6그룹 중 5개도 점수가 달라 자동 대표 선택 금지다.
- 제공자와 원본의 제목/아티스트 불일치는 중복 충돌과 별도로 검토한다. 실제 대상 ID·곡명·관측별 판정은 로컬에만 보존하고 독립 근거 없이는 상태를 승격하지 않는다.
- 실제 표본 10곡 모두 독립 검토 근거가 없어 hold/pending/미선택. ID·메타데이터 일치 또는 V/E 추출 성공을 verified로 해석하지 않는다. 실제 verified 0개, 새 감정 데이터 저장 0건, API/DB 호출 0회.
- `python -B -m unittest test_matching_audit test_clean_muse test_spotify_validate test_reccobeats_probe`(collectors 디렉터리) → 신규 14+기존 37=51개 통과, 0.054초. 합성 transport를 사용하며 외부 호출 없음. 실제 데이터 감사는 `python -B src/music/collectors/matching_audit.py`로 완료했다.
- 결과는 .local/matching-audit/stage2-v1/의 stats.json·duplicate-groups.jsonl·reccobeats-review.json. 기존 원본/정제/10곡 결과는 읽기만 했고 원격 제목·감정 값은 복사하지 않았다.
- Python 코드만 추가했으므로 TypeScript/SQL 검증은 반복하지 않았다. 1단계의 pnpm/루트 의존성 부재와 전체 빌드 차단은 그대로다. 기존 백엔드·SQL·수집 코드 변경, 공유 DB 변경, Git commit/push 없음.
- 3단계의 격리 DB/어댑터 설계는 가능하다. 실제 검증 곡·권한·팀 API 계약·빌드 환경을 갖춘 서비스 연동은 아직 차단돼 있다. 이번 작업은 여기서 종료한다.

### 이전 1단계 완료

후속 1단계(문서·인터페이스 계약·빌드 점검) 완료. 아래 구현 현황은 기존 완료 범위를 뜻하며 이번 코드 구현은 없다. PROJECT/PLAN/SPEC/STATUS만 수정했다. SPEC 6.1~6.3의 권장 변환·DTO 계약은 팀 미합의 상태다.

### 이번 1단계 검증 (2026-10-17)

- 전체 빌드: pnpm 명령 및 루트 node_modules 없음. 설치하지 않았으며 pnpm build는 실행 불가. 기존 .local TypeScript 7.0.2로 `node src/music/.local/algorithm-validation/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --incremental false` 실행 → 실패(exit 1). express/cors/Node 타입 누락 및 연쇄 implicit-any 등 14개 진단. 현재 결과만으로 코드 결함/전체 빌드 성공을 판단하지 않는다.
- 추천 타입 검사: 같은 컴파일러로 `-p src/music/algorithm/tsconfig.check.json --noEmit --incremental false` → 통과(exit 0). 파일 생성 없음.
- `node --test src/music/algorithm/recommend.test.mjs` → 22/22 통과, 약 1.815초. 기존 .local JS를 재사용했으며 recommend.ts·테스트·tsconfig·README·컴파일 JS의 SHA-256이 이전 verification.json과 일치한다. 현재 소스를 새로 emit한 실행은 아니다.
- 5개 SQL VIEW의 공통 14열과 RecommendationViewRow가 형식 호환. DB numeric은 문자열, bigint는 문자열로 전달하는 방식을 권장한다. 실제 DB 드라이버/쿼리 연결은 미구현이다. 알고리즘 결과는 Track이 아니라 row+거리 및 검색 진단이다.
- Git 기준: 기존 .gitignore 수정과 src/music 미추적 25파일 유지. 이번에는 문서 4개만 수정하며 공용 backend/package/lock 및 구현 코드는 보존한다. API·DB 호출, 의존성 설치, Git commit/push 없음.
- 다음 단계 차단: 의존성 복원·전체 빌드, Track 필수 reccobeatsId/좌표·duration·메타데이터/상태 계약 합의, 실제 곡 검증. 제공자 허용 전 ReccoBeats 대량 수집·영구 저장은 계속 보류한다.

### 기존 구현 현황

algorithm/recommend.ts에 5개 SQL VIEW 공통 추천 순수 함수를 구현했다. 가중 거리 정렬·단계적 반경 확대·상한 100곡·제외·중복/충돌·동일 곡 교집합 비교를 지원한다. 별도 strict TypeScript 컴파일과 합성 테스트 22개를 통과했다. 실데이터 조회·백엔드/DB/API 연결·미검증 소스 상태 변경은 하지 않았다. ReccoBeats 대량 수집·영구 저장은 제공자 권한 확인 전 보류 상태를 유지한다.

## 최근 완료
- algorithm/recommend.ts, recommend.test.mjs, tsconfig.check.json, README.md 추가. 기존 music.recommend_a/b1/b2/c1/c2의 공통 14개 출력 열을 재사용하고 논리 A/B1/B2/C1/C2를 허용 목록으로 고정했다. numeric 문자열·정밀한 bigint ID·각 축의 원본/출처/정규화 설정을 보존하며 검증/선택은 SQL VIEW의 신뢰 경계로 둔다. 함수에 DB/API 호출·verified 전환 기능은 없다.
- recommend: 기본 1/1 가중 거리 제곱 오름차순, 동점은 Spotify ID 코드 순서. 반경은 0.1부터 2배씩 확대하고 기본 2*sqrt(wv+wa)까지 탐색한다. radius 경계 포함·0/극소 반경 처리·64단계 종료 보장. 최대 100곡, 부족하면 실제 후보 수만 반환한다. 제한 반경·가중치·제외 곡을 지정할 수 있고 결과에는 반경별 누적 건수가 포함된다.
- 동일한 VIEW 행 반복은 추천 표시만 1개로 제한하며 입력/DB 원본을 변경하지 않는다. 같은 곡의 좌표/출처 충돌, 다른 canonical ID를 갖는 같은 Spotify ID, VIEW 버전 혼용은 오류로 거절한다. 결측/NaN/무한대/범위 밖 값·잘못된 파라미터를 검사하며 1 바로 밖의 SQL 소수 문자열도 Number 반올림 전에 거절한다. 원본 자료 병합/평균·0 대체·정규화 범위 변경은 없다.
- compareViews: 제외 후 동일 canonical song_id/Spotify ID의 5개 VIEW 교집합만 비교하고 VIEW별 커버리지를 별도 반환한다. 각 VIEW의 합성 공통 10,000곡(제외 시 9,998곡)·3종 입력에서 독립 전체 거리 정렬 기준과 추천 순서가 모두 일치했다. 교집합/한 VIEW가 비면 다른 방식으로 대체하지 않고 빈 결과를 반환한다.
- 테스트 22개 통과: 5개 VIEW 계약·반경 확대·동점·극단/원형 경계·상한 100·빈/부족·가중치·제외·중복/충돌·bigint·불변성·입력/메타데이터 오류·교집합·10,000곡 비교. 마지막 전체 테스트 약 1.78초는 합성 검증 실행 시간이며 운영 응답 시간 보장이 아니다.
- .local/algorithm-validation에 TypeScript 7.0.2를 고정 설치했다. strict/NodeNext/ES2022 및 noUncheckedIndexedAccess/exactOptionalPropertyTypes 컴파일 통과. 빌드 산출물·test-results.txt·verification.json은 해당 .local에 보관한다. pnpm build는 pnpm 미설치로 실행 불가, 루트 의존성도 없어 전체 앱 빌드는 미검증이다. 공용 package.json·잠금 파일·기존 backend/SQL/수집 코드는 변경하지 않았다.
- 현재 알고리즘은 메모리 전체 후보 검증·단일 정렬(O(n log n)) 뒤 반경 적용이다. DB 공간 검색·실제 VIEW 조회 어댑터·팀 API/Track 호환성·대기열 연결·검증된 실제 곡의 평가/성능은 후속 작업이다. PLAN 단계 6은 순수 함수 완료, 단계 7은 예정으로 갱신했다. 이번 Spotify/ReccoBeats API 호출·공유 DB 접속/변경·Git commit/push 없음.

### 이전 확대 전 권한·검토 계획
- 공식 약관(2026-05-25)과 Rate Limiting 문서만 재확인했다. 확인된 무인증/무료 개인·상업 이용, 트래픽 제한, 자체 분석 생성, Spotify metadata 제3자 조건 책임과 미확정인 bulk/영구 저장/TTL/가공·재배포 권한을 SPEC 7.2.6에서 구분했다. 명시되지 않은 권한은 허용으로 간주하지 않는다.
- 제공자 문의 7개 질문을 초안으로 정리했다(미발송). 60,741개 후보의 일회/정기 수집 규모·허용 필드/보관/백업·MuSe 결합/정규화/추천/좌표 및 데이터셋 공개·귀속/제3자 권리·배치/속도/클라이언트·재시도·철회/삭제 요건을 묻는다. 서면 답변과 제3자 조건 확인 전 확대/영구 저장하지 않는다.
- 미검증 후보의 실제 ID 목록과 곡별 비교는 공유하지 않는다. pending·추천 미선택을 유지하고 허가된 독립 자료로 서식/버전/녹음 차이 또는 판정 불가를 구분한다. 실제 DB 상태는 변경하지 않았다.
- 요청량 계획은 고유 후보 N, metadata 배치 B, 적격 특징 M을 사용한 Q=ceil(N/B)+M의 일반 구조로 설명한다. 실측 반환율을 넣은 비용/시간 예시는 공유하지 않는다.
- 승인 후 대응 제안: 제공자 quota 우선·동시성 1·보수적 2초 간격, 403 중단, 429 전역 대기/Retry-After 준수, 제한된 transient 재시도와 추가 요청 예산(ceil(5%*Q))·체크포인트. 현재 코드 자동 재시도 0회는 변경하지 않았다. 현 공식 수치 한도는 미확정이다.
- 이번 변경은 SPEC·STATUS뿐이며 문서 근거·수치 산식·참조를 검토했다. 기존 API 결과를 로컬에서 읽고 산술만 계산했으며 앱/DB/테스트 실행은 하지 않았다. 코드·원본·기존 결과·SQL·백엔드 변경 없음.

### 이전 10곡 파이프라인 안정화

단계별 실행·진단 이력은 .local/reccobeats-probe/pipeline-stable-10-v1/에 그대로 보존한다. 실제 곡 식별정보·제공자 응답/매칭률·좌표·실측 성능 분석은 공유하지 않는다. 체크포인트 인계·중복 요청 방지·상태 보류·오류 분류 계약과 합성 검증을 실제 데이터 공개 및 매칭 승인과 구분한다.

### 이전 감정 값 확보 원인 분석

단계별 실행·진단 이력은 .local/reccobeats-probe/feature-structure-2-v1/에 그대로 보존한다. 실제 곡 식별정보·제공자 응답/매칭률·좌표·실측 성능 분석은 공유하지 않는다. 체크포인트 인계·중복 요청 방지·상태 보류·오류 분류 계약과 합성 검증을 실제 데이터 공개 및 매칭 승인과 구분한다.

### 이전 ID 매칭 및 첫 특징 검증

단계별 실행·진단 이력은 .local/reccobeats-probe/에 그대로 보존한다. 실제 곡 식별정보·제공자 응답/매칭률·좌표·실측 성능 분석은 공유하지 않는다. 체크포인트 인계·중복 요청 방지·상태 보류·오류 분류 계약과 합성 검증을 실제 데이터 공개 및 매칭 승인과 구분한다.

### 이전 환경별 접근 준비·첫 403 점검

단계별 실행·진단 이력은 .local/reccobeats-probe/에 그대로 보존한다. 실제 곡 식별정보·제공자 응답/매칭률·좌표·실측 성능 분석은 공유하지 않는다. 체크포인트 인계·중복 요청 방지·상태 보류·오류 분류 계약과 합성 검증을 실제 데이터 공개 및 매칭 승인과 구분한다.

### 이전 Spotify 검증 준비
- collectors/spotify_validate.py와 test_spotify_validate.py 구현. 기존 전체 정제 파일·stats 해시·원본 SHA 및 pending 상태를 검증하고, 고유 ID 60,741개를 모집단으로 SHA256(UTF8(seed + NUL + ID)) 순위의 100개를 선택했다. seed=`muse-spotify-unique-100-v1`, 동점은 ID순이다. 연결된 MuSe 원본은 101행이며 모두 유지하고 제목·아티스트·중복 여부로 표본을 거르지 않는다. 독립 재선정·준비/실행 점검 표본 일치·보고서 해시와 Git 제외도 확인했다. 인증 값 대신 설정 유무만 기록한 environment-check.json을 실행 점검 폴더에 보관했다.
- 환경: Python 3.14.7·표준 라이브러리만 사용. 프로세스·Windows User/Machine 환경에 SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET/SPOTIFY_ACCESS_TOKEN 없음. 알려진 .env 경로도 없으며 자동 dotenv 로드는 구현하지 않았다. 앱 모드·API 접근 권한·Premium 조건은 확인하지 못했다. 공식 Client Credentials/Get Track/Rate Limits 문서만 필요한 범위로 재확인했다.
- 인증 누락 시 --execute가 있어도 토큰/곡 API 호출을 모두 보류한다. 실측 API 요청 0건, 검증 시도 0개, success=0/mismatch=0/unconfirmed=100. 사유는 missing_credentials 100개이며 성공률은 0% 대신 null로 기록했다. 인증 준비 전 실제 ID 존재 여부·제목/아티스트 일치 여부·앱 권한은 확인하지 않았다.
- 인증 설정 후에는 메모리 토큰 발급·만료 갱신·401 한 번 갱신, 명시 market의 개별 Get Track을 사용한다. 요청 간격 1초(공식 quota 아님), 네트워크/5xx 최대 3회 지수 backoff+jitter, 429 Retry-After 준수, 총 대기 예산 120초를 구현했다. 긴 Retry-After를 줄이지 않으며 인증 실패·403·429 재시도 소진 시 나머지를 확인 불가로 남긴다. 404는 market/접근 조건의 실패로 기록하고 전 세계 부재로 확정하지 않는다.
- 비교는 NFKC·casefold·공백 정리 후 제목과 응답의 개별 아티스트가 정확히 같아야 성공이다. remaster/feat 표기 제거·fuzzy 승인·중복 대표행 선택은 하지 않는다. 중복 ID는 모든 원본의 결과를 남기고 하나라도 불일치면 ID별 mismatch다. relinking·불완전 응답·제한 곡은 확인 불가다. 이 success는 비교 정책의 일치이며 DB verified 전환이 아니다.
- 결과: `.local/spotify-validation/sample-100-v1/`는 기본 준비 실행, `.local/spotify-validation/sample-100-preflight-v1/`는 --execute 인증 누락 점검이다. 각 sample.json/results.jsonl/stats.json에 MuSe ID/원본 참조·선정 해시·판정 boolean·고정 사유/HTTP 코드·통계를 기록했다. Spotify 응답 제목/아티스트·새 반환 ID·본문·Authorization·인증 값은 저장/출력하지 않는다. 메타데이터 영구 보관 기능은 권한 확인 전 보류했다.
- Python 테스트 총 23개 통과(기존 9개+신규 14개). 재현 표본·미인증 무호출·중복 전원 비교·불일치/확인 불가·토큰 만료/401·403·404·429 대기/예산·네트워크/5xx·비밀정보 미포함을 합성 transport/가상 시계로 검증했다. 기존 백엔드·공용 의존성·DB 파일은 수정하지 않았고 API/DB/ReccoBeats 실호출과 Git commit/push는 없다. pnpm은 기존 미설치 상태다.

### 이전 전체 MuSe 정제·적재 검증
- 전체 처리: 기존 clean_muse.py의 transform·SQL 설정·analysis/provenance 검증을 재사용하고 all-v1 선택을 추가했다. 전체 90,408행을 원본 순서로 처리한다. 점수·소스·분류는 JSONL에 순차 기록하고 중복 그룹을 인덱스로 집계해 전체 점수 객체의 메모리 누적과 그룹별 원본 반복 탐색을 제거했다. 0~9 이론 범위·전체 원본 관측 범위를 유지했다.
- 원본 보관과 실제 songs 적재 대상을 구분했다. sources는 전체 원본 id별 90,408개이며 candidate_spotify_id는 중복을 허용한다. songs UNIQUE 대상에 미검증 후보를 넣지 않는다. 고유 후보 60,741개 중 단일 원본 ID 59,678개·중복 그룹 1,063개이며 단일 원본 ID도 매칭 검증은 아니다. 현재 songs 적재 허용·실제 적재 수 모두 0개다. 삭제·평균·대표행 선택·verified 전환은 하지 않았다.
- 전체 분류: ID 보유 61,902행, 누락 28,506행(31.5304%), 중복 그룹 소속 2,224행(초과 1,161행), ID 형식 오류 0행. MBID 누락 28,784행(31.8379%), V/A 점수 결측 0행, 한 축 이상 1 미만 333행을 모두 보존했다.
- 전체 VA 분포: V 범위 0.235~8.475, 평균 5.453879, 표준편차 1.552985, 사분위 4.28/5.65/6.695476. A 범위 0.108113~7.27, 평균 4.317195, 표준편차 1.154653, 사분위 3.528/4.33/5.15. 이전 10,000행 감사에 기록된 전체 모집단 분포와 정확히 일치했다. 9×9 공동 구간·1/99백분위·모든 컬럼 결측률을 저장했다.
- 정규화 전체 좌표: 이론 V [-0.947778,0.883333]/A [-0.975975,0.615556], 평균 (0.211973,-0.040623). 관측 V/A 모두 [-1,1], 평균 (0.266718,0.175412). 사분면 순서 (--,-+,+-,++)별 이론 16,867/8,607/34,115/30,819행, 관측 11,905/11,722/14,320/52,461행이다. 전체 원본 고정 범위로 계산했으며 범위 재추정·클리핑은 없다.
- collectors/test_muse_full.py 독립 감사 1,988,979개 검사 통과: 모든 원문 문자열·분류·자연 키·4개 점수 조합·설정 스냅샷을 순차 대조하고 Fraction으로 오차 <1e-48 확인. 정제 11.990초, 감사 22.253초, 분석·해시 포함 오프라인 전체 36.738초. Windows OS 최대 working set은 정제 109.16MiB, 전체 115.98MiB다.
- 기존 test_muse_load.mjs에 배치 경로를 추가하고 제약·VIEW·합성 fixture 검증을 재사용했다. load_muse_batches.mjs가 source 500행·점수 2000행씩 다중 행 INSERT 후 COMMIT 및 전체 배치 재조회 검증을 수행한다. 181개 배치(마지막 source 408행), 최종 sources=90,408/scores=361,632/songs=0. DB 발급 PK로 FK를 해소하며 생성 열은 직접 INSERT하지 않는다. 스트리밍 입력/해시와 배치별 조회로 점수 메모리를 제한하지만 전체 PK 인덱스와 DB 메모리는 건수에 따라 증가한다.
- DB 검증 4,070,361개 통과, 361,632개 정규화 결과가 preview와 오차 ≤1e-15 일치. 원문·numeric·고정 범위·모집단 SHA 보존, PK/FK/UNIQUE·중복 재적재 거절·pending 추천 선택 거절을 확인했다. 예상 제약 거절 7건, 예상 밖 오류 0건. 실제 5개 VIEW 모두 0행, 별도 합성 B1/B2 각 3행·나머지 0행. 기존 합성 SQL 검증 67개로 A/C 양성 조회도 통과했다.
- 성능: INSERT·입력 검사·PK 해소·COMMIT 합계 42.057초(초당 source 2,149.64행), 배치 JSONL 읽기·재조회 감사 포함 64.053초, 해시·중복 확인·제약·합성 fixture 포함 테스트 전체 90.445초. Node OS process peak RSS 1,452.72MiB(약 1.42GiB), 적재 직후 RSS 1,296.86MiB/JS heap used 59.29MiB다. WASM·런타임·합성 DB도 포함한 프로세스 최대치이며 JS heap만으로 DB 메모리를 판단하지 않는다.
- 비교: 이전 10,000행 순차 적재 34.560초 대비 행 수 9.04배·적재 시간 1.22배다. 배치 방식으로 변경했고 단회 측정이므로 운영 성능이나 선형 확장성으로 일반화하지 않는다. 기존 100행 순차 4,065개·배치 30행(마지막 10행) 4,577개·Python 단위 9개·기존 SQL 67개 모두 통과했다. pnpm 미설치로 앱 빌드는 미검증이며 공용 의존성은 설치·수정하지 않았다.
- 결과: `.local/muse-cleaned/full-90408-v1/{stats,validation}.json`, `.local/muse-db-load/full-90408-v1/{result,comparison}.json`, 배치 진행·시간·메모리 `batches.jsonl`. 비교 재현 스크립트 `.local/muse-db-load/compare_full.py`. 이전 100/10,000행 산출물과 전체 원본·analysis·SQL 3개의 해시 불변 확인. 공유 PostgreSQL 접속·변경과 Git commit/push 없음.

### 이전 10,000행 구현
- 기존 clean_muse.py에 선택 방식 sha256-v1을 추가하고 기존 coverage-v1 기본 동작을 유지했다. seed=`muse-trial-10000-v1`, SHA256(UTF8(seed + NUL + 원본 id)) 오름차순 10,000개, 동점은 원본 id순, 출력은 원본 순서다. Spotify ID·점수 필터와 강제 경계행 없이 행 단위로 선정하며 삭제·병합하지 않는다.
- collectors/test_muse_scale.py에서 저장된 파일을 원본과 독립 대조했다. 표본 재선정 일치, 원문 문자열·전체 원본 기준 분류·40,000개 Fraction 정규화(오차 <1e-48)·원본 SHA 불변 통과. 정제 4.996초, 독립 감사 2.896초(분포 비교 계산 제외).
- 기존 test_muse_load.mjs의 입력 경로·건수를 매개변수화하고 PK/FK·UNIQUE·원본·정규화·VIEW 검증을 그대로 재사용했다. 소스 대조만 Map으로 바꾸어 반복 선형 탐색을 제거했다. 적재 34.560초(초당 소스 289.35행), 적재 통합 테스트 전체 40.864초. 단일 트랜잭션의 순차 INSERT·PK 매핑·입력 검증을 포함하며 메모리 PGlite 단회 측정이다.
- sources=10,000, scores=40,000, songs=0. Spotify ID 보유 6,870행/고유 후보 6,859개. 전체 원본 기준 중복 소속은 227행·216그룹이며 표본 내부 실제 반복은 22행·11그룹(초과 11행)이다. ID 누락 3,130행(31.30%), MBID 누락 31.39%, 점수 결측 0%, 1 미만 VA 40행을 모두 보존했다. 잘못된 ID 형식은 0행이다.
- 정규화 2종(이론 0~9, 전체 원본 관측 범위)을 유지했다. DB 40,000개 결과가 Python preview와 절대 오차 1e-15 이내 일치하고 raw numeric·설정 범위·모집단 SHA가 보존됐다. 400,318개 assertion 통과, 예상 제약 거절 7건, 예상 밖 오류 0건. 실제 5개 VIEW 모두 0행(pending), 별도 합성 DB B1/B2 각 3행·나머지 0행. 기존 validate.mjs의 67개 검증으로 A/C의 양성 조회·축 출처·결측 제외도 통과했다. 실제 매칭을 verified로 바꾸지 않았다.
- 분포: 표본 raw V 평균 5.476935/표준편차 1.542082/범위 0.571667~8.445, A 평균 4.321757/표준편차 1.144344/범위 0.434286~7.27. 전체 대비 V/A 평균 차이는 +0.023055/+0.004562, KS 거리는 0.007508/0.007952, VA 9×9 구간 총변동 거리는 0.017660이다. 모집단 관측 최소가 표본에 없더라도 정규화 범위를 바꾸지 않았다.
- 정규화 좌표 평균(V,A): 이론 (0.217097,-0.039609), 관측 (0.272314,0.176686). 이론 V [-0.872963,0.876667]/A [-0.903492,0.615556], 관측 V [-0.918285,0.992718]/A [-0.908914,1]. 분위수·표준편차·VA 구간표·정규화별 사분면은 비교 JSON에 기록했다.
- 기존 100행은 고유 후보 93개, ID 결측 6%, 1 미만 2행, 전체 대비 V/A KS 0.427073/0.436462였다. 확대 표본은 원본 분포에 훨씬 가깝지만 편향 부재나 매칭 품질을 입증한 것은 아니다. 100행 재실행도 4,065개 assertion 통과, 적재 0.408초·전체 5.343초. 행 수 100배에 적재 시간 84.63배이며 단회·초기화·자원 경합 차이가 있어 운영 성능으로 일반화하지 않는다. 과거 결과에는 시간이 없어 새 경로로 재측정했고 기존 결과는 보존했다.
- 결과: `.local/muse-cleaned/trial-10000-v1/{stats,validation}.json`, `.local/muse-db-load/trial-10000-v1/{result,comparison}.json`, 시간 비교용 `.local/muse-db-load/trial-100-v2-timed/result.json`. 비교 재현 스크립트는 `.local/muse-db-load/compare_trials.py`다. 모두 기존 .local 경로 하위에 보관한다.
- Python 단위 테스트 9개 및 기존 SQL 검증 67개 통과. `pnpm build`는 pnpm 미설치로 실행 불가했고 로컬 TypeScript 의존성도 없어 빌드는 미검증이다. 공용 의존성을 설치·변경하지 않았다.

### 이전 100행 적재 구현
- db/test_muse_load.mjs 추가, db/README.md에 실행·재현 방법 기록. 기존 SQL 3개와 정제 산출물의 체크섬을 대조하고 재사용.
- 실제 100행 적재: songs=0, song_sources=100, emotion_scores=400. DB 발급 PK와 자연 키 매핑으로 FK 해소. 중복 ID 2행·누락 ID 6행·1 미만 점수 2행을 유지하고 실제 데이터의 verified 처리·병합은 하지 않음.
- 400개 DB 정규화 결과가 Python preview와 절대 오차 1e-15 이내로 일치. 원본 numeric 값은 정확 비교, raw_payload 원문 문자열과 설정 범위·SHA도 보존 확인.
- PK/FK/UNIQUE, 중복 재적재 거절, pending 추천 선택 거절 및 제약 위반 후 행 수 불변 확인. 적재 통합 테스트 4,065개 assertion 통과. 기존 validate.mjs의 67개 검증도 재실행해 통과.
- 실제 데이터의 VIEW 5개는 모두 0행(pending이므로 정상). 별도 합성 verified MuSe 인스턴스에서 B1/B2 각각 3행, A/C1/C2 모두 0행(ReccoBeats 없음). 좌표 누락 합성 소스는 B1/B2에서 제외됨.
- 결과 저장: src/music/.local/muse-db-load/trial-100-v1/result.json. 메모리 DB에는 합성 songs 4행·sources 4행·scores 14행을 별도 구성했으며 실제 100행과 섞지 않음.

### 이전 정제 구현
- collectors/clean_muse.py, test_clean_muse.py, README.md 추가. 표준 라이브러리만 사용하며 네트워크·DB·Git 명령이 없는 오프라인 정제 프로그램이다.
- SQL의 발급된 MuSe 정규화 설정을 읽고 원본 SHA-256·전체 90,408행·Decimal 최소/최대·기존 analysis/provenance를 대조했다. 표본 범위로 재정규화하지 않음.
- coverage-v1로 전체 경계값·저점수·중복·ID 누락을 포함한 100행 선정. unique_unverified 92행, 중복 Spotify ID 2행(1그룹), ID 누락 6행, 1 미만 점수 2행을 모두 보존.
- src/music/.local/muse-cleaned/trial-100-v1/에 song_sources.jsonl(100행), emotion_scores.jsonl(400행), classifications.jsonl, duplicate_groups.json, stats.json 및 독립 검증 validation.json 저장.
- 소스는 전부 pending·song_id=NULL·추천 선택 false. 미검증 ID를 임의로 songs에 합치지 않고 canonical_songs=0으로 유지. 실제 source PK/FK는 후속 승인된 적재 단계에서 자연 키로 해소해야 한다.
- Python 단위 테스트 8개 통과. 저장된 100/400행을 재조회해 원문 문자열·전체 모집단 기준 중복 분류·독립 Fraction 계산 오차 1e-48 미만·두 지표 관측 정규화 양 끝 -1/1을 확인.

### 이전 SQL 구현
- db/001_schema.sql, 002_normalization_v1.sql, 003_recommendation_views.sql 작성. 기존 PK/FK/UNIQUE·컬럼을 유지하고 검증/선택 상태·설정 스냅샷을 추가.
- recommend_a/b1/b2/c1/c2 구현. MuSe 이론 0~9·전체 관측 범위, ReccoBeats 0~1을 -1~1로 변환. 원본·1 미만 점수 보존, 미검증 중복 소스는 별도 보관.
- 버전별 설정에 기준 데이터 버전·전체 90,408행·SHA-256·정확한 Decimal 경계를 기록. 설정과 원본 점수는 과거 버전을 덮어쓰지 않고 추가하는 방식.
- 매칭 검증과 명시적 소스 선택이 있고 필요한 좌표가 있는 경우만 노출. 원본·점수 변경, 설정 불일치, 비정상 숫자·범위 위반 차단.
- validate.mjs와 db/README.md 추가. 로컬 전용 PGlite 0.5.10 의존성은 무시되는 .local/sql-validation에 설치. 공용 package.json·잠금 파일은 변경하지 않음.

### 이전 조사 및 구조 정리 이력
- 워크프로세스 v1.2와 기존 저장소 구조 확인. 기존 관리 문서 없음.
- 담당 문서 5개를 `src/music/` 직속으로 통합하고 AGENTS 적용 범위를 해당 하위로 한정.
- 음악 DB·VIEW·정규화·수집·추천 설계와 단계별 완료 조건 기록.
- MuSe Zenodo v1.0.0의 실제 다운로드 경로, CSV 헤더 8개, 공식 API의 CC BY 4.0 표기 확인. Spotify ID는 배포 설명상 약 68%의 잠정 매칭이다.
- ReccoBeats 엔드포인트·특징 설명(Valence/Energy 0~1)과 수치 미공개 호출 제한 확인.
- Spotify ID 개별 조회 및 개발 모드 접근·일괄 조회 제한 확인. 공식 URL과 접근 실패·미확정 항목을 SPEC에 기록.
- MuSe 원본 10,026,011바이트 다운로드, 공식 MD5 일치 및 분석 전후 SHA-256 불변 확인. 별도 로컬 폴더에 귀속·출처·라이선스와 함께 보관하고 Git 제외 확인.
- 90,408행·8컬럼 분석. Valence 0.235~8.475, Arousal 0.108113~7.27. 평균은 각각 5.453879, 4.317195이며 점수 결측은 없음.
- Spotify ID 61,902행(68.4696%), 고유 60,741개, 결측 28,506행. 중복 ID 1,063그룹 중 965그룹은 VA 값도 다름.
- 1 미만 VA를 가진 행은 합집합 333개. 1~9 가정 변환도 -1~1을 벗어나므로 확정하지 않음. 상세 타입·분포·중복 정의·재현 경로는 SPEC 7.1.1~7.1.3에 기록.
- 원본·분석 스크립트·검증 결과·출처·README를 `src/music/.local/music-muse/`로 이동. 향후 코드용 `collectors/`, `db/`, `algorithm/` 디렉터리 준비(빈 디렉터리는 Git이 추적하지 않음).
- 공식 MuSe 논문에서 Last.fm 태그의 Warriner VAD 값 가중평균 방식을 확인. Warriner 사전 척도는 1~9이나, 2020년 원문의 미매칭 0 처리까지 포함하면 배포값이 반드시 1~9일 필요는 없음. 이전의 범위 모순 해석을 보완함.
- 333행 중 세 축 모두 1 미만 66행, 중복 Spotify ID 소속 8행. 중복 1,063그룹 중 이름 정리 후 아티스트 동일 876그룹, 곡명 동일 156그룹, 둘 다 동일 6그룹, 서로 다른 비결측 MBID가 여러 개인 그룹 304개(분류는 겹칠 수 있음).
- 원본·analysis.json 및 기존 분석 기준을 재사용해 메모리에서 추가 집계. 공식 출처·예시·가설과 확정 사실·미적용 정책안을 SPEC에 기록.
- 2020년 Mapping stage와 Figure 1 검토. 0 대입 포함 전체 분모식에서는 raw=q*매칭 태그 평균. 기존 333행 모두 세 축 공통 q의 이론적 허용 구간이 존재(불일치 0행)하지만 이는 실제 q 측정이나 생성 코드 재현은 아님.
- 0~9 범위의 수학적 가능성과 낮은 매칭률이 낮은 감정 점수로 오인되는 문제, 가중 매칭률 기반 검증안을 SPEC 7.1.7에 기록. 그림은 모든 태그가 매칭되는 예라 분모 구현 확인에는 불충분함.
- 출판사 공식 부록의 Warriner 사전 `BRM-emot-submit.csv` 13,915행을 메모리에서 확보. 논문 그림에 공개된 6개 태그 VAD가 사전 전체 평균 열과 일치함을 확인.
- 개별 곡명·원본 ID·태그 가중치·감정 좌표의 재현 사례는 공유하지 않는다. 원본 계산과 연구 이력은 로컬에 보존하며 일반 분모/가중평균 설명과 구분한다.
- 당시 태그/가중치의 충분한 근거를 확보하지 못한 사례는 재계산·값 보정하지 않는다. 상세 개별 사례는 비공개 연구 자료에 보존한다.

## 진행 중 / 미해결
- CSV 정제·파일 영속 PGlite·추천/DB/API 준비 모듈·배치/연구 수집기를 구현했다. 아래는 당시 단계의 미해결 사항이며 현재 진척은 상단 상태를 따른다. 실제 좌표/수집 결과는 로컬 보존하며 운영 연동·verified 승격·네이티브 동시성은 별도다.
- 이번 출력은 DB 입력 자연 키와 insert_values, 계산 감사용 preview를 분리한 중간 산출물이다. 숫자는 Decimal 정밀도를 보존하는 JSON 문자열이며 PostgreSQL 생성 열 normalized_value를 직접 INSERT하지 않는다.
- 이전 100행은 경계·예외 검증, 10,000행은 고정 hash 표본의 분포 비교에 사용했다. 이번 전체 원본 정제·로컬 배치 적재는 완료했지만 매칭 정확성·품질 필터·운영 적재는 미검증이다. 전체 고유 후보는 60,741개이며 검증 곡은 0개다.
- MuSe: 미매칭 태그 0 처리는 공식 확인. 분모에 그 가중치도 포함된다는 것은 원문 절차상 해석이며 배포 코드로 직접 확인하지 못함. CSV에 태그·개별 가중치·분모가 없어 실제 q·333행별 원인·최종 축 방향은 여전히 미확정.
- 사전은 공개 부록 확보 가능하나 생성 시점 파일의 동일성·전처리 규칙은 미확인. 실제 q<1 곡의 가중 매칭률·점수 왜곡 크기는 측정하지 못함. Last.fm 현재 API는 키가 필요하고 과거 날짜 인자가 없어 당시 상태의 재현 수단으로 확인되지 않음.
- 2021년 공식 논문은 v3/90,001곡, 로컬은 Zenodo v1/90,408행이다. 방법·문제의 존재는 참고하되 다른 버전의 행·생성 코드까지 동일하다고 보지 않음.
- 중복 Spotify ID 및 정리된 곡명/가수명 중복 후보는 자동 병합하지 않음. ID 형식은 적합하지만 API 곡 매칭 정확성은 미검증.
- ReccoBeats의 실제 매칭/확보량·원격 응답·분포·속도는 로컬 연구 결과에만 보존한다. 독립 녹음 검증, 제공자의 저장/재사용/공개 범위와 제3자 조건은 여전히 후속 검토 대상이다.
- Spotify: 실제 앱 모드·권한·quota 및 필드별 보존/삭제 조건 미확정. 범용 영구 DB 수집 허가로 해석하지 않음.
- VIEW별 데이터 확보량과 10,000곡 교집합 확보 가능성 미검증.
- 기존 Track의 필수 `reccobeatsId`, 좌표 척도, 소스 선택 방식에 대한 팀 합의 필요.
- 코드 배치는 담당 영역의 collectors/db/algorithm으로 지정했다. 마이그레이션 도구, DB 버전·환경은 미정.

## 다음 작업
0. SPEC 7.2.6의 질문에 대한 제공자 서면 답변과 제3자 조건을 확보하고 제목 불일치 4곡의 독립 근거를 검토한다. 실제 문의는 별도 발송 지시가 있어야 한다. 답변의 허용 필드·규모·TTL/quota·삭제 조건을 확인한 뒤 수집/보관 설계 및 다음 시험 범위를 정하며, 그 전 대량 수집·감정 값 영구 저장·운영 적재는 보류한다.
1. 실제 배포 PostgreSQL 버전과 migration 적용 절차·권한을 정한다. 다중 연결 동시성·성능은 해당 테스트 환경에서 추가 검증한다.
2. SPEC 2.1에서 확정한 원본별 method/reference·검토자 근거 및 제공자별 명시적 선택 규칙을 실제 검토에 적용한다. 독립 근거 확보와 실제 전환은 미수행이다. 중복 Spotify ID의 원본은 병합하지 않는다.
3. 실제 소스 매칭 검증과 운영 적재는 별도 작업으로 계획한다. 이번 자연 키→DB PK 해소 및 numeric/JSONB 입력은 메모리 테스트에서만 검증했고 실제 서버 적용은 허용되지 않았다.
4. 당시 태그·가중치 미확보 및 q에 따른 감정 점수 희석 문제는 후속 품질 연구로 남긴다. 승인된 정규화 적용과 품질 입증은 별개다.
공유 PostgreSQL 접속·변경 및 Git commit/push는 수행하지 않는다.

## 이전 검증 및 인계 기록

아래 100행 적재·Python 8개 등은 각 이전 시점의 기록이다. 최신 전체 MuSe/파이프라인/추천 결과 및 이번 빌드 점검은 상단 항목을 따른다.
- 작업 시작 시 브랜치는 feature/music-db이며 추적 파일의 main 대비 차이·작업 트리 변경은 없었다. 담당 문서 5개는 미추적, MuSe 로컬 파일 5개는 이전 로컬 제외 규칙의 대상이었다.
- 문서 5개와 로컬 파일 5개를 이동했고 이동 직후 각 파일 해시 일치를 확인했다. 이후 문서와 로컬 README의 참조 경로만 갱신했다.
- 루트에는 공용 `.gitignore`를 유지하며 음악 영역의 로컬 데이터·비밀정보 제외 규칙만 추가했다. 이전 `.git/info/exclude`의 음악 전용 규칙은 제거했다.
- 새 경로에서 분석 스크립트 실행 성공. 원본·분석 결과·출처·스크립트 해시가 재실행 전후 동일하고 상대 링크·이전 경로 제거·Git 제외/미추적 상태를 확인했다.
- main 대비 추적 변경은 루트 `.gitignore`뿐이다. 백엔드·의존성·잠금 파일의 작업 전후 해시가 동일하며 DB 설계와 기존 분석 통계를 유지했다.
- PostgreSQL 접속·변경 및 Git commit/push는 수행하지 않았다. Git 사용은 상태·비교·제외 확인용 읽기 전용 명령뿐이다.
- 워크프로세스 원본은 이번 작업 시작 시 저장소에 없었다. 생성·복원·이동하지 않았다.

### 이번 SQL 검증
- `node src/music/db/validate.mjs`: 67개 검증 통과, PostgreSQL 18.6(PGlite 0.5.10), 외부 DB URL 없는 신규 메모리 인스턴스.
- DDL 실행·3개 테이블/5개 VIEW, 계산식·양 끝 경계, 1 미만 유지, 미검증/좌표 누락/미선택 제외, 중복 원본 보존, PK/FK/UNIQUE·설정·버전·불변성·범위 위반을 검사.
- 실제 MuSe 원본·analysis.json·기존 분석 스크립트·팀원 코드·공용 의존성은 변경하지 않음. 합성 fixture만 사용했고 인스턴스는 종료 시 폐기.
- PostgreSQL 14+ 문법을 사용했으나 실제 배포 서버 버전·권한·다중 연결 동시성·운영 성능은 미검증. SQL은 신규 설치용이며 기존 객체가 있으면 실패하도록 작성.

### 이번 정제 검증
- `python -m unittest discover -s src/music/collectors -p "test_*.py"`: 8개 통과.
- `python src/music/collectors/clean_muse.py --limit 100`: 100행 시험 변환 성공. 기존 출력은 덮어쓰지 않으며 새 실행은 새 --output-dir을 지정한다.
- 독립 저장 파일 검증 결과는 trial-100-v1/validation.json에 기록했다. 100개 원본별 소스와 400개의 지표·버전 조합을 유지하며 중복·누락·저점수 행을 삭제/병합하지 않았다.
- 원본·기존 analysis/provenance·기존 분석 스크립트·SQL 파일의 작업 전후 SHA-256이 모두 동일함을 확인했다. PostgreSQL 접속·적재 및 Git commit/push는 수행하지 않았다.

### 이번 로컬 적재 검증
- `node src/music/db/test_muse_load.mjs`: PASS, 4,065 assertions. PostgreSQL 18.6(PGlite 0.5.10)의 독립 메모리 인스턴스 2개 사용.
- 실제 MuSe 행은 pending 유지, 합성 데이터만 별도 DB에서 verified. 기존 SQL·정제 결과·원본·분석 프로그램과 백엔드 변경 없음.
- 메모리 데이터는 종료 시 폐기했고 결과 JSON만 .local에 보관한다. 공유 PostgreSQL 접속·변경 및 Git commit/push는 수행하지 않았다.
- 운영 환경의 권한·다중 연결 동시성·대량 적재 성능과 실제 Spotify 매칭 정확성은 이번 테스트 범위 밖이다.
