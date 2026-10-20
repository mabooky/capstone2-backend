# 공통 좌표 추천

recommend.ts는 DB/API를 호출하지 않는 strict TypeScript 순수 함수다. music.recommend_a/b1/b2/c1/c2의 공통 14개 열을 그대로 받는다. SQL numeric 문자열과 bigint ID를 지원하고 원본 좌표·출처·정규화 설정은 반환 행에 보존한다.

```typescript
import { recommend, compareViews, type RecommendationViewRow } from './recommend.js';

// rows는 해당 SQL VIEW에서 읽은 행이다. 이 모듈은 매칭 검증을 대신하지 않는다.
const rows: RecommendationViewRow[] = [];
const result = recommend(rows, {
  view: 'B1', valence: 0.2, arousal: -0.1, limit: 100,
  excludeSongIds: ['123'],
});
```

거리 제곱은 `valenceWeight*dv² + arousalWeight*da²`이며 기본 가중치는 1/1이다. 둘 다 0인 가중치와 범위 밖/비유한 좌표는 거절한다. `limit`는 0~100 정수이며 기본 100이다. 빈 후보·제외 후 빈 집합·반경 내 부족은 실제 건수만 반환한다.

반경 기본값은 0.1, 확대 배수는 2, 상한은 좌표 전체를 포함하는 `2*sqrt(wv+wa)`다. `initialRadius`, `expansionFactor`, `maxRadius`로 지정할 수 있다. 경계를 포함하며 충분한 곡을 찾거나 상한에 도달하면 종료한다. 반경 0도 처리하고 최대 64단계 안에 상한으로 이동한다. 반환 steps는 각 반경의 누적 후보 수다. 최종 정렬은 거리 제곱 오름차순, 동점은 대소문자를 보존한 Spotify ID의 코드 순서다.

같은 곡의 동일 좌표·출처·원본·설정 행이 입력에 반복되면 표시만 하나로 줄인다. DB 관측을 삭제/병합하지 않는다. 같은 song_id의 좌표/출처 충돌, 같은 Spotify ID의 여러 canonical ID, 잘못된 VIEW 버전/축 소스는 오류로 거절한다. 누락을 0으로 바꾸지 않는다. 입력 배열/행을 변경하지 않는다.

`compareViews({ A, B1, B2, C1, C2 }, targetOptions)`는 제외 조건 적용 후 canonical song_id와 Spotify ID가 일치하는 공통 교집합만 각 방식에 전달한다. VIEW별 coverage와 commonSongIds를 따로 반환하며 한 VIEW가 비어도 다른 데이터로 대체하지 않는다. 서로 다른 정규화/지표의 점수를 섞어 하나의 랭킹으로 만들지 않는다.

현재 구현은 메모리 후보 전체를 검사하고 한 번 정렬한 뒤 반경을 적용한다(O(n log n), 메모리 O(n)). DB 공간 검색·제한적 후보 조회·API/대기열 연결·캐싱은 후속 작업이다. SQL VIEW가 보장하는 verified/선택 조건을 호출자가 유지해야 하며 이 함수에는 verified 전환 기능이 없다. 메타데이터 계약 검사는 실제 곡 매칭의 증거가 아니다.

검증 도구는 공용 package.json/잠금 파일을 바꾸지 않고 .local에 설치한다. 아래 설치는 최초 한 번만 필요하다.

```powershell
New-Item -ItemType Directory -Force src/music/.local/algorithm-validation | Out-Null
Push-Location src/music/.local/algorithm-validation
if (-not (Test-Path package.json)) { '{"private":true,"type":"module"}' | Set-Content -Encoding UTF8 package.json }
npm install --ignore-scripts --no-package-lock --no-audit --no-fund --save-exact typescript@7.0.2
Pop-Location
node src/music/.local/algorithm-validation/node_modules/typescript/bin/tsc -p src/music/algorithm/tsconfig.check.json
node --test src/music/algorithm/recommend.test.mjs
```

검증은 합성 행만 사용한다. 22개 테스트에서 5개 VIEW의 10,000곡 공통 집합을 독립적인 전체 거리 정렬 기준과 대조하며 극단 좌표·빈 집합·반경 경계·중복/충돌·동점·제외·입력 오류도 확인한다. 빌드 산출물과 검증 기록은 .local/algorithm-validation에 보관한다.
