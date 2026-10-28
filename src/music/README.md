# 음악 추천 모듈

27,948곡의 공유 데이터셋으로 A/B1/B2/C1/C2 추천을 제공하는 개발용 API다.
Spotify API 호출, 실제 재생 가능성 확인, 운영 DB 적재는 수행하지 않는다.

## 구조

```text
music/
├── README.md, SPEC.md, SOURCES.md, AGENTS.md
├── algorithm/
│   ├── recommend.ts
│   └── recommend.test.mjs
├── data/experiment-v1/
│   ├── .gitattributes
│   ├── README.md
│   ├── manifest.json
│   ├── normalization.json
│   └── songs.jsonl
├── db/
│   ├── 001_schema.sql
│   ├── 002_normalization_v1.sql
│   ├── 003_recommendation_views.sql
│   ├── compact_experiment.ts
│   ├── experiment_input.ts
│   └── validate.mjs
└── integration/
    ├── dev_experiment_service.ts
    ├── dev_router.ts
    ├── dto.ts
    ├── repository.ts
    ├── service.ts
    ├── compact_experiment.test.mjs
    ├── dev_recommendations.test.mjs
    ├── recommendation.test.mjs
    └── tsconfig.check.json
```

`compact_experiment.ts`는 파일 해시·건수·식별자 등을 검사하고 6개 고유 축을
알고리즘의 14필드 입력으로 복원한다. `experiment_input.ts`는 미검증 실험 경계를
검사한다. `dev_experiment_service.ts`는 파일 데이터와 실험 상태를 공급하고,
`dev_router.ts`가 개발용 HTTP를 담당한다. `service.ts`의 `RecommendationService`는
파일·SQL 공급 경로에서 공통으로 추천과 `tracks[]` 조립을 수행한다.
`dto.ts`는 입력과 좌표 변환, `repository.ts`는 향후 PostgreSQL client 주입을 위한
SQL 조회 코드다. 운영 SQL은 합성 메모리 DB에서만 자동 검사한다.

## 실행

저장소 루트에서 Node.js 24와 프로젝트 지정 pnpm을 사용한다.

```powershell
corepack pnpm install --frozen-lockfile
$env:NODE_ENV = 'development'
$env:ENABLE_DEV_MUSIC_RECOMMENDATIONS = 'true'
corepack pnpm dev
```

기본 데이터는 `src/music/data/experiment-v1/`이다. `.local/`은 필요 없다.
`MUSIC_EXPERIMENT_SOURCE`는 미설정 또는 `dataset`만 허용한다.
과거 `pglite` 소스 및 `MUSIC_EXPERIMENT_ROOT`는 제거해야 한다. 해당 설정이 있으면
개발 API는 `503 UNSUPPORTED_EXPERIMENT_SOURCE`를 반환하며 자동 대체하지 않는다.
다른 배포 위치는 `MUSIC_DATASET_ROOT`로 지정할 수 있다.

```powershell
corepack pnpm build
corepack pnpm start
```

`tsc`는 데이터 파일을 복사하지 않는다. 빌드 결과만 배포할 때도 데이터 폴더를 함께
제공하고 `MUSIC_DATASET_ROOT`를 지정한다. `NODE_ENV=production`에서는 이 API를 제공하지 않는다.

## API

`POST http://localhost:3000/api/dev/music/recommendations`

```json
{"coordinateSpace":"unit-interval-v1","view":"A","valence":0.5,"arousal":0.5,"limit":1}
```

5개 필드가 모두 필요하고 추가 필드는 거절한다. 좌표는 0~1의 유한 숫자,
limit는 0~100 정수다. 내부 좌표는 `2*x-1`로 변환한다.
응답은 추천 순서의 음악 객체 배열 `tracks[]`를 반환한다. 최대 100곡이며 반경 내 후보가
부족해도 임의 곡으로 채우지 않는다. 위 요청의 응답 예시는 다음과 같다.

```json
{
  "coordinateSpace":"unit-interval-v1",
  "view":"A",
  "tracks":[
    {
      "songId":"18277",
      "spotifyId":"56b27J3f8IgjauSAbBvA2o",
      "title":"Friends, Beware",
      "artist":"Adem",
      "durationMs":null,
      "valence":0.5,
      "arousal":0.498,
      "normalization":{"valence":"reccobeats-v1","arousal":"reccobeats-v1"}
    }
  ],
  "returnedCount":1,
  "reason":"limit-reached",
  "experimental":true,
  "verified":false,
  "canonicalSongIds":false,
  "idNamespace":"music_experiment.common_songs",
  "datasetId":"music-experiment-20261020-v3"
}
```

`returnedCount`는 `tracks.length`와 같다. `limit=0`이면 빈 배열과 `zero-limit`를 반환한다.
정확한 reason 값은 [알고리즘 계약](algorithm/recommend.ts)을 따른다. 최상위 `spotifyIds`는
반환하지 않으며 `tracks[].spotifyId`를 사용한다.
각 곡의 `title`, `artist`는 MuSe 출처의 실제 데이터이며 Spotify ID로 연결한다.
`durationMs`는 미수집으로 전곡 `null`이다. 응답 좌표는 0~1이고 `normalization`에는
valence/arousal 정규화 버전이 들어간다. `reccobeatsId`, `albumImageUrl`, `requestStatus`는
추천 응답 필드가 아니다.

`experimental=true`, `verified=false`, `canonicalSongIds=false`를 유지한다.
`songId`는 `idNamespace=music_experiment.common_songs`의 실험 ID이고,
`datasetId`와 함께 해석해야 한다. Spotify ID가 있어도 공식 검증·재생 가능성을 뜻하지 않는다.

| HTTP | 의미 |
|---|---|
| 200 | 추천 성공, 빈 목록·limit=0 포함 |
| 400 INVALID_INPUT | VIEW·좌표·필드·JSON 오류 |
| 404 | development가 아니거나 활성화 플래그가 없음 |
| 503 EXPERIMENT_UNAVAILABLE | 데이터 파일·manifest 누락 또는 무결성 오류 |
| 503 UNSUPPORTED_EXPERIMENT_SOURCE | 지원하지 않는 소스 또는 과거 DB 경로 설정 |
| 500 EXPERIMENT_DATA_INVALID | 추천 입력 데이터 계약 오류 |

## 팀원용 내부 호출

매장 서비스에서는 HTTP 호출 없이 기존 `DevExperimentService.recommend()`를 사용할 수 있다.
내부에서 동일한 27,948곡 파일 공급과 `RecommendationService`를 사용하며,
입력은 HTTP와 동일한 5개 필드만 허용하고 `limit`도 필수다.
아래 import는 `src/services/`에 있는 호출 코드 기준이다.

```ts
import { DevExperimentService } from '../music/integration/dev_experiment_service.js';
import type { ExperimentRecommendationOutput } from '../music/integration/dto.js';

// 앱에서 한 인스턴스를 생성해 재사용한다.
const music = new DevExperimentService();

const result: ExperimentRecommendationOutput = await music.recommend({
  coordinateSpace: 'unit-interval-v1',
  view: 'B1', // A | B1 | B2 | C1 | C2
  valence: 0.5,
  arousal: 0.7,
  limit: 100,
});

// result.tracks, returnedCount, reason과 실험 상태·namespace·datasetId를 함께 사용한다.
// 앱 종료 시: await music.close();
```

다른 파일 위치를 사용할 때는 `new DevExperimentService(datasetRoot)`로 경로를 전달한다.
직접 호출은 `MUSIC_DATASET_ROOT`나 개발 HTTP 활성화 플래그를 자동으로 읽지 않는다.
점주·매장 권한 검사는 호출 측에서 담당한다. 입력 오류는 `InputError`, 데이터 파일 로딩·
무결성 오류는 `ExperimentUnavailableError`, 추천 데이터 오류는 `DataError`로 처리할 수 있다.
이 메서드는 추천 결과만 반환하며 매장별 카탈로그 저장이나 고객 신청을 수행하지 않는다.

## 모델

| VIEW | Valence | Arousal |
|---|---|---|
| A | ReccoBeats Valence | ReccoBeats Energy |
| B1 | MuSe 이론 Valence | MuSe 이론 Arousal |
| B2 | MuSe 관측 Valence | MuSe 관측 Arousal |
| C1 | ReccoBeats Valence | MuSe 이론 Arousal |
| C2 | ReccoBeats Valence | MuSe 관측 Arousal |

정규화는 `2*(x-min)/(max-min)-1`이며 고정 범위와 출처는
[SPEC](SPEC.md), [normalization.json](data/experiment-v1/normalization.json)에 있다.
좌표를 API 요청 시 다시 정규화하거나 일부 곡만으로 범위를 재계산하지 않는다.

## 검증

저장소 루트에서 다음 명령을 실행한다. 이름 필터나 비공개 DB가 필요하지 않다.

```powershell
corepack pnpm build
corepack pnpm exec tsc -p src/music/integration/tsconfig.check.json
node --import tsx --test --test-concurrency=1 src/music/algorithm/recommend.test.mjs src/music/integration/recommendation.test.mjs src/music/integration/compact_experiment.test.mjs src/music/integration/dev_recommendations.test.mjs
node src/music/db/validate.mjs
```

PGlite 0.5.10은 devDependency이며 `new PGlite()` 합성 메모리 검사에만 사용한다.
파일 DB 경로를 받는 테스트는 개발 브랜치에 없다. 테스트 임시 데이터는 OS 임시 폴더의
공유 JSON 사본뿐이며 원본 DB나 백업을 연결하지 않는다.

## 현재 상태와 운영 전환

개발용 HTTP·내부 직접 호출·메타데이터를 포함한 `tracks[]` 반환·5모델 재현·데이터 무결성
검사는 구현되어 있다. 곡명·아티스트는 MuSe 출처이며 Spotify 공식 검증은 완료되지 않았다.
실제 Spotify ID의 현재 유효성·재생 가능성, 감정 추천 품질은 이 테스트로 확인하지 않는다.
운영 전환에는 PostgreSQL client 주입, 승인된 데이터 적재와 검증, 정식 메타데이터,
인증·매장별 권한·대기열 정책·최종 API 계약의 팀 합의가 필요하다.
실험 ID는 운영 song ID가 아니며 pending을 verified로 자동 승격하지 않는다.
기존 `/api/stores/:storeId/catalog`, `/tracks`, `/api/health`의 동작은 유지한다.
매장 카탈로그·전체 곡 조회는 현재 고정 예시 곡 1개를 반환하며 추천 서비스와 연결되지 않았다.
매장별 감정 설정·카탈로그 저장·고객 신청·대기열 처리도 미구현이다.

## 연구 보관과 출처

연구 원형은 `archive/music-research-20261027` 브랜치의 기준 커밋
`6eb1f96efa37bc1785f925a24039f46b7026fe3d`에 보존한다.
해당 브랜치의 `src/music/collectors/`, `src/music/reports/`, 연구용 `src/music/db/`
도구와 `PROJECT.md`, `PLAN.md`, `STATUS.md`에서 과거 수집·정제·재생성·모델 비교를
확인할 수 있다. 개발 브랜치는 그 실행 환경을 제공하지 않는다.
보관 브랜치도 Git에서 제외된 원본 DB를 포함하지 않는다.

출처와 기존 공유 검토 이력은 [SOURCES.md](SOURCES.md), 승인된 축소 데이터셋의
사용 조건은 [데이터셋 README](data/experiment-v1/README.md)를 따른다.
과거 검증 기록과 manifest의 해시는 변경하지 않는다.
