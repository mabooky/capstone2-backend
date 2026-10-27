# 추천 DB·API 연동 모듈 (후속 5단계)

## 개발용 실험 HTTP API (2026-10-27)

### 축소 데이터셋 기본 사용

공유 권한 확보를 확인한 사용자 지시에 따라 `../data/experiment-v1/`에 27,948곡
축소 데이터셋을 추가했다. 기본 데이터 소스는 이제 이 폴더다. PGlite와 `.local/`이
없는 clone에서도 개발용 API와 데이터셋 테스트가 동작한다.
원본 점수·좌표는 문자열로 유지하며, 6개 축과 곡별 출처로 기존 14필드를 복원한다.
출처·사용 조건과 파일 형식은 [데이터셋 안내](../data/experiment-v1/README.md)를 따른다.

- `MUSIC_EXPERIMENT_SOURCE=dataset` (기본): 읽기 전용 파일 어댑터. 선택적 MUSIC_DATASET_ROOT.
- `MUSIC_EXPERIMENT_SOURCE=pglite`: 기존 읽기 전용 PGlite 사본 방식. 선택적 MUSIC_EXPERIMENT_ROOT.
- 이전과 같이 MUSIC_EXPERIMENT_ROOT만 지정한 경우에는 PGlite 방식을 유지한다.
- 누락·해시 불일치 시 503이며 다른 소스로 자동 대체하지 않는다.
- 두 방식 모두 개발 환경·활성화 플래그를 요구하고, 운영 서비스·verified 상태와 분리한다.

```powershell
node --import tsx --test src/music/integration/compact_experiment.test.mjs
```

아래 PGlite 실행/의존성 설명은 source=pglite에 적용된다. 실제 ID를 코드 예시에
하드코딩하지 않으며, 승인된 실제 데이터는 data/experiment-v1에만 묶어서 제공한다.

`POST /api/dev/music/recommendations`를 추가했다. **NODE_ENV=development와
ENABLE_DEV_MUSIC_RECOMMENDATIONS=true가 모두 설정된 경우에만** 사용할 수 있다.
production, test, 미설정 환경 또는 활성화 플래그가 없으면 404다.

```powershell
corepack pnpm install --frozen-lockfile
$env:NODE_ENV = 'development'
$env:ENABLE_DEV_MUSIC_RECOMMENDATIONS = 'true'
corepack pnpm dev
```

요청 예시:

```json
{"coordinateSpace":"unit-interval-v1","view":"B1","valence":0.5,"arousal":0.5,"limit":5}
```

다섯 필드가 모두 필요하다. VIEW는 A/B1/B2/C1/C2, 좌표는 숫자 0~1,
limit는 정수 0~100이다. 추가 필드와 실험 ID 제외 목록은 받지 않는다.
응답은 `{coordinateSpace,view,returnedCount,spotifyIds,reason,experimental:true,
verified:false,canonicalSongIds:false,idNamespace,datasetId}`다. 곡명·아티스트·이미지나
가짜 메타데이터는 반환하지 않는다. 실제 ID 예시는 Git 문서·테스트에 저장하지 않는다.

`dev_experiment_service.ts`는 dto의 parseInput, experimentRows, recommend와 기존
query_local_experiment.mjs를 재사용한다. 정식 메타데이터를 요구하는 운영용
RecommendationService/RecommendationRepository에는 실험 행을 전달하지 않는다.

PGlite 방식의 기본 데이터는 `src/music/.local/music-experiment-20261020-v3`이며,
MUSIC_EXPERIMENT_ROOT로 music/.local 아래의 다른 승인된 실험 폴더를 지정할 수 있다.
manifest, snapshot/schema-manifest.json, snapshot/pgdata/PG_VERSION 및 기존 DB가 필요하다.
로컬 PGlite 의존성은 기존 `.local/sql-validation`을 사용한다. 입력/런타임 누락·손상은
503 EXPERIMENT_UNAVAILABLE, 잘못된 요청은 400 INVALID_INPUT이다.

최초 유효 요청에서 원본 pgdata의 임시 사본을 만들고 READ ONLY 트랜잭션으로 조회한다.
DB 생성·migration·원본 잠금 파일 생성·verified 전환·Spotify 호출은 하지 않는다.
같은 프로세스는 같은 사본을 재사용하므로 원본 갱신 반영은 서버 재시작 후 이뤄진다.
원본 DB에 쓰는 다른 프로세스가 없는 상태에서 실행한다. 정상 서버 종료 시 사본을
정리한다. 강제 종료 시 OS 임시 폴더에 사본이 남을 수 있다.
개발용 빌드 실행도 소스 체크아웃과 ignored 로컬 입력/의존성이 필요하다.

HTTP 검증(실제 데이터 검사는 명시적으로 활성화):

```powershell
corepack pnpm build
$env:RUN_LOCAL_MUSIC_HTTP_TESTS = 'true'
node --import tsx --test src/music/integration/dev_recommendations.test.mjs
```

localhost의 실제 Express 서버로 요청한다. 5모델의 결과를 기존 모델별 JSONL의 직접 추천과
대조하고 입력 오류, 누락 파일/DB, production 비활성화, 기존 GET, 동시 요청 및
원본 실험 디렉터리 전체 SHA-256 불변을 검증한다. 이 결과는 Spotify의 ID 유효성,
실제 녹음 매칭 또는 재생 가능성 검증을 뜻하지 않는다.

아래 내용은 기존 **운영용 준비 모듈**의 계약·검증 이력이다.

실제 서버/라우터를 실행하거나 기존 Track을 변경하지 않는 준비 모듈이다. 외부 API/DB 접속·실제 source 상태 갱신·수집 기능은 없다. DB 클라이언트는 호출자가 주입한다.

- `repository.ts`: 허용 목록의 VIEW 5종을 SELECT하고 기존 14열과 표시 메타데이터를 분리한다. bigint/numeric은 SQL에서 text로 받아 정밀도를 유지한다. 같은 SELECT에서 songs와 검증·선택된 ReccoBeats ID를 결합한다. 후보에 조기 LIMIT을 적용하지 않고 제외 ID는 SQL 파라미터로 전달한다.
- `dto.ts`: 별도 추천 DTO 초안. 입력 0~1을 `2*x-1`로 변환하고 출력은 `(x+1)/2`로 되돌린다. 잘못된 값/unknown field는 거절하며 자동 범위 추정/0 대체/clamp는 없다. 제외 ID는 PostgreSQL bigint 범위의 양의 정수 문자열이다.
- `service.ts`: DB snapshot → 기존 recommend → DTO, 프레임워크 독립 `handleRecommendation` 응답을 제공한다. 200 정상/빈 결과, 400 잘못된 입력, 503 조회 실패, 500 잘못된 DB 데이터/서버 문맥을 구분한다. 오류 본문에 SQL/접속 정보/원인을 노출하지 않는다.

입력 예시(팀 합의 전 별도 endpoint 제안):

```json
{"coordinateSpace":"unit-interval-v1","view":"B1","valence":0.5,"arousal":0.5,"limit":100,"excludeSongIds":["123"]}
```

출력은 `{coordinateSpace,view,tracks,returnedCount,reason}`이다. track은 songId/spotifyId/reccobeatsId/title/artist/durationMs/albumImageUrl/valence/arousal/normalization을 가진다. ID는 문자열, durationMs/reccobeatsId는 null 가능, albumImageUrl은 현재 항상 null이다. 좌표는 선택한 VIEW의 정규화 좌표를 0~1로 재표현한 것이며 제공자 원본 값과 일반적으로 같지 않다. requestStatus·임의 이미지·가짜 UUID를 채우지 않는다. 기존 Track[]와 직접 호환되지 않으며 DTO/route 확정은 팀 통합 사항이다.

## 기존 라우터에 필요한 변경안 — 이번에는 미적용

1. 앱 시작 시 승인된 DB 클라이언트와 `RecommendationRepository`/`RecommendationService`를 한 번 구성한다. 네이티브 PostgreSQL 클라이언트·배포 대상·의존성 선택은 팀 결정이 필요하며 이번에 설치하지 않았다. 파일 PGlite를 사용할 경우 같은 파일을 여러 프로세스가 동시에 열지 않도록 소유권/종료 관리를 해야 한다.
2. 매장 접근 권한을 확인하고 대기열의 **canonical song ID** 문자열을 얻는 함수를 연결한다. 클라이언트 제외 목록과 서버 대기열 제외를 합치되, 대기열 조회 실패를 빈 목록으로 숨기지 않는다.
3. 제안 경로는 기존 mount 아래 `POST /api/stores/:storeId/recommendations`다. 기존 GET catalog/tracks는 그대로 두는 안이다. `src/index.ts`에는 이미 express.json이 있다. 팀 합의 후 storeRouter에서 아래 패턴을 적용한다(예시이며 미구현 함수를 직접 실행할 수 있는 코드는 아님).

```typescript
// src/routes/storeRouter.ts에 적용할 팀 검토용 예시
import { RecommendationRepository } from '../music/integration/repository.js';
import { RecommendationService, handleRecommendation } from '../music/integration/service.js';
// approvedClient/getQueuedCanonicalSongIds는 팀에서 제공·승인해야 한다.
const service = new RecommendationService(new RecommendationRepository(approvedClient));
storeRouter.post('/recommendations', async (req, res, next) => {
  try {
    const excluded = await getQueuedCanonicalSongIds(req.params.storeId);
    const result = await handleRecommendation(service, req.body, { excludeSongIds: excluded });
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
});
```

4. 프런트엔드가 별도 DTO와 null을 수용하도록 합의한다. 기존 Track이 반드시 필요하면 reccobeatsId·이미지·duration 결측과 requestStatus 정책을 먼저 정해야 한다. 대기열/매장 상태는 이 모듈이 임의로 available/out-of-mood로 판정하지 않는다.
5. 서버 승인 환경에서 의존성을 복원한 뒤 전체 빌드·실제 HTTP/매장 권한/대기열/DB 연결 수명주기를 검증한다. 이번에는 서버 실행·라우터 변경·공유 DB 연결을 하지 않았다. 현재 실제 verified=0이므로 이 API도 정상 빈 결과다.

## 검증

추가 설치 없이 기존 .local TypeScript/PGlite를 사용한다.

```powershell
node src/music/.local/algorithm-validation/node_modules/typescript/bin/tsc -p src/music/integration/tsconfig.check.json
node --test src/music/integration/recommendation.test.mjs src/music/algorithm/recommend.test.mjs
```

엄격 컴파일과 신규 18+기존 22=40개 테스트를 통과했다. 실제 영속 MuSe DB는 READ ONLY 트랜잭션에서 VIEW 5종의 정상 빈 결과와 건수/상태 보존을 확인했다. 양성 125곡은 별도 메모리 DB의 합성 fixture만 사용하고 종료 시 폐기한다. 합성 ReccoBeats를 실제 영속 DB에 넣지 않는다. 결과는 `.local/api-validation/stage5-v1/`에 기록한다.

현재는 전체 후보를 메모리에서 정렬한다. 대규모 실제 곡에 대한 지연·동시성/타임아웃/취소 정책 및 pg 클라이언트 실연결은 미검증이다. DB 오류를 다른 VIEW/빈 배열로 대체하지 않는다.
