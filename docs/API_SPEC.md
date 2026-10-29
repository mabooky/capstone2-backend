# 스마트 주크박스 MVP — API 명세 (v0.6)

이 문서는 Frontend 개발을 위한 API 계약서입니다. 모든 엔드포인트, 데이터 타입, 에러 코드, 예시 응답을 이 문서 하나에서 확인할 수 있습니다.
백엔드 구현이 완료되기 전에는 각 항목의 예시 응답을 고정 응답(mock)으로 사용하여 개발을 진행할 수 있습니다.



## 1. 공통 규칙

| 항목 | 내용 |
|---|---|
| Base URL | `https://capstone2-backend-production.up.railway.app/api/stores/:storeId`. `:storeId`는 매장(테넌트)의 식별자입니다. 등록되지 않은 `storeId`로 요청하면 404 Not Found(`STORE_NOT_FOUND`)가 반환됩니다. |
| 매장별 독립 동작 | 기준점, 대기열, 재생 상태, 곡 재생 기록, 관리자 세션, 관리자 비밀번호는 모두 매장(`storeId`)별로 독립적으로 동작합니다. 한 매장의 요청은 다른 매장의 상태에 영향을 주지 않습니다. |
| Content-Type | `application/json` |
| 좌표 | 모든 `valence`, `arousal` 값은 **[-1, 1]** 범위입니다. 서버와 클라이언트 모두 별도의 변환을 수행하지 않습니다. |
| 고객 식별 | 클라이언트가 UUID를 생성하여 `localStorage`에 저장하고, `X-Client-Id`가 필요한 엔드포인트를 호출할 때마다 `X-Client-Id: <uuid>` 헤더로 전달합니다. 같은 값을 여러 매장에서 사용해도 되며, 서버는 `storeId`와 `X-Client-Id`의 조합으로 고객을 구분합니다. |
| 관리자 인증 | `POST /admin/login`으로 발급받은 토큰을 `Authorization: Bearer <token>` 헤더로 전달합니다. `/admin/login`을 제외한 모든 `/admin/*` 요청에 필요하며, 토큰이 없거나 유효하지 않으면 401 Unauthorized(`UNAUTHORIZED`)가 반환됩니다. 관리자 세션은 매장별로 하나만 유효하며, 같은 매장에서 새로 로그인하면 이전 토큰은 무효가 됩니다. |
| 폴링 | 고객 화면과 관리자 화면 모두 `GET /queue`를 **2초 간격**으로 호출합니다. WebSocket은 사용하지 않습니다. |
| 시간 단위 | 모든 시각은 Unix epoch **밀리초**이며, `duration` 또한 **밀리초** 단위입니다. |
| 헬스체크 | `GET /api/health` (`storeId` 없음) → `{ "status": "ok", "timestamp": 1761650000000 }` |



## 2. 데이터 타입

```ts
type RequestStatus =
  | 'available'         // 가드레일 안에 있으며 신청 가능
  | 'out-of-mood'       // 가드레일 밖의 곡 (검색 결과에서만 반환)
  | 'already-queued'    // 이미 대기열에 있음
  | 'now-playing'       // 현재 재생 중
  | 'recently-played';  // 재생 시작 후 30분 이내 (곡 쿨타임)

type Track = {
  spotifyId: string;       // Spotify Track ID (22자). 곡의 유일한 식별자입니다.
  title: string;
  artist: string;
  duration: number;        // ms
  albumImageUrl: string;
  valence: number;         // [-1, 1]
  arousal: number;         // [-1, 1]
};

// 카탈로그와 검색 결과에서만 사용합니다.
type TrackWithStatus = Track & { requestStatus: RequestStatus };

type Mood = {
  valence: number;         // [-1, 1]
  arousal: number;         // [-1, 1]
  n: number;               // 가드레일에 포함할 곡 수 (1~100, 기본값 100)
};

type QueueEntry = {
  queueId: string;
  track: Track;
  requestedAt: number;     // epoch ms
  mine: boolean;           // 요청 헤더의 X-Client-Id 기준
};

type NowPlayingEntry = {
  track: Track;
  startedAt: number;       // epoch ms
  source: 'request' | 'fallback';   // 고객 신청 / 대기열이 비어 자동 재생
};
```

`requestStatus`는 카탈로그와 검색 결과(`TrackWithStatus`)에서만 붙으며, 그 밖의 응답에 포함된 곡은 모두 `requestStatus`가 없는 `Track`입니다. `requestStatus` 값에 따른 화면 처리 기준은 다음과 같습니다.

| `requestStatus` | 화면 처리 |
|---|---|
| `available` | 활성 상태로 표시합니다. |
| `out-of-mood` | **비활성** 상태로 표시합니다. |
| `already-queued` | 비활성 상태로 표시하고 "대기 중"이라고 안내합니다. |
| `now-playing` | 비활성 상태로 표시하고 "재생 중"이라고 안내합니다. |
| `recently-played` | 비활성 상태로 표시하고 "최근 재생됨"이라고 안내합니다. |

하나의 곡에 여러 상태가 동시에 해당될 수 있습니다. 예를 들어 재생 중인 곡은 재생 시작 후 30분 이내이므로 `recently-played`에도 해당되며, 대기 중인 곡은 기준점이 변경되어 가드레일 밖이 되면 `out-of-mood`에도 해당됩니다. 이 경우 서버는 아래 우선순위에서 가장 앞선 하나의 상태만 반환합니다.

`now-playing` > `already-queued` > `out-of-mood` > `recently-played` > `available`

### 에러 형식과 코드

모든 에러 응답은 아래 형식을 따릅니다. `retryAfterSec` 항목은 429 Too Many Requests 응답에서만 포함됩니다. `message`는 사람이 읽을 수 있는 한국어 안내 문장이며 표현이 바뀔 수 있으므로, 동작을 분기할 때에는 `code` 값을 사용해 주십시오.

```json
{ "error": { "code": "TRACK_COOLDOWN", "message": "최근에 재생된 곡입니다.", "retryAfterSec": 1200 } }
```

| 상태 | code | 의미 |
|---|---|---|
| 400 Bad Request | `INVALID_INPUT` | 요청 형식이 올바르지 않습니다. |
| 400 Bad Request | `MISSING_CLIENT_ID` | `X-Client-Id` 헤더가 없습니다. |
| 401 Unauthorized | `UNAUTHORIZED` | 관리자 토큰이 없거나 유효하지 않습니다. |
| 401 Unauthorized | `INVALID_CREDENTIALS` | 관리자 비밀번호가 올바르지 않습니다. |
| 403 Forbidden | `OUT_OF_MOOD` | 현재 가드레일 밖의 곡입니다. |
| 404 Not Found | `STORE_NOT_FOUND` | 등록되지 않은 `storeId`입니다. |
| 404 Not Found | `TRACK_NOT_FOUND` | 데이터셋에 등록되지 않은 곡입니다. |
| 404 Not Found | `QUEUE_ITEM_NOT_FOUND` | 존재하지 않는 `queueId`입니다. |
| 409 Conflict | `TRACK_ALREADY_QUEUED` | 해당 곡이 이미 대기 중이거나 재생 중입니다. |
| 409 Conflict | `MY_REQUEST_PENDING` | 본인이 신청한 곡이 아직 대기열에 있습니다. 해당 곡의 재생이 시작되면 다시 신청할 수 있습니다. |
| 409 Conflict | `NOT_NEXT_IN_QUEUE` | 재생을 보고한 곡이 대기열의 맨 앞 곡이 아닙니다. |
| 409 Conflict | `NO_TRACKS` | 재생할 수 있는 곡이 없습니다. 가드레일에 곡이 하나도 없는 경우입니다. |
| 429 Too Many Requests | `TRACK_COOLDOWN` | 해당 곡이 최근 30분 이내에 재생되었습니다. `retryAfterSec`이 포함됩니다. |



## 3. 공개 API

공개 API는 관리자 토큰 없이 호출할 수 있으며, 고객 화면과 관리자 화면에서 함께 사용합니다. 고객을 식별하는 `X-Client-Id` 헤더는 필요한 엔드포인트에 한하여 각 항목에 명시되어 있습니다.

### GET /mood

현재 기준점을 반환합니다.

응답 `200 OK`:
```json
{ "valence": 0.2, "arousal": -0.1, "n": 100 }
```

### GET /catalog

기준점에서 가장 가까운 n곡을 가까운 순서로 반환합니다. 응답은 `TrackWithStatus[]`이며, 모두 가드레일 안의 곡이므로 `out-of-mood` 상태는 포함되지 않습니다.

MVP에서는 기준점 변경을 실시간으로 감지하지 않습니다. 화면을 열 때(새로고침 포함)와 신청이 실패한 후에 이 API를 다시 호출해 주십시오.

응답 `200 OK`:
```json
[
  {
    "spotifyId": "0aB1cD2eF3gH4iJ5kL6mN7",
    "title": "Don't Know Why",
    "artist": "Norah Jones",
    "duration": 186000,
    "albumImageUrl": "https://example.com/mock/cover1.jpg",
    "valence": 0.18,
    "arousal": -0.22,
    "requestStatus": "available"
  },
  {
    "spotifyId": "7xK2pQ9rT4vW1yZ6bC8dE3",
    "title": "Yellow (Acoustic)",
    "artist": "Coldplay",
    "duration": 269000,
    "albumImageUrl": "https://example.com/mock/cover2.jpg",
    "valence": 0.05,
    "arousal": -0.05,
    "requestStatus": "already-queued"
  },
  {
    "spotifyId": "3mN5oP7qR9sT1uV3wX5yZ7",
    "title": "Mock Track Three",
    "artist": "Mock Artist",
    "duration": 201000,
    "albumImageUrl": "https://example.com/mock/cover3.jpg",
    "valence": 0.31,
    "arousal": 0.02,
    "requestStatus": "now-playing"
  },
  {
    "spotifyId": "9aC2eG4iK6mO8qS0uW2yA4",
    "title": "Mock Recently Played",
    "artist": "Mock Artist",
    "duration": 233000,
    "albumImageUrl": "https://example.com/mock/cover4.jpg",
    "valence": 0.22,
    "arousal": -0.12,
    "requestStatus": "recently-played"
  }
]
```

### GET /search

분석된 전체 곡을 대상으로 검색합니다. 가드레일 밖의 곡은 `out-of-mood` 상태로 반환되며, 화면에서는 비활성 상태로 표시해야 합니다.

| 쿼리 파라미터 | 규칙 |
|---|---|
| `q` | 필수이며 앞뒤 공백을 제외하고 1자 이상이어야 합니다. 제목과 아티스트를 대상으로 대소문자를 구분하지 않는 부분 일치 검색을 수행하며, 앞부분이 일치하는 결과를 먼저 반환합니다. |
| `limit` | 기본값은 20이며 최대 50입니다. |
| `offset` | 기본값은 0입니다. |

유의 사항은 다음과 같습니다.
- 검색 대상인 "전체 곡"은 Spotify 전체가 아니라 **분석이 완료된 곡**을 의미합니다. 검색 결과가 없으면 "등록되지 않은 곡입니다"와 같은 안내 문구를 표시해 주십시오.
- 입력 중 불필요한 호출을 줄이기 위해 300ms 디바운스를 권장합니다. 검색어가 짧으면 일치하는 곡이 많아 `total`이 커질 수 있으므로, `limit`과 `offset`으로 나누어 불러 주십시오.
- `offset`이 `total` 이상이면 에러가 아니라 빈 `tracks`와 `total`을 반환합니다.
- `q`가 비어 있거나 공백뿐이거나, `limit`이 허용 범위를 벗어나거나, `offset`이 음수이면 400 Bad Request(`INVALID_INPUT`)가 반환됩니다.

요청: `GET /search?q=norah&limit=20&offset=0`

응답 `200 OK` (`total`은 일치하는 전체 건수이며, `tracks`는 현재 페이지의 결과입니다):
```json
{
  "query": "norah",
  "total": 2,
  "tracks": [
    {
      "spotifyId": "0aB1cD2eF3gH4iJ5kL6mN7",
      "title": "Don't Know Why",
      "artist": "Norah Jones",
      "duration": 186000,
      "albumImageUrl": "https://example.com/mock/cover1.jpg",
      "valence": 0.18,
      "arousal": -0.22,
      "requestStatus": "available"
    },
    {
      "spotifyId": "5bD3fH5jL7nP9rT1vX3zB5",
      "title": "Mock High Energy Song",
      "artist": "Norah Mock",
      "duration": 233000,
      "albumImageUrl": "https://example.com/mock/cover5.jpg",
      "valence": 0.7,
      "arousal": 0.92,
      "requestStatus": "out-of-mood"
    }
  ]
}
```

### GET /queue

현재 재생 중인 곡과 대기열을 반환합니다. 이 API는 **폴링 대상**이며, 항상 현재 상태 전체를 반환합니다. 쿼리 파라미터는 없으며, 클라이언트는 응답받은 값으로 화면을 통째로 교체하면 됩니다.

- 재생 중인 곡이 없으면 `nowPlaying`은 `null`입니다.
- `queue`는 재생 순서대로 정렬되어 있습니다. `mine`은 요청 헤더의 `X-Client-Id`를 기준으로 계산됩니다.
- 재생 진행률은 `serverTime`과 `startedAt`을 이용해 계산합니다. 단, 관리자 화면에서는 SDK가 제공하는 재생 위치를 사용합니다.

요청 헤더: `X-Client-Id: 6f1c1e2a-8b0d-4f6e-9c7a-3d2b5e8a1f40`

응답 `200 OK`:
```json
{
  "serverTime": 1761650000000,
  "nowPlaying": {
    "track": {
      "spotifyId": "3mN5oP7qR9sT1uV3wX5yZ7",
      "title": "Mock Track Three",
      "artist": "Mock Artist",
      "duration": 201000,
      "albumImageUrl": "https://example.com/mock/cover3.jpg",
      "valence": 0.31,
      "arousal": 0.02
    },
    "startedAt": 1761649900000,
    "source": "request"
  },
  "queue": [
    {
      "queueId": "q7",
      "track": {
        "spotifyId": "7xK2pQ9rT4vW1yZ6bC8dE3",
        "title": "Yellow (Acoustic)",
        "artist": "Coldplay",
        "duration": 269000,
        "albumImageUrl": "https://example.com/mock/cover2.jpg",
        "valence": 0.05,
        "arousal": -0.05
      },
      "requestedAt": 1761649950000,
      "mine": true
    }
  ]
}
```

재생 중인 곡과 대기 중인 곡이 모두 없는 경우의 응답은 다음과 같습니다.
```json
{ "serverTime": 1761650000000, "nowPlaying": null, "queue": [] }
```

### POST /queue

곡을 신청합니다. `X-Client-Id` 헤더가 필수입니다.

요청:
```json
{ "spotifyId": "0aB1cD2eF3gH4iJ5kL6mN7" }
```

성공 `201 Created` (`QueueEntry`):
```json
{
  "queueId": "q8",
  "track": {
    "spotifyId": "0aB1cD2eF3gH4iJ5kL6mN7",
    "title": "Don't Know Why",
    "artist": "Norah Jones",
    "duration": 186000,
    "albumImageUrl": "https://example.com/mock/cover1.jpg",
    "valence": 0.18,
    "arousal": -0.22
  },
  "requestedAt": 1761650010000,
  "mine": true
}
```

요청은 아래 순서로 검사되며, 가장 먼저 해당되는 에러가 반환됩니다.

| 순서 | 상태 | code |
|---|---|---|
| 1 | 400 Bad Request | `INVALID_INPUT`, `MISSING_CLIENT_ID` |
| 2 | 404 Not Found | `TRACK_NOT_FOUND` |
| 3 | 403 Forbidden | `OUT_OF_MOOD` |
| 4 | 409 Conflict | `TRACK_ALREADY_QUEUED` |
| 5 | 429 Too Many Requests | `TRACK_COOLDOWN` |
| 6 | 409 Conflict | `MY_REQUEST_PENDING` |

에러 응답 예시는 다음과 같습니다. 나머지 코드는 2절의 형식과 표를 따릅니다.
```jsonc
// 403 Forbidden (OUT_OF_MOOD): 카탈로그를 다시 불러오고 안내 문구를 표시합니다.
{ "error": { "code": "OUT_OF_MOOD", "message": "현재 기준점의 범위를 벗어난 곡입니다." } }

// 429 Too Many Requests (TRACK_COOLDOWN)
{ "error": { "code": "TRACK_COOLDOWN", "message": "최근에 재생된 곡입니다.", "retryAfterSec": 1200 } }

// 409 Conflict (MY_REQUEST_PENDING)
{ "error": { "code": "MY_REQUEST_PENDING", "message": "이미 대기열에 신청한 곡이 있습니다." } }
```

신청이 성공하면 응답을 화면에 즉시 반영하고(낙관적 업데이트), 이후 폴링 결과로 덮어씁니다.

### GET /me

현재 고객의 신청 가능 상태를 반환합니다. 신청 버튼의 활성화 여부를 표시하는 데 사용합니다. `X-Client-Id` 헤더가 필수입니다.

- `reason`은 `null` 또는 `"MY_REQUEST_PENDING"`입니다. 본인이 신청한 곡이 대기열에 있으면 `"MY_REQUEST_PENDING"`이며, 재생 중인 곡은 대기 중으로 간주하지 않습니다.

응답 `200 OK` (신청 가능):
```json
{ "canRequest": true, "reason": null }
```

응답 `200 OK` (본인의 곡이 대기 중):
```json
{ "canRequest": false, "reason": "MY_REQUEST_PENDING" }
```



## 4. 관리자 전용 API

`/admin/login`을 제외한 모든 요청에는 `Authorization: Bearer <token>` 헤더가 필요합니다. 관리자 화면에서 대기열과 기준점을 표시할 때에는 공개 API의 `GET /queue`, `GET /mood`, `GET /catalog`를 그대로 사용합니다.

### POST /admin/login

토큰 없이 호출합니다. 관리자 비밀번호는 매장마다 다릅니다. 비밀번호가 올바르지 않으면 401 Unauthorized(`INVALID_CREDENTIALS`)가 반환됩니다.

요청:
```json
{ "password": "admin-password" }
```

응답 `200 OK`:
```json
{ "token": "mock-admin-token" }
```

관리자 세션은 매장별로 하나만 유효합니다. 같은 매장에서 새로 로그인하면 이전에 발급된 토큰은 무효가 되며(다른 매장의 토큰에는 영향이 없습니다), 서버를 재시작하면 모든 토큰이 무효가 됩니다. 무효한 토큰으로 요청하면 401 Unauthorized(`UNAUTHORIZED`)가 반환됩니다. 이 응답을 받으면 재생을 중단하고 로그인 화면으로 이동시켜 주십시오. 다른 기기에서 로그인하여 이전 세션이 무효가 된 경우에도 같은 응답이 반환됩니다.

### PUT /admin/mood

기준점을 설정합니다. 요청 본문의 값으로 기준점 전체를 교체합니다.

- `valence`와 `arousal`은 필수이며 [-1, 1] 범위여야 합니다.
- `n`은 선택 항목입니다. 생략하면 100이 적용되며, 이전에 설정한 `n`이 유지되지 않습니다. 지정하는 경우 1~100 범위의 정수여야 합니다.
- 관리자가 곡 수를 줄인 상태에서 기준점만 다시 설정하는 경우에도 현재 `n` 값을 함께 보내 주십시오. 생략하면 100으로 초기화됩니다. 현재 값은 `GET /mood`로 확인할 수 있습니다.
- 범위를 벗어난 값이 있으면 400 Bad Request(`INVALID_INPUT`)가 반환됩니다.
- 이미 대기열에 들어간 곡은 기준점이 변경되어도 유지됩니다.

요청:
```json
{ "valence": 0.2, "arousal": -0.1 }
```

`n`을 지정하는 경우의 요청:
```json
{ "valence": 0.2, "arousal": -0.1, "n": 50 }
```

응답 `200 OK`: 새로운 카탈로그 `TrackWithStatus[]` (형식은 `GET /catalog`와 동일합니다.)

### GET /admin/mood/preview

기준점을 확정하기 전에, 지정한 좌표에서 가장 가까운 곡들을 미리 조회합니다. 관리자가 사분면의 여러 지점을 살펴보며 기준점을 고르는 용도로 사용합니다.

| 쿼리 파라미터 | 규칙 |
|---|---|
| `valence` | 필수이며 [-1, 1] 범위여야 합니다. |
| `arousal` | 필수이며 [-1, 1] 범위여야 합니다. |
| `n` | 선택 항목이며 1~100 범위의 정수입니다. 생략하면 100이 적용됩니다. |

- 응답은 `Track[]`이며, 지정한 좌표에서 가까운 순서로 정렬됩니다. 곡의 신청 상태는 필요하지 않으므로 `requestStatus`는 포함되지 않습니다.
- **현재 기준점, 카탈로그, 대기열을 변경하지 않습니다.** 기준점의 확정은 `PUT /admin/mood`로 수행합니다.
- 각 곡에 `valence`와 `arousal`이 포함되어 있으므로, 결과를 사분면 위에 점으로 표시할 수 있습니다.
- 범위를 벗어난 값이 있으면 400 Bad Request(`INVALID_INPUT`)가 반환됩니다.
- 클릭이나 드래그마다 호출하지 말고 150~300ms 디바운스를 적용해 주십시오. 새 요청을 보낼 때에는 이전 요청을 취소하는 것을 권장합니다.

요청: `GET /admin/mood/preview?valence=0.2&arousal=-0.1&n=100`

응답 `200 OK`:
```json
[
  {
    "spotifyId": "0aB1cD2eF3gH4iJ5kL6mN7",
    "title": "Don't Know Why",
    "artist": "Norah Jones",
    "duration": 186000,
    "albumImageUrl": "https://example.com/mock/cover1.jpg",
    "valence": 0.18,
    "arousal": -0.22
  },
  {
    "spotifyId": "7xK2pQ9rT4vW1yZ6bC8dE3",
    "title": "Yellow (Acoustic)",
    "artist": "Coldplay",
    "duration": 269000,
    "albumImageUrl": "https://example.com/mock/cover2.jpg",
    "valence": 0.05,
    "arousal": -0.05
  }
]
```

### GET /admin/fallback-track

대기열이 비어 있을 때 자동으로 재생할 곡을 한 곡 받아옵니다. 가드레일 전체에서 **지금 신청 가능한 곡**(대기 중인 곡, 재생 중인 곡, 최근 30분 이내에 재생된 곡을 제외한 곡) 중 무작위로 선택합니다. 신청 가능한 곡이 없으면 가장 오래전에 재생된 곡을 반환합니다.

- 응답은 `Track` 객체 하나입니다.
- 서버의 상태를 변경하지 않습니다. 반환된 곡을 재생하려면 이어서 `PUT /admin/now-playing`으로 보고해야 합니다.
- 가드레일에 곡이 하나도 없으면 409 Conflict(`NO_TRACKS`)가 반환됩니다.

응답 `200 OK`:
```json
{
  "spotifyId": "0aB1cD2eF3gH4iJ5kL6mN7",
  "title": "Don't Know Why",
  "artist": "Norah Jones",
  "duration": 186000,
  "albumImageUrl": "https://example.com/mock/cover1.jpg",
  "valence": 0.18,
  "arousal": -0.22
}
```

### PUT /admin/now-playing

관리자 클라이언트가 **지금 재생하려는 곡을 서버에 보고**합니다. 서버는 보고된 곡이 규칙에 맞는지 판단하여 재생 상태를 기록하며, 다음 곡을 대신 결정하지 않습니다. 어떤 곡을 재생할지는 클라이언트가 결정합니다.

요청:
```json
{ "spotifyId": "7xK2pQ9rT4vW1yZ6bC8dE3" }
```

서버는 보고된 곡을 아래 규칙으로 처리하며, 위에서부터 먼저 해당하는 규칙이 적용됩니다.

| 보고된 곡 | 처리 |
|---|---|
| 데이터셋에 없는 곡 | 404 Not Found(`TRACK_NOT_FOUND`)가 반환됩니다. |
| 현재 `nowPlaying`과 같은 곡 | 다시 재생으로 처리합니다. `startedAt`만 갱신하고 대기열은 변경하지 않습니다. |
| 대기열이 비어 있지 않고, 맨 앞의 곡 | 대기열에서 제거하고 `source: "request"`로 기록합니다. |
| 대기열이 비어 있지 않고, 맨 앞이 아닌 곡 | 409 Conflict(`NOT_NEXT_IN_QUEUE`)가 반환됩니다. `GET /queue`를 다시 호출한 뒤 맨 앞의 곡으로 재시도해 주십시오. |
| 대기열이 비어 있고, 가드레일 안의 곡 | `source: "fallback"`으로 기록합니다. |
| 대기열이 비어 있고, 가드레일 밖의 곡 | 403 Forbidden(`OUT_OF_MOOD`)이 반환됩니다. |

- 이 호출 시점이 해당 곡의 **곡 쿨타임 시작 시각**이 됩니다.
- 건너뛰기는 다음에 재생할 곡을 보고하는 것으로 처리합니다.
- 요청 형식이 올바르지 않으면 400 Bad Request(`INVALID_INPUT`)가 반환됩니다.

응답 `200 OK`:
```json
{
  "nowPlaying": {
    "track": {
      "spotifyId": "7xK2pQ9rT4vW1yZ6bC8dE3",
      "title": "Yellow (Acoustic)",
      "artist": "Coldplay",
      "duration": 269000,
      "albumImageUrl": "https://example.com/mock/cover2.jpg",
      "valence": 0.05,
      "arousal": -0.05
    },
    "startedAt": 1761650100000,
    "source": "request"
  }
}
```

클라이언트 유의 사항은 다음과 같습니다.
- **보고가 성공한 뒤에 재생해 주십시오.** 보고가 실패하면 재생하지 않고 재시도합니다. 이 순서를 지키면 클라이언트가 중간에 종료되어도 서버의 상태와 실제 재생이 어긋나지 않습니다.
- **다음에 재생할 곡은 클라이언트가 결정합니다.** 대기열이 있으면 맨 앞의 곡을, 비어 있으면 `GET /admin/fallback-track`으로 받은 곡을 재생합니다.
- **곡이 끝났는지는 클라이언트가 판단합니다.** SDK의 `player_state_changed` 이벤트는 중복으로 발생할 수 있으므로, 곡 단위로 종료 처리를 한 번만 수행해 주십시오. 종료 처리가 중복되면 대기열의 곡이 재생되지 않고 건너뛰어질 수 있으며, 서버는 이를 구별할 수 없습니다. 종료를 판정하는 조건은 Spotify 문서의 `WebPlaybackState`를 참고해 확인해 주십시오.

### DELETE /admin/queue/:queueId

대기열에서 곡을 제거합니다. 요청 본문과 응답 본문은 없습니다.

- 성공하면 `204 No Content`가 반환되며, 존재하지 않는 `queueId`는 404 Not Found(`QUEUE_ITEM_NOT_FOUND`)가 반환됩니다.
- 재생되지 않고 제거된 곡에는 곡 쿨타임이 적용되지 않으며, 해당 신청자는 다시 곡을 신청할 수 있습니다.

### Spotify 로그인

Spotify 로그인(OAuth PKCE)과 토큰 관리는 Frontend에서 직접 처리하며, 백엔드는 Spotify 사용자 토큰을 다루지 않습니다. Web Playback SDK를 사용하려면 Spotify Premium 계정이 필요합니다.

### 관리자 재접속 절차

관리자 클라이언트가 예기치 않게 종료되었다가 다시 접속하는 경우의 절차입니다. 고객이 신청한 곡이 중간에 끊긴 것으로 간주하여, 해당 곡을 **처음부터 다시 재생**합니다.

1. 관리자 화면을 열고 Spotify Web Playback SDK를 초기화한 뒤, `GET /queue`로 서버의 현재 상태를 읽습니다. 관리자 토큰이 무효하면 먼저 로그인합니다.
2. 브라우저의 자동재생 정책 때문에 사용자 조작 없이는 소리를 낼 수 없습니다. "재생 재개" 버튼을 표시하고, 사용자가 누르면 아래 표에 따라 재생할 곡을 정합니다.

| 서버 상태 | 재생할 곡 |
|---|---|
| `nowPlaying.source`가 `"request"` | `nowPlaying`의 곡을 다시 재생합니다. |
| `nowPlaying.source`가 `"fallback"`이고 대기열이 비어 있지 않음 | 대기열의 맨 앞 곡을 재생합니다. 자동 재생 곡은 다시 재생하지 않습니다. |
| `nowPlaying.source`가 `"fallback"`이고 대기열이 비어 있음 | `nowPlaying`의 곡을 다시 재생합니다. |
| `nowPlaying`이 `null` | 대기열이 비어 있지 않으면 맨 앞 곡을, 비어 있으면 `GET /admin/fallback-track`으로 받은 곡을 재생합니다. |

3. 정한 곡을 `PUT /admin/now-playing`으로 보고하고, 성공하면 처음부터 재생합니다.
4. 이후에는 곡이 끝날 때마다 같은 방식으로(대기열의 맨 앞 곡 또는 fallback 곡을 보고한 뒤 재생) 진행합니다.

유의 사항은 다음과 같습니다.
- 곡이 정상적으로 끝난 직후, 다음 곡을 보고하기 전에 종료된 경우에는 서버가 이를 구별할 수 없습니다. 이 경우 이미 끝난 곡이 처음부터 다시 재생될 수 있습니다.



## 5. 동작 규칙 요약

- **재생 주도권:** 다음에 재생할 곡은 관리자 클라이언트가 결정하고 `PUT /admin/now-playing`으로 서버에 보고합니다. 서버는 보고된 곡을 검증하고 기록합니다.
- **곡 쿨타임:** 곡이 대기 중이거나 재생 중이거나, 재생이 시작된 지 30분 이내이면 신청할 수 없습니다. 재생 시작 시각은 `PUT /admin/now-playing`으로 재생이 보고된 시점입니다. 30분 값은 서버 환경변수로 조정할 수 있습니다.
- **고객당 대기 곡 수:** 고객은 대기열에 곡을 하나만 둘 수 있습니다(`MY_REQUEST_PENDING`). 곡의 재생이 시작되어 대기열에서 빠지면 곧바로 다음 곡을 신청할 수 있습니다. 재생 중인 곡은 "대기 중"으로 간주하지 않으므로, 내 곡이 재생되는 동안에도 다음 곡을 신청할 수 있습니다.
- **기준점 변경:** 이미 대기열에 들어간 곡은 기준점이 변경되어 새 가드레일 밖이 되어도 유지되며, 순서대로 재생됩니다. 이에 따라 대기열의 맨 앞 곡은 가드레일 밖이어도 `PUT /admin/now-playing`으로 보고할 수 있습니다.
- **관리자 세션:** 한 매장에서 한 번에 하나의 관리자 세션만 유효합니다. 같은 매장에서 새로 로그인하면 이전 세션의 토큰은 무효가 됩니다.
- **관리자 탭 종료:** 관리자 탭이 닫히면 재생이 중단되고 재생 보고(`PUT /admin/now-playing`)도 이루어지지 않습니다. 이 경우 고객 화면에는 마지막 `nowPlaying`이 그대로 표시되며, 관리자가 재접속하면 "관리자 재접속 절차"에 따라 복구합니다.
- **일시정지 미지원:** 서버가 재생 위치를 추적하지 않으므로 MVP에서는 일시정지를 지원하지 않습니다. 관리자 화면에서 일시정지 기능을 제공하지 않는 것을 권장하며, 건너뛰기는 다음에 재생할 곡을 `PUT /admin/now-playing`으로 보고하는 방식으로 처리합니다.
- **초기 기준점:** 각 매장에 서버 기본값(`valence 0`, `arousal 0`, `n 100`)이 적용되며, 해당 매장의 관리자가 변경할 수 있습니다.
- **데이터 보관:** 서버를 재시작하면 대기열과 곡 재생 기록(곡 쿨타임)이 초기화됩니다(인메모리 저장).



## 6. 미정 사항 및 변경 가능성

| 항목 | 상태 |
|---|---|
| 곡 메타데이터(제목, 아티스트, 이미지) | 코어 담당 팀원이 데이터를 다시 제공할 예정입니다. 필드 구조는 변경되지 않습니다. |
| 추천 모델(A/B1/B2/C1/C2) | 서버 설정값이며 Frontend에는 영향이 없습니다. |
| 곡 쿨타임 30분 | 서버 환경변수입니다. 값이 변경되어도 API 구조는 동일합니다. |
| 에러 code 이름 | 초안 상태이며, 합의 후 확정합니다. |
| 예시의 곡 정보 | 모두 임의로 작성한 값(mock)입니다. |

### 알려진 한계

- **고객 식별:** `X-Client-Id`는 클라이언트가 생성한 값이므로, `localStorage`를 삭제하거나 값을 바꾸면 서버는 다른 고객으로 인식합니다. 이에 따라 고객당 대기 곡 1개 제한(`MY_REQUEST_PENDING`)을 우회할 수 있습니다. MVP에서는 보안을 구현하지 않기로 한 범위이며, 이후 개선 대상입니다.
