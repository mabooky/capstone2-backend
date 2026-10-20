# 음악 SQL

아래 영속 MuSe 단독 적재 설명은 해당 구현 단계의 계약·이력이다. 이후 격리 통합·공통곡 실험 상태와 공개 범위는 [STATUS](../STATUS.md), [reports 인덱스](../reports/README.md)를 따른다. 새 clone의 설치·합성 테스트·비공개 입력 의존성은 [REPRODUCING](../reports/REPRODUCING.md)을 먼저 확인한다. 이 문서는 실제 데이터 수집/공유 DB 실행을 허가하지 않는다.

## 후속 4단계: 로컬 파일 영속 검증

신규 설치 없이 기존 `.local/sql-validation`의 PGlite 0.5.10을 재사용한다. 저장소 루트에서 다음 명령을 실행한다.

```powershell
node src/music/db/test_persistent_muse.mjs
```

저장 위치는 `.local/muse-persistent/stage4-v1/pgdata`, 결과는 같은 폴더의 `runs/<실행 ID>/`다. 새로운 별도 시험은 첫 인자로 `.local` 하위 다른 경로를 지정한다. 기존 파일을 삭제하거나 DDL을 덮어쓰지 않는다. 같은 경로로 재실행하면 원본/SQL/설정 manifest를 확인하고 저장된 관측을 검증·재사용한다. 외부 URL/접속 환경변수·Railway·공유 PostgreSQL은 사용하지 않는다.

`persistent_muse.mjs`는 기존 001~003 SQL 본문을 한 트랜잭션으로 초기화하며 추적용 테이블을 추가하지 않는다. 이후 실행은 SQL 재적용 대신 sidecar manifest를 확인한다. 파일/입력 변경 또는 manifest 없이 존재하는 schema는 자동 수정하지 않고 거부한다. DB 커밋과 sidecar 기록 사이의 비정상 종료는 수동 확인이 필요하다.

기존 load_muse_batches의 500행/2,000점수 배치와 전체 원본·정규화 재조회를 재사용한다. 자연 키가 이미 존재하면 모든 source 입력 컬럼이 같은지 확인하고 새 source만 INSERT한다. 점수는 source PK/metric/정규화 버전과 원본 값을 확인해 누락분만 INSERT한다. 불일치 관측은 INPUT_CONFLICT로 거부하며 DO UPDATE·병합·평균·원본 덮어쓰기를 하지 않는다. 이미 있는 행에는 INSERT를 시도하지 않아 불필요한 identity 발급도 줄인다. legacy 배치 결과의 verifiedSources/verifiedScores는 검증한 행 수이며 match_status 승격이 아니다.

테스트는 서로 다른 Node 프로세스 4개로 ① 500개 source 커밋 후 정상 중단 ② 나머지 적재·전체 감사 ③ 같은 입력 재적재(추가 0건) ④ 재개봉·제약·트랜잭션 ROLLBACK·manifest 불일치 검증을 수행한다. 전체 행 ID/내용의 fingerprint가 재실행 전후 같아야 한다. 의도적 경계 중단은 기존 배치 로그에 BOUNDARY_STOP으로 기록되지만 테스트의 예상 중단이다.

실제 데이터는 MuSe pending뿐이며 songs는 만들지 않는다. ReccoBeats 실제 데이터는 적재하지 않는다. 모든 VIEW의 0행은 정상 빈 결과다. 양성 VIEW·정규화/출처 테스트는 기존 validate.mjs의 별도 메모리 합성 fixture로 검증한다. 영속 제약 테스트에서 생성한 합성 song/source도 트랜잭션 전체를 ROLLBACK한다.

파일 PGlite는 PostgreSQL WASM 단일 프로세스 환경이며 네이티브 서버의 동시성·역할 권한·운영 내구성·배포 성능을 입증하지 않는다. 실행기 run.lock은 동시 컨트롤러 실행을 거부한다. 컨트롤러 비정상 종료 후 남은 잠금은 프로세스 생존 여부를 확인한 뒤 수동 처리해야 하며 자동 삭제하지 않는다. 테스트는 정상 close 후 재개봉을 검증하며 강제 전원 차단 복구를 보장하지 않는다.

기존 팀 DB에 자동 적용하지 않는다. 신규 스키마용이며 실행 순서는 다음과 같다.

1. `001_schema.sql`: music 스키마, 테이블 3개, PK/FK/UNIQUE·원본 보존 규칙.
2. `002_normalization_v1.sql`: 버전별 정규화 설정과 점수 INSERT 트리거.
3. `003_recommendation_views.sql`: 추천 좌표 조회 함수와 VIEW 5개.

각 파일은 트랜잭션으로 처리한다. 기존 객체가 있으면 실패하며 DROP·덮어쓰기·자동 병합을 하지 않는다.
전체 설치 시에도 실행 도구의 오류 즉시 중단 옵션을 사용한다. 공유 서버 적용은 이번 작업에 포함되지 않는다.

## 입력과 매칭

- 원본 소스는 `match_status='pending'`, `song_id=NULL`, `is_recommendation_source=false`로 시작한다. 중복 candidate_spotify_id는 허용하고 원본별 external_id를 보존한다.
- 검증 후 song_id, candidate_spotify_id, `match_status='verified'`, verified_at 및 match_evidence의 method/reference를 지정한다. 실제 검증은 별도 수집/검토 과정의 책임이다.
- 검증된 원본 중 제공자별 한 행만 명시적으로 `is_recommendation_source=true`로 선택한다. 여러 버전·중복 행 중 최신/첫 행을 자동 선택하지 않는다.
- 점수 INSERT 입력은 song_source_id, metric, raw_value, normalization_version이다. raw_min/raw_max와 normalization_config는 트리거가 채우고 normalized_value는 STORED 생성 열이다.
- MuSe source_version은 현재 설정의 `zenodo-4281165-v1.0.0`과 일치해야 한다. MuSe는 같은 원본에 theoretical/observed 점수 행을 각각 추가한다. 원본 값은 동일해야 한다.
- 해당 VIEW에 필요한 축·정규화 버전이 없으면 결과에 포함되지 않는다. 보간·0 대체·다른 버전 fallback은 없다.

## 설정·이력

설정 원본은 `002_normalization_v1.sql`의 normalization_config_v1 함수다. 식, 범위, 데이터 버전·해시·전체 행 수·정책일을 기록한다. 기존 발급 버전을 수정하지 않는다.
기준 변경은 새로운 migration/함수·normalization_version으로 추가하고 기존 점수 스냅샷은 보존한다. VIEW도 새 버전을 명시하는 migration으로 변경해야 한다. 기존 점수 UPDATE/DELETE와 소스 identity/raw_payload 변경은 차단된다.
전체 원본 범위는 매칭·중복·품질 필터 전 90,408행에서 고정했다. 표본이나 VIEW에 포함된 곡만으로 다시 계산하지 않는다.
설정의 source_sha256은 기준 모집단 식별자다. 입력 원본 파일의 체크섬 확인은 후속 수집기의 책임이며 SQL이 파일을 읽어 검증하지 않는다.

## 로컬 검증

저장소 루트에서 테스트 전용 의존성을 무시되는 폴더에 설치한다. 루트 package.json·잠금 파일은 변경하지 않는다.

```powershell
npm install --prefix src/music/.local/sql-validation --no-package-lock --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.10
node src/music/db/validate.mjs
```

validate.mjs는 연결 URL 없이 새 PGlite 메모리 인스턴스를 생성한다. 실제 MuSe 원본 적재 대신 합성 fixture를 쓰며 종료 시 폐기한다.
검증: 3개 테이블/5개 VIEW 생성, 수치·경계값, 출처 검증·선택, 결측 제외, 중복 보존, 제약 위반, 버전·모집단·원본 불변성.
PostgreSQL 18.6(PGlite 0.5.10)에서 67개 검증 통과. PostgreSQL 14+ 문법을 사용했지만 실제 배포 버전, 다중 연결 동시성·권한·성능은 별도 검증이 필요하다.

## 정제 100행 적재 통합 테스트

```powershell
node src/music/db/test_muse_load.mjs
```

기존 trial-100-v1 산출물·검증 해시와 SQL을 재사용한다. 실제 데이터는 메모리 DB에 sources 100행·scores 400행으로 적재하며 songs는 만들지 않고 모두 pending으로 보존한다.
DB가 발급한 source PK를 자연 키로 매핑하고 숫자 문자열을 numeric 입력으로 전달한다. 생성 열·설정 스냅샷은 기존 SQL이 계산한다.
원본 보존·PK/FK/UNIQUE·중복/누락/저점수 처리와 400개 정규화 결과를 검사한다(허용 절대 오차 1e-15).
실제 pending 데이터의 VIEW는 모두 0행이어야 한다. 별도 메모리 인스턴스의 합성 verified MuSe만으로 B1/B2 조회·누락 좌표 제외와 ReccoBeats 없는 A/C의 0행을 검증한다.
보고서는 `src/music/.local/muse-db-load/trial-100-v1/result.json`에 저장한다. 기존 보고서는 덮어쓰지 않는다. 재실행 시 첫 인자로 새로운 `.local/` 하위 보고서 경로를 지정한다.
두 인스턴스는 종료 시 폐기하며 공유 DB·연결 URL·영구 DB 디렉터리를 사용하지 않는다.

## 10,000행 확대 재사용

정제·독립 검증 후 같은 테스트에 보고서 경로와 정제 디렉터리를 전달한다.

```powershell
python src/music/collectors/test_muse_scale.py
node src/music/db/test_muse_load.mjs src/music/.local/muse-db-load/trial-10000-v1/result.json src/music/.local/muse-cleaned/trial-10000-v1
node src/music/db/validate.mjs
```

입력 건수는 stats.json으로 대조하며 validation.json의 파일 해시를 확인한다.
10,000 sources·40,000 scores·0 songs, 400,318개 assertion 통과했다.
실제 데이터는 모두 pending이고 합성 fixture는 별도 메모리 DB에 둔다.
보고서에 적재 시간(단일 트랜잭션·순차 INSERT·PK 매핑 포함), 전체 테스트 시간,
고유 Spotify ID 후보 수·예상 제약 거절 7건·예상 밖 오류 0건을 기록한다.
기존 100행 시간 비교는 새 보고서 경로 `trial-100-v2-timed/result.json`으로 실행했다.
재실행 시 기존 결과를 보존하도록 새 경로를 사용한다. 단회 메모리 측정은 운영 PostgreSQL 성능을 보장하지 않는다.

## 전체 원본 배치 적재

```powershell
python src/music/collectors/test_muse_full.py
node src/music/db/test_muse_load.mjs src/music/.local/muse-db-load/full-90408-v1/result.json src/music/.local/muse-cleaned/full-90408-v1 500
```

마지막 인자는 한 트랜잭션의 source 행 수(1~2000)이며 0/생략 시 기존 순차 시험을 유지한다.
load_muse_batches.mjs는 JSONL을 순차 읽어 원본 500행·점수 2000행씩 다중 행 INSERT한다.
DB 발급 PK를 자연 키로 해소하며 생성 열은 INSERT하지 않는다. 배치별 COMMIT 후
원문과 모든 점수·설정·정규화를 다시 조회·검증한다. 실패 배치는 ROLLBACK하며
이미 성공한 배치의 건수·시각·메모리는 같은 결과 폴더의 batches.jsonl에 남긴다.
체크포인트는 진단용이며 영구 DB 재개 기능이 아니다. 종료 시 메모리 DB는 폐기한다.
입력 전체 해시는 스트리밍으로 검사하고 입력·조회 점수는 배치 크기로 제한한다.
외부 ID→DB PK 인덱스와 PGlite DB 자체의 메모리는 전체 건수에 따라 증가한다.
Node OS process peak RSS는 WASM·런타임·별도 합성 DB도 포함한다.
적재 시간은 INSERT·입력 검사·PK 해소·COMMIT의 합계이고, 전체 시간에는 해시·JSONL 입출력·조회 검증·fixture도 포함한다.

전체 90,408개 원본은 각각 song_sources에 보존한다. 후보 Spotify ID는 이 테이블에서
비고유이므로 중복 ID로 songs의 UNIQUE와 충돌하지 않는다. songs는 검증 전 0행을 유지한다.
60,741개 고유 ID 후보 중 59,678개는 단일 원본, 1,063개는 중복 그룹이다.
이 숫자는 곡 매칭 검증이나 canonical songs 적재 승인을 뜻하지 않는다.
