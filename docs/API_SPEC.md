# 스마트 주크박스 MVP — API 명세 (v0.9)

이 문서는 Frontend 개발을 위한 API 계약서입니다. 모든 엔드포인트, 데이터 타입, 에러 코드, 예시 응답을 이 문서 하나에서 확인할 수 있습니다.
백엔드 구현이 완료되기 전에는 각 항목의 예시 응답을 고정 응답(mock)으로 사용하여 개발을 진행할 수 있습니다.

## 변경 요약 (v0.8 → v0.9)

v0.9는 v0.8과 호환되지 않습니다. 주요 변경은 다음과 같습니다.

- **카카오 로그인 도입:** 고객 식별이 `X-Client-Id` 헤더에서 카카오 로그인과 세션 토큰(`Authorization: Bearer`)으로 바뀌었습니다. `X-Client-Id`와 `MISSING_CLIENT_ID`는 제거되었습니다.
- **신규 API:** `POST /api/auth/kakao/login`, `POST /api/auth/logout`, `GET /api/me/requests`(4절), `GET /`(매장 이름 조회)입니다.
- **`GET /queue`를 `GET /state`로 변경:** 대기열 조회 API의 경로가 `GET /state`로 바뀌었고, 현재 카탈로그의 버전(`catalogHash`)이 응답에 포함됩니다. 카탈로그 변경은 이 값이 바뀌는 것으로 감지하며, 값이 바뀌면 `GET /catalog`를 다시 호출해 주십시오.
- **로그인 요구 사항:** `POST /queue`는 로그인이 필수이고, `GET /state`와 `GET /me`는 로그인이 선택입니다. 로그인하지 않은 `GET /me`는 `reason: "LOGIN_REQUIRED"`를 반환합니다.
- **단일 기준점 API 제거:** `PUT /admin/mood`와 `GET /admin/mood/preview`는 영역 입력(`mode`)만 지원합니다. `mode`가 없는 요청은 `400 INVALID_INPUT`입니다. `Mood` 타입도 제거되었습니다.
- **`GET /mood` 응답 변경:** 현재 영역 설정(`RegionRequest`)을 그대로 반환하며, 설정 전에는 `null`입니다.
- **초기 카탈로그:** 서버를 시작한 직후에는 영역이 설정되어 있지 않아 카탈로그가 비어 있습니다. 점주가 `PUT /admin/mood`로 영역을 설정해야 고객이 곡을 신청할 수 있습니다.
- **`returnedCount` 제거:** 영역 설정 응답(`RegionResult`)에서 `returnedCount`가 제거되었습니다. 반환한 곡 수는 `tracks.length`를 사용해 주십시오.
- **에러 코드:** `CUSTOMER_UNAUTHORIZED`, `INVALID_KAKAO_CODE`, `KAKAO_UNAVAILABLE`이 추가되었습니다.

## 1. 공통 규칙

| 항목 | 내용 |
|---|---|
| Base URL | `https://capstone2-backend-production.up.railway.app/api/stores/:storeId`. `:storeId`는 매장(테넌트)의 식별자이며, 매장을 등록할 때 서버가 무작위로 만든 8자 문자열입니다. 등록되지 않은 `storeId`로 요청하면 404 Not Found(`STORE_NOT_FOUND`)가 반환됩니다. |
| 매장별 독립 동작 | 영역 설정, 대기열, 재생 상태, 곡 재생 기록, 관리자 세션, 관리자 비밀번호는 모두 매장(`storeId`)별로 독립적으로 동작합니다. 한 매장의 요청은 다른 매장의 상태에 영향을 주지 않습니다. |
| 계정 API 경로 | 로그인과 사용자 관련 API(`/api/auth/*`, `/api/me/*`)는 매장과 무관하므로 `https://capstone2-backend-production.up.railway.app/api` 아래에 있습니다. `/api/stores/:storeId` 아래가 아닙니다. |
| Content-Type | `application/json` |
| 좌표 | 모든 `valence`, `arousal` 값은 **[-1, 1]** 범위입니다. 서버와 클라이언트 모두 별도의 변환을 수행하지 않습니다. |
| 고객 인증 | 고객은 카카오 로그인으로 인증합니다. 로그인하면 서버가 세션 토큰을 발급하며, 로그인이 필요하거나 로그인 여부를 확인하는 엔드포인트에 `Authorization: Bearer <세션 토큰>` 헤더로 전달합니다. 세션은 발급 후 30일 동안 유효하며 활동해도 연장되지 않습니다. 로그인 방법은 4절을 참고해 주십시오. |
| 관리자 인증 | `POST /admin/login`으로 발급받은 토큰을 `Authorization: Bearer <token>` 헤더로 전달합니다. `/admin/login`을 제외한 모든 `/admin/*` 요청에 필요하며, 토큰이 없거나 유효하지 않으면 401 Unauthorized(`UNAUTHORIZED`)가 반환됩니다. 관리자 세션은 매장별로 하나만 유효하며, 같은 매장에서 새로 로그인하면 이전 토큰은 무효가 됩니다. 관리자 토큰과 고객 세션 토큰은 서로 다른 토큰이며 같은 `Authorization` 헤더를 사용하지만, `/admin/*` 경로에서만 관리자 토큰으로 해석됩니다. 공개 API에는 관리자 토큰을 보내지 않아도 됩니다. |
| 폴링 | 고객 화면과 관리자 화면 모두 `GET /state`를 **2초 간격**으로 호출합니다. WebSocket은 사용하지 않습니다. |
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
  arousal: number;         // [-1, 1] 이름은 arousal이지만 값은 Energy입니다.
};

// 카탈로그와 검색 결과에서만 사용합니다.
type TrackWithStatus = Track & { requestStatus: RequestStatus };

// 점주가 설정하는 영역입니다. PUT /admin/mood, GET /admin/mood/preview, GET /mood가 같은 형식을 사용합니다.
type RegionRequest =
  | { mode: 'seeds'; spotifyIds: string[]; n: number }   // 기준곡 방식
  | { mode: 'range'; valenceMin: number; valenceMax: number; energyMin: number; energyMax: number; n: number };   // 범위 방식

// PUT /admin/mood는 T가 TrackWithStatus, GET /admin/mood/preview는 T가 Track입니다.
type RegionResult<T> = {
  tracks: T[];
  status: 'complete' | 'insufficient-candidates' | 'empty';
  candidateCount: number;  // 기준곡을 포함한 영역 안의 고유 후보 곡 수
};

type QueueEntry = {
  queueId: string;
  track: Track;
  requestedAt: number;     // epoch ms
  mine: boolean;           // 로그인한 사용자 본인이 신청한 곡이면 true (로그인하지 않았으면 항상 false)
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

하나의 곡에 여러 상태가 동시에 해당될 수 있습니다. 예를 들어 재생 중인 곡은 재생 시작 후 30분 이내이므로 `recently-played`에도 해당되며, 대기 중인 곡은 영역이 변경되어 가드레일 밖이 되면 `out-of-mood`에도 해당됩니다. 이 경우 서버는 아래 우선순위에서 가장 앞선 하나의 상태만 반환합니다.

`now-playing` > `already-queued` > `out-of-mood` > `recently-played` > `available`

### 에러 형식과 코드

모든 에러 응답은 아래 형식을 따릅니다. `retryAfterSec` 항목은 429 Too Many Requests 응답에서만 포함됩니다. `message`는 사람이 읽을 수 있는 한국어 안내 문장이며 표현이 바뀔 수 있으므로, 동작을 분기할 때에는 `code` 값을 사용해 주십시오.

```json
{ "error": { "code": "TRACK_COOLDOWN", "message": "최근에 재생된 곡입니다.", "retryAfterSec": 1200 } }
```

| 상태 | code | 의미 |
|---|---|---|
| 400 Bad Request | `INVALID_INPUT` | 요청 형식이 올바르지 않습니다. |
| 401 Unauthorized | `CUSTOMER_UNAUTHORIZED` | 로그인이 필요하거나 세션이 없거나 만료되었습니다. |
| 401 Unauthorized | `UNAUTHORIZED` | 관리자 토큰이 없거나 유효하지 않습니다. |
| 401 Unauthorized | `INVALID_CREDENTIALS` | 관리자 비밀번호가 올바르지 않습니다. |
| 401 Unauthorized | `INVALID_KAKAO_CODE` | 카카오 인가 코드가 올바르지 않거나, 만료되었거나, 이미 사용되었습니다. |
| 403 Forbidden | `OUT_OF_MOOD` | 현재 가드레일 밖의 곡입니다. |
| 404 Not Found | `STORE_NOT_FOUND` | 등록되지 않은 `storeId`입니다. |
| 404 Not Found | `TRACK_NOT_FOUND` | 데이터셋에 등록되지 않은 곡입니다. |
| 404 Not Found | `QUEUE_ITEM_NOT_FOUND` | 존재하지 않는 `queueId`입니다. |
| 409 Conflict | `TRACK_ALREADY_QUEUED` | 해당 곡이 이미 대기 중이거나 재생 중입니다. |
| 409 Conflict | `MY_REQUEST_PENDING` | 본인이 신청한 곡이 아직 대기열에 있습니다. 해당 곡의 재생이 시작되면 다시 신청할 수 있습니다. |
| 409 Conflict | `NOT_NEXT_IN_QUEUE` | 재생을 보고한 곡이 대기열의 맨 앞 곡이 아닙니다. |
| 409 Conflict | `NO_TRACKS` | 재생할 수 있는 곡이 없습니다. 가드레일에 곡이 하나도 없는 경우입니다. |
| 429 Too Many Requests | `TRACK_COOLDOWN` | 해당 곡이 최근 30분 이내에 재생되었습니다. `retryAfterSec`이 포함됩니다. |
| 502 Bad Gateway | `KAKAO_UNAVAILABLE` | 카카오 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주십시오. |



## 3. 공개 API

공개 API는 관리자 토큰 없이 호출할 수 있으며, 고객 화면과 관리자 화면에서 함께 사용합니다. 엔드포인트별 로그인 요구 사항은 다음과 같습니다.

| 엔드포인트 | 로그인 |
|---|---|
| `GET /`, `GET /mood`, `GET /catalog`, `GET /search` | 필요하지 않습니다. |
| `GET /state`, `GET /me` | 선택입니다. 로그인하면 `mine`과 신청 가능 여부에 사용자 정보가 반영됩니다. |
| `POST /queue` | 필수입니다. 로그인하지 않았으면 401 Unauthorized(`CUSTOMER_UNAUTHORIZED`)가 반환됩니다. |

로그인이 선택인 엔드포인트에서 세션 토큰이 없거나 만료되었거나 유효하지 않으면 오류가 아니라 로그인하지 않은 상태로 처리됩니다. 따라서 폴링(`GET /state`)은 세션이 만료되어도 끊기지 않습니다. 로그인 상태는 `GET /me`로 확인해 주십시오.

### GET /

매장의 식별자와 이름을 반환합니다. 화면에 매장 이름을 표시할 때 사용하며, 로그인은 필요하지 않습니다.

응답 `200 OK`:
```json
{ "storeId": "k3m9x2pq", "name": "제주대학교 공과대학4호관 414호" }
```

### GET /mood

현재 활성인 영역 설정(`RegionRequest`)을 반환합니다. 점주가 `PUT /admin/mood`로 설정하기 전에는 설정이 없으므로 본문이 `null`입니다. 기준곡(`spotifyIds`)은 중복이 제거된 상태입니다.

응답 `200 OK` (설정 전):
```json
null
```

응답 `200 OK` (기준곡 방식):
```json
{ "mode": "seeds", "spotifyIds": ["0aB1cD2eF3gH4iJ5kL6mN7", "1aB1cD2eF3gH4iJ5kL6mN7", "2aB1cD2eF3gH4iJ5kL6mN7"], "n": 30 }
```

응답 `200 OK` (범위 방식):
```json
{ "mode": "range", "valenceMin": -0.5, "valenceMax": 0.5, "energyMin": -0.2, "energyMax": 0.8, "n": 30 }
```

### GET /catalog

활성 카탈로그를 영역 설정이 만든 순서(무작위)로 반환합니다. 응답은 `TrackWithStatus[]`이며, 모두 가드레일 안의 곡이므로 `out-of-mood` 상태는 포함되지 않습니다. 점주가 영역을 설정하기 전이거나 영역 안에 곡이 없으면 빈 배열(`[]`)입니다.

카탈로그가 바뀌었는지는 `GET /state`의 `catalogHash`로 감지합니다. 화면을 열 때는 **`GET /state`를 먼저 호출해 `catalogHash`를 저장한 뒤** 이 API를 호출하고, 이후 폴링에서 `catalogHash`가 저장한 값과 달라지면 새 값을 저장하고 이 API를 다시 호출해 주십시오. 신청이 실패한 후에도 다시 호출해 주십시오.

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

### GET /state

현재 재생 중인 곡과 대기열을 반환합니다. 이 API는 **폴링 대상**이며, 항상 현재 상태 전체를 반환합니다. 쿼리 파라미터는 없으며, 클라이언트는 응답받은 값으로 화면을 통째로 교체하면 됩니다.

- `catalogHash`는 현재 카탈로그의 곡 목록(순서 포함)에서 서버가 계산한 8자리 16진수 문자열입니다. 값의 의미는 해석하지 말고 **저장한 값과 같은지 다른지만** 비교해 주십시오. 곡 목록이 같으면 같은 값이므로, 점주가 같은 곡 목록을 다시 저장하거나 서버를 재시작해도 값은 바뀌지 않습니다. 곡의 `requestStatus`가 바뀌는 것은 `catalogHash`에 반영되지 않습니다.
- 재생 중인 곡이 없으면 `nowPlaying`은 `null`입니다.
- `queue`는 재생 순서대로 정렬되어 있습니다. `mine`은 로그인한 사용자가 신청한 곡이면 `true`이고, 로그인하지 않았으면 모든 항목이 `false`입니다.
- 재생 진행률은 `serverTime`과 `startedAt`을 이용해 계산합니다. 단, 관리자 화면에서는 SDK가 제공하는 재생 위치를 사용합니다.

요청 헤더(선택): `Authorization: Bearer <세션 토큰>`

응답 `200 OK`:
```json
{
  "serverTime": 1761650000000,
  "catalogHash": "9f3a1c7e",
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
{ "serverTime": 1761650000000, "catalogHash": "9f3a1c7e", "nowPlaying": null, "queue": [] }
```

### POST /queue

곡을 신청합니다. 로그인이 필요하므로 `Authorization: Bearer <세션 토큰>` 헤더를 보내야 합니다. 로그인하지 않았거나 세션이 만료되었으면 401 Unauthorized(`CUSTOMER_UNAUTHORIZED`)가 반환되며, 이 응답을 받으면 저장한 토큰을 지우고 로그인 화면으로 이동시켜 주십시오. 접수된 신청은 신청 이력(`GET /api/me/requests`)에도 기록됩니다.

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
| 1 | 401 Unauthorized | `CUSTOMER_UNAUTHORIZED` |
| 2 | 400 Bad Request | `INVALID_INPUT` |
| 3 | 404 Not Found | `TRACK_NOT_FOUND` |
| 4 | 403 Forbidden | `OUT_OF_MOOD` |
| 5 | 409 Conflict | `TRACK_ALREADY_QUEUED` |
| 6 | 429 Too Many Requests | `TRACK_COOLDOWN` |
| 7 | 409 Conflict | `MY_REQUEST_PENDING` |

에러 응답 예시는 다음과 같습니다. 나머지 코드는 2절의 형식과 표를 따릅니다.
```jsonc
// 401 Unauthorized (CUSTOMER_UNAUTHORIZED): 저장한 토큰을 지우고 로그인 화면으로 이동합니다.
{ "error": { "code": "CUSTOMER_UNAUTHORIZED", "message": "로그인이 필요합니다." } }

// 403 Forbidden (OUT_OF_MOOD): 카탈로그를 다시 불러오고 안내 문구를 표시합니다.
{ "error": { "code": "OUT_OF_MOOD", "message": "현재 영역의 범위를 벗어난 곡입니다." } }

// 429 Too Many Requests (TRACK_COOLDOWN)
{ "error": { "code": "TRACK_COOLDOWN", "message": "최근에 재생된 곡입니다.", "retryAfterSec": 1200 } }

// 409 Conflict (MY_REQUEST_PENDING)
{ "error": { "code": "MY_REQUEST_PENDING", "message": "이미 대기열에 신청한 곡이 있습니다." } }
```

신청이 성공하면 응답을 화면에 즉시 반영하고(낙관적 업데이트), 이후 폴링 결과로 덮어씁니다.

### GET /me

현재 사용자의 신청 가능 상태를 반환합니다. 신청 버튼의 활성화 여부를 표시하는 데 사용하며, 로그인은 선택입니다. 이 API로 로그인 여부와 신청 가능 여부를 함께 확인할 수 있습니다.

요청 헤더(선택): `Authorization: Bearer <세션 토큰>`

- `reason`은 `null`, `"MY_REQUEST_PENDING"`, `"LOGIN_REQUIRED"` 중 하나입니다.
- `"LOGIN_REQUIRED"`는 로그인하지 않았거나 세션이 만료되어 로그인한 사용자로 확인되지 않는 경우입니다. 이때는 저장한 토큰이 있다면 지우고 로그인을 안내해 주십시오.
- `"MY_REQUEST_PENDING"`은 로그인한 사용자가 이 매장에 신청한 곡이 대기열에 있는 경우입니다. 재생 중인 곡은 대기 중으로 간주하지 않습니다.

응답 `200 OK` (신청 가능):
```json
{ "canRequest": true, "reason": null }
```

응답 `200 OK` (본인의 곡이 대기 중):
```json
{ "canRequest": false, "reason": "MY_REQUEST_PENDING" }
```

응답 `200 OK` (로그인하지 않음):
```json
{ "canRequest": false, "reason": "LOGIN_REQUIRED" }
```



## 4. 계정 API

고객은 카카오 계정으로 로그인합니다. 이 절의 경로는 매장과 무관하므로 Base URL이 `https://capstone2-backend-production.up.railway.app/api`입니다.

### 로그인 흐름

1. Frontend가 Kakao JavaScript SDK(`Kakao.init`에는 JavaScript 키를 사용합니다)의 `Kakao.Auth.authorize({ redirectUri, state })`를 호출합니다. `state`는 Frontend가 무작위 문자열을 만들어 브라우저에 저장해 둔 값입니다.
2. 사용자가 카카오에서 로그인하고 동의하면, 카카오가 `redirectUri`로 이동하면서 `?code=...&state=...`를 붙입니다.
3. 콜백 페이지에서 돌아온 `state`가 저장해 둔 값과 같은지 확인하고, 다르면 중단합니다. 서버는 `state`를 검증하지 않으므로 이 확인은 Frontend의 책임입니다.
4. `code`를 `POST /api/auth/kakao/login`으로 보냅니다.
5. 응답의 `token`을 저장하고, 이후 요청마다 `Authorization: Bearer <token>`으로 보냅니다.
6. 주소창에 남은 `code`를 지우도록 화면을 이동(`history.replace` 등)합니다.

유의 사항은 다음과 같습니다.
- `redirectUri`는 서버가 카카오에 보내는 값(서버 환경변수 `KAKAO_REDIRECT_URI`)과 글자 하나까지 같아야 하고, 카카오 개발자 콘솔에도 등록되어 있어야 합니다. 일치하지 않으면 로그인이 401 Unauthorized(`INVALID_KAKAO_CODE`)로 실패합니다. 개발 환경과 배포 환경은 주소가 다르므로 각각 등록하고, 백엔드와 값을 맞춰 주십시오.
- `code`는 한 번만 사용할 수 있고 수명이 짧습니다. 새로고침 등으로 같은 `code`를 다시 보내지 않도록, 처리한 직후 주소에서 지워 주십시오.
- 서버는 카카오 액세스 토큰을 보관하지 않습니다. 로그인 유지는 서버가 발급한 세션 토큰으로만 이루어지며, 세션 토큰은 발급 후 30일 동안 유효합니다.
- 닉네임은 카카오의 필수 동의 항목에서 받아 오며, 로그인할 때마다 카카오의 최신 값으로 갱신됩니다.

### POST /api/auth/kakao/login

세션 토큰 없이 호출합니다. 처음 로그인하는 카카오 계정이면 사용자가 자동으로 만들어집니다.

요청:
```json
{ "code": "카카오가 콜백 주소에 붙여 준 인가 코드" }
```

응답 `200 OK`:
```json
{ "token": "k3Jx9mQ2vL7nR1sT5uY8wZ0aB4cD6eF3gH9iJ2kL5mN", "expiresAt": 1764242000000, "user": { "nickname": "홍길동" } }
```

- `token`은 세션 토큰입니다. 값의 의미는 해석하지 말고 그대로 저장해서 `Authorization` 헤더로 보내 주십시오.
- `expiresAt`은 세션이 만료되는 시각(epoch 밀리초)입니다.
- 같은 사용자가 여러 기기에서 로그인해도 각 기기의 세션은 독립적으로 유지됩니다. 새로 로그인해도 이전 토큰은 무효가 되지 않습니다.
- `code`가 없거나 비어 있으면 400 Bad Request(`INVALID_INPUT`), 카카오가 코드를 거절하면 401 Unauthorized(`INVALID_KAKAO_CODE`), 카카오 서버와 통신하지 못하면 502 Bad Gateway(`KAKAO_UNAVAILABLE`)가 반환됩니다. 502는 같은 `code`로 재시도하지 말고 처음부터 로그인을 다시 시도해 주십시오.

```jsonc
// 401 Unauthorized (INVALID_KAKAO_CODE)
{ "error": { "code": "INVALID_KAKAO_CODE", "message": "카카오 인가 코드가 올바르지 않거나 만료되었습니다." } }
```

### POST /api/auth/logout

현재 세션을 삭제합니다. 요청 본문과 응답 본문은 없습니다.

요청 헤더: `Authorization: Bearer <세션 토큰>`

- 성공하면 `204 No Content`가 반환됩니다. 이후 그 토큰으로는 요청할 수 없으므로 저장한 토큰을 지우고 로그인하지 않은 화면으로 이동해 주십시오.
- 토큰이 없거나 이미 만료되었거나 유효하지 않으면 401 Unauthorized(`CUSTOMER_UNAUTHORIZED`)가 반환됩니다. 이 경우에도 로그아웃된 것으로 보고 같은 방식으로 처리하면 됩니다.
- 서버의 세션만 삭제하며, 브라우저의 카카오 계정 로그인 상태에는 영향을 주지 않습니다. 따라서 다시 로그인할 때 카카오의 계정 입력 단계가 생략될 수 있습니다.

### GET /api/me/requests

로그인한 사용자가 **모든 매장에서** 신청한 곡의 이력을 최신순으로 반환합니다. 로그인이 필수이며, 로그인하지 않았으면 401 Unauthorized(`CUSTOMER_UNAUTHORIZED`)가 반환됩니다.

요청 헤더: `Authorization: Bearer <세션 토큰>`

| 쿼리 파라미터 | 규칙 |
|---|---|
| `limit` | 선택이며 기본값은 20, 최대 50입니다. |
| `offset` | 선택이며 기본값은 0입니다. |
| `storeId` | 선택입니다. 지정하면 그 매장의 신청만 반환합니다. |

```ts
type TrackRequestEntry = {
  requestId: string;       // 신청 한 건의 식별자입니다. 목록의 key로 사용할 수 있습니다.
  storeId: string;
  storeName: string;
  track: Track;
  requestedAt: number;     // epoch ms
};
```

- 이력에는 **접수된 신청만** 기록됩니다. 쿨타임이나 가드레일 등으로 거절된 신청은 남지 않습니다.
- 재생되었는지 여부는 이력에 포함되지 않습니다.
- `total`은 조건(`storeId`)에 맞는 전체 건수이며, `requests`는 현재 페이지의 결과입니다. `offset`이 `total` 이상이면 에러가 아니라 빈 `requests`를 반환합니다.
- `limit`이 허용 범위를 벗어나거나 `offset`이 음수이거나 `storeId`의 형식이 올바르지 않으면 400 Bad Request(`INVALID_INPUT`)가 반환됩니다.
- 이력은 서버를 재시작해도 유지됩니다.

요청: `GET /api/me/requests?limit=20&offset=0`

응답 `200 OK`:
```json
{
  "total": 2,
  "requests": [
    {
      "requestId": "5f0e7c1a-3b2d-4e8f-9a6b-1c2d3e4f5a6b",
      "storeId": "k3m9x2pq",
      "storeName": "제주대학교 공과대학4호관 414호",
      "track": {
        "spotifyId": "0aB1cD2eF3gH4iJ5kL6mN7",
        "title": "Don't Know Why",
        "artist": "Norah Jones",
        "duration": 186000,
        "albumImageUrl": "https://example.com/mock/cover1.jpg",
        "valence": 0.18,
        "arousal": -0.22
      },
      "requestedAt": 1761650010000
    },
    {
      "requestId": "9d4a2b6c-7e1f-4c3a-8b5d-0f1e2d3c4b5a",
      "storeId": "k3m9x2pq",
      "storeName": "제주대학교 공과대학4호관 414호",
      "track": {
        "spotifyId": "7xK2pQ9rT4vW1yZ6bC8dE3",
        "title": "Yellow (Acoustic)",
        "artist": "Coldplay",
        "duration": 269000,
        "albumImageUrl": "https://example.com/mock/cover2.jpg",
        "valence": 0.05,
        "arousal": -0.05
      },
      "requestedAt": 1761640000000
    }
  ]
}
```



## 5. 관리자 전용 API

`/admin/login`을 제외한 모든 요청에는 관리자 토큰을 `Authorization: Bearer <token>` 헤더로 보내야 합니다. 관리자 화면에서 대기열과 설정을 표시할 때에는 공개 API의 `GET /state`, `GET /mood`, `GET /catalog`를 그대로 사용하며, 이때는 관리자 토큰을 보내지 않아도 됩니다.

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

점주가 카탈로그의 **영역**을 설정합니다. 서버가 요청한 영역 안에서 곡을 무작위로 뽑아 새 카탈로그를 만들고, 그 결과를 응답합니다. 입력 방식은 두 가지이며 `mode`로 구분합니다. 모든 좌표는 [-1, 1] 범위이고, 곡의 `arousal` 값은 Energy입니다.

#### mode: seeds (기준곡 방식)

요청:
```json
{ "mode": "seeds", "spotifyIds": ["0aB1cD2eF3gH4iJ5kL6mN7", "1aB1cD2eF3gH4iJ5kL6mN7", "2aB1cD2eF3gH4iJ5kL6mN7"], "n": 30 }
```

- `spotifyIds`는 22자리 영숫자 Spotify ID의 배열입니다. 중복을 제거한 뒤 서로 다른 기준곡이 **최소 3곡, 최대 `n`곡**이어야 합니다.
- 데이터셋에 없거나 감정 좌표가 유효하지 않은 기준곡이 하나라도 있으면 400 Bad Request(`INVALID_INPUT`)입니다.
- 영역은 기준곡 좌표의 볼록 껍질(Convex Hull)에 반지름 0.1의 원형 버퍼를 적용한 모양입니다. 기준곡이 일직선이면 캡슐 모양, 모두 같은 좌표이면 원이 됩니다.

#### mode: range (범위 방식)

요청:
```json
{ "mode": "range", "valenceMin": -0.5, "valenceMax": 0.5, "energyMin": -0.2, "energyMax": 0.8, "n": 30 }
```

- `valenceMin`, `valenceMax`, `energyMin`, `energyMax`는 모두 [-1, 1] 범위의 유한한 숫자여야 합니다. 최솟값과 최댓값이 같아도 되지만, 최솟값이 최댓값보다 크면 안 됩니다. 문자열로 쓴 숫자는 허용되지 않습니다.
- 영역은 버퍼가 없는 사각형입니다.

#### 공통 규칙

- `n`은 필수이며 1~100 범위의 정수입니다. 영역 안에서 뽑을 곡 수입니다.
- 알 수 없는 필드와 `mode`가 없거나 알 수 없는 값이면 400 Bad Request(`INVALID_INPUT`)입니다.
- 영역의 경계는 포함합니다. 부동소수점 오차는 `1e-12`까지 허용하며, [-1, 1] 공간 밖에 좌표가 있는 곡은 제외합니다.
- 곡은 다음과 같이 뽑습니다. `seeds` 방식은 기준곡을 반드시 포함하고, 나머지를 영역 안의 후보에서 균등하게 무작위로, 중복 없이 뽑습니다. `range` 방식은 영역 안의 후보 전체에서 뽑습니다. 결과의 순서도 무작위로 섞습니다.
- 영역 밖의 곡으로 부족한 수를 채우지 않습니다. 후보가 `n`곡보다 적으면 있는 만큼만 반환합니다.
- 같은 요청을 다시 보내면 다른 곡이 뽑힐 수 있습니다. 무작위 시드나 결과를 확정하는 토큰은 제공하지 않습니다.
- 요청이 올바르지 않으면 400이 반환되고 기존 카탈로그와 설정은 그대로 유지됩니다.
- 성공하면 카탈로그가 새 곡들로 교체되고 `catalogHash`가 바뀝니다. 이미 대기열에 들어간 곡, 재생 중인 곡, 곡 쿨타임은 유지됩니다. 대기열의 곡은 새 영역 밖이어도 순서대로 재생됩니다.

응답 `200 OK` (`RegionResult<TrackWithStatus>`):

| 필드 | 설명 |
|---|---|
| `tracks` | 새 카탈로그입니다. 형식은 `GET /catalog`와 같습니다(`TrackWithStatus[]`). |
| `status` | `complete`는 `n`곡을 모두 채운 경우, `insufficient-candidates`는 후보가 `n`곡보다 적어 일부만 채운 경우, `empty`는 후보가 없어 0곡인 경우입니다. |
| `candidateCount` | 기준곡을 포함한 영역 안의 고유 후보 곡 수입니다. |

`status`가 `empty`이면 카탈로그가 비어 있어 고객이 곡을 신청할 수 없고 `GET /admin/fallback-track`은 409 Conflict(`NO_TRACKS`)를 반환합니다. 관리자 화면에서 영역을 다시 설정하도록 안내해 주십시오.

```json
{
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
    }
  ],
  "status": "insufficient-candidates",
  "candidateCount": 1
}
```

후보가 없는 경우의 응답은 다음과 같습니다.
```json
{ "tracks": [], "status": "empty", "candidateCount": 0 }
```

### GET /admin/mood/preview

영역을 설정하기 전에 결과를 미리 봅니다. 점주가 영역을 조정하면서 어떤 곡들이 뽑히는지 살펴보는 용도입니다. **현재 설정, 카탈로그, 대기열을 변경하지 않습니다.** 확정은 `PUT /admin/mood`로 합니다.

`PUT /admin/mood`와 같은 `mode`와 필드, 같은 규칙을 쿼리 파라미터로 받습니다.

- 숫자는 쿼리 문자열로 보냅니다.
- 기준곡은 `spotifyIds=ID1&spotifyIds=ID2&spotifyIds=ID3`처럼 파라미터를 반복해서 보냅니다. 쉼표로 구분하는 방식은 지원하지 않습니다. 반복할 수 있는 파라미터는 `spotifyIds`뿐이며, 다른 파라미터를 반복하면 400 Bad Request(`INVALID_INPUT`)입니다.
- 알 수 없는 파라미터, `mode`가 없거나 알 수 없는 값, 규칙에 맞지 않는 값은 400 Bad Request(`INVALID_INPUT`)입니다.

응답 `200 OK` (`RegionResult<Track>`): `tracks`가 `Track[]`이며 미리보기에는 곡의 신청 상태가 필요하지 않아 `requestStatus`가 포함되지 않습니다. 나머지 필드는 `PUT /admin/mood`의 응답과 같습니다. 무작위로 뽑으므로 이후 `PUT /admin/mood`의 결과와 같다는 보장은 없습니다.

- 각 곡에 `valence`와 `arousal`이 포함되어 있으므로 결과를 사분면 위에 점으로 표시할 수 있습니다.
- 클릭이나 드래그마다 호출하지 말고 150~300ms 디바운스를 적용해 주십시오. 새 요청을 보낼 때에는 이전 요청을 취소하는 것을 권장합니다.

요청: `GET /admin/mood/preview?mode=range&valenceMin=-0.5&valenceMax=0.5&energyMin=-0.2&energyMax=0.8&n=30`

요청(기준곡 방식): `GET /admin/mood/preview?mode=seeds&n=30&spotifyIds=0aB1cD2eF3gH4iJ5kL6mN7&spotifyIds=1aB1cD2eF3gH4iJ5kL6mN7&spotifyIds=2aB1cD2eF3gH4iJ5kL6mN7`

응답 `200 OK`:
```json
{
  "tracks": [
    {
      "spotifyId": "0aB1cD2eF3gH4iJ5kL6mN7",
      "title": "Don't Know Why",
      "artist": "Norah Jones",
      "duration": 186000,
      "albumImageUrl": "https://example.com/mock/cover1.jpg",
      "valence": 0.18,
      "arousal": -0.22
    }
  ],
  "status": "insufficient-candidates",
  "candidateCount": 1
}
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
| 대기열이 비어 있지 않고, 맨 앞이 아닌 곡 | 409 Conflict(`NOT_NEXT_IN_QUEUE`)가 반환됩니다. `GET /state`를 다시 호출한 뒤 맨 앞의 곡으로 재시도해 주십시오. |
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

Spotify 로그인(OAuth PKCE)과 토큰 관리는 Frontend에서 직접 처리하며, 백엔드는 Spotify 사용자 토큰을 다루지 않습니다. Web Playback SDK를 사용하려면 Spotify Premium 계정이 필요합니다. 이 로그인은 점주의 재생용이며, 고객의 서비스 로그인(카카오, 4절)과는 별개입니다.

### 관리자 재접속 절차

관리자 클라이언트가 예기치 않게 종료되었다가 다시 접속하는 경우의 절차입니다. 고객이 신청한 곡이 중간에 끊긴 것으로 간주하여, 해당 곡을 **처음부터 다시 재생**합니다.

1. 관리자 화면을 열고 Spotify Web Playback SDK를 초기화한 뒤, `GET /state`로 서버의 현재 상태를 읽습니다. 관리자 토큰이 무효하면 먼저 로그인합니다.
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



## 6. 동작 규칙 요약

- **재생 주도권:** 다음에 재생할 곡은 관리자 클라이언트가 결정하고 `PUT /admin/now-playing`으로 서버에 보고합니다. 서버는 보고된 곡을 검증하고 기록합니다.
- **곡 쿨타임:** 곡이 대기 중이거나 재생 중이거나, 재생이 시작된 지 30분 이내이면 신청할 수 없습니다. 재생 시작 시각은 `PUT /admin/now-playing`으로 재생이 보고된 시점입니다. 30분 값은 서버 환경변수로 조정할 수 있습니다.
- **사용자당 대기 곡 수:** 로그인한 사용자는 매장마다 대기열에 곡을 하나만 둘 수 있습니다(`MY_REQUEST_PENDING`). 곡의 재생이 시작되어 대기열에서 빠지면 곧바로 다음 곡을 신청할 수 있습니다. 재생 중인 곡은 "대기 중"으로 간주하지 않으므로, 내 곡이 재생되는 동안에도 다음 곡을 신청할 수 있습니다.
- **영역 변경:** 이미 대기열에 들어간 곡은 영역이 변경되어 새 가드레일 밖이 되어도 유지되며, 순서대로 재생됩니다. 이에 따라 대기열의 맨 앞 곡은 가드레일 밖이어도 `PUT /admin/now-playing`으로 보고할 수 있습니다.
- **관리자 세션:** 한 매장에서 한 번에 하나의 관리자 세션만 유효합니다. 같은 매장에서 새로 로그인하면 이전 세션의 토큰은 무효가 됩니다.
- **관리자 탭 종료:** 관리자 탭이 닫히면 재생이 중단되고 재생 보고(`PUT /admin/now-playing`)도 이루어지지 않습니다. 이 경우 고객 화면에는 마지막 `nowPlaying`이 그대로 표시되며, 관리자가 재접속하면 "관리자 재접속 절차"에 따라 복구합니다.
- **일시정지 미지원:** 서버가 재생 위치를 추적하지 않으므로 MVP에서는 일시정지를 지원하지 않습니다. 관리자 화면에서 일시정지 기능을 제공하지 않는 것을 권장하며, 건너뛰기는 다음에 재생할 곡을 `PUT /admin/now-playing`으로 보고하는 방식으로 처리합니다.
- **초기 카탈로그:** 서버를 시작한 직후에는 영역이 설정되어 있지 않아 카탈로그가 비어 있습니다(`GET /mood`는 `null`, `GET /catalog`는 `[]`). 해당 매장의 점주가 `PUT /admin/mood`로 영역을 설정해야 고객이 곡을 신청할 수 있습니다.
- **고객 세션:** 로그인하면 30일 동안 유효한 세션이 발급되며, 활동해도 연장되지 않습니다. 같은 사용자가 여러 기기에서 동시에 로그인할 수 있습니다.
- **데이터 보관:** 대기열, 곡 재생 기록(곡 쿨타임), 영역 설정(카탈로그), 관리자 토큰은 메모리에만 있어 서버를 재시작하면 초기화됩니다. 사용자 정보, 고객 세션, 신청 이력은 DB에 저장되어 재시작 후에도 유지됩니다.

## 7. 미정 사항 및 변경 가능성

| 항목 | 상태 |
|---|---|
| 곡 메타데이터(제목, 아티스트, 이미지) | 코어 담당 팀원이 데이터를 다시 제공할 예정입니다. 필드 구조는 변경되지 않습니다. |
| 추천 방식 | 영역 안에서 무작위로 뽑는 방식이며, 곡 좌표는 ReccoBeats의 Valence/Energy를 사용합니다. 세부 구현이 바뀌어도 API 구조는 동일합니다. |
| 곡 쿨타임 30분 | 서버 환경변수입니다. 값이 변경되어도 API 구조는 동일합니다. |
| 카카오 `redirectUri` | 개발 환경과 배포 환경의 값을 Frontend와 Backend가 합의해 서버 환경변수와 카카오 콘솔에 일치시켜야 합니다. |
| 에러 code 이름 | 초안 상태이며, 합의 후 확정합니다. |
| 예시의 곡 정보 | 모두 임의로 작성한 값(mock)입니다. |

### Frontend 연동 시 확인할 사항

- 영역 입력 화면(기준곡 방식과 범위 방식), 결과의 `status`별 안내(`complete`, `insufficient-candidates`, `empty`) 표시
- 카탈로그 변경을 `GET /state`의 `catalogHash`로 감지하는 폴링 처리
- 로그인 흐름(`state` 검증, `code` 전달, 토큰 저장)과 `401 CUSTOMER_UNAUTHORIZED` 수신 시 로그인 화면 이동

### 알려진 한계

- **세션 토큰 보관:** 세션 토큰은 브라우저에 저장되므로 탈취되면 만료되기 전까지 다른 곳에서 사용될 수 있습니다. 모든 기기에서 한 번에 로그아웃하는 기능은 제공하지 않습니다.
- **신청 이력 저장:** 신청 이력은 부가 정보로, 서버의 일시적인 DB 오류 시 저장에 실패할 수 있습니다. 이 경우에도 신청 자체는 성공하며 해당 건만 이력에서 빠집니다.
