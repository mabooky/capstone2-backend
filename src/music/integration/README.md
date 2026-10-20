# 추천 DB·API 연동 모듈 (후속 5단계)

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
