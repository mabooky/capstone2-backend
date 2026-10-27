# 축소 음악 추천 실험 데이터셋 v1

27,948곡의 Spotify Track ID와 5개 실험 모델 A/B1/B2/C1/C2를 재구성하는 데이터다.
`music-experiment-20261020-v3`의 기존 PGlite VIEW에서 읽기 전용으로 생성했다.
**검증된 운영 카탈로그가 아니다.** `verified=false`, `canonical_song_ids=false`,
ID namespace는 `music_experiment.common_songs`이며 Spotify에서의 현재 유효성·녹음
동일성·재생 가능성은 이 데이터셋으로 입증되지 않는다.

## 파일과 형식

- `songs.jsonl`: 행당 JSON 문자열 배열 1개. 컬럼 순서는 manifest.columns가 정의한다.
  모든 ID, 원본 점수와 좌표는 문자열이다. bigint 및 SQL numeric 정밀도를 유지하며
  반올림·소수 변환·좌표 재계산을 하지 않았다.
- `normalization.json`: 기존 정규화 설정의 축별 템플릿 6개, 공통 MuSe source version,
  모델의 축 조합을 보존한다. 곡별 ReccoBeats source version은 songs에 그대로 남긴다.
- `manifest.json`: 행 수, 컬럼, 버전, 바이트 수·SHA-256, 출처, 원본 DB 전수 대조 결과.
- `.gitattributes`: Git 체크아웃 후에도 JSON/JSONL이 LF를 유지하도록 지정한다.

문자열 배열의 순서는 다음과 같다(0부터 시작).

| 인덱스 | 값 |
|---|---|
| 0 | 실험용 song ID |
| 1 | Spotify Track ID |
| 2, 3 | ReccoBeats / MuSe source ID |
| 4 | 해당 곡의 ReccoBeats source version |
| 5, 6 | ReccoBeats 원본 Valence / Energy |
| 7, 8 | MuSe 원본 Valence / Arousal |
| 9, 10 | ReccoBeats 정규화 Valence / Energy |
| 11, 12 | MuSe 이론 정규화 Valence / Arousal |
| 13, 14 | MuSe 관측 정규화 Valence / Arousal |

모든 정규화 좌표는 -1~1이다. A는 9/10, B1은 11/12, B2는 13/14,
C1은 9/12, C2는 9/14를 사용한다. 중복 축만 제거했으며 곡은 삭제·병합하지 않았다.
source ID/version, 원본 점수, 정규화 버전·설정은 `compact_experiment.ts`에서
기존 recommend.ts의 14개 필드로 복원한다. 운영 song ID로 치환하지 않는다.

## 출처와 사용 조건

- MuSe: Christopher Akiki, Manuel Burghardt, **MuSe: The Musical Sentiment Dataset**,
  Zenodo v1.0.0 (2021-03-01), https://zenodo.org/records/4281165,
  CC BY 4.0: https://creativecommons.org/licenses/by/4.0/.
  MuSe를 재사용할 때 저자·원 출처·라이선스와 변경 사실을 표시한다.
- ReccoBeats: https://reccobeats.com,
  약관: https://reccobeats.com/docs/documentation/terms-of-service.
- 공유 권한: 프로젝트 사용자가 2026-10-27 대화에서 음악 데이터 공유 권한 확보를
  확인하고, 이 축소 데이터셋을 GitHub에 포함하도록 명시적으로 지시했다.
  별도 허가 문서·허가자·표준 라이선스명·추가 귀속 문구는 제공되지 않았다.
  이 기록은 사용자 확인의 기록이며 제공자의 허가 원문을 대신하는 증서가 아니다.
  구체적인 허가 문서가 제공되면 이를 연결하고 그 조건을 함께 적용한다.
- 이 데이터셋 전체에 MIT/ISC/CC0 등의 추가 오픈 라이선스를 임의로 부여하지 않았다.
  루트 package.json의 코드 라이선스가 제3자 데이터의 권한을 대체하지 않는다.
  공유 승인 자체가 오디오·이미지·추가 Spotify API 데이터의 사용 권한을 뜻하지 않는다.

변경 사항은 기존 공통곡 선택 유지, 고정 정규화 좌표 재배열, 중복 축 및 반복 설정 제거,
14필드 복원용 원본·출처 정보 보존이다. 원본 제공자의 추천·승인을 주장하지 않는다.
원본 CSV, DB/WAL, SQLite 체크포인트, 응답 본문, 제목·아티스트·이미지·인증정보는
포함하지 않는다. `.local/` 원본과 과거 연구 산출물의 기존 보관 규칙은 별도다.

## 개발용 API 및 검증

기존 개발용 API는 기본으로 이 폴더를 사용한다. 개발 환경과 명시 opt-in은 계속 필요하다.

```powershell
# 새 clone의 저장소 루트에서:
corepack pnpm install --frozen-lockfile
$env:NODE_ENV = 'development'
$env:ENABLE_DEV_MUSIC_RECOMMENDATIONS = 'true'
$env:MUSIC_EXPERIMENT_SOURCE = 'dataset'
corepack pnpm dev
```

기존 PGlite 방식과 비교하려면 MUSIC_EXPERIMENT_SOURCE=pglite를 사용한다.
MUSIC_DATASET_ROOT는 다른 축소 데이터셋 폴더, MUSIC_EXPERIMENT_ROOT는 기존
PGlite 실험 폴더를 지정한다. 오류 시 다른 데이터 소스로 자동 fallback하지 않는다.
HTTP 경로·요청·응답과 운영 환경의 404 동작은 유지한다.
tsc는 데이터 파일을 dist로 복사하지 않는다. 빌드 출력만 별도 위치로 옮길 경우에는
이 데이터 폴더도 함께 제공하고 MUSIC_DATASET_ROOT로 실제 위치를 지정한다.

```powershell
corepack pnpm build
node --import tsx --test src/music/integration/compact_experiment.test.mjs
# 기존 비공개 PGlite 입력이 있는 환경에서만:
$env:RUN_LOCAL_MUSIC_HTTP_TESTS = 'true'
node --import tsx --test --test-concurrency=1 src/music/integration/compact_experiment.test.mjs src/music/integration/dev_recommendations.test.mjs
```

새 clone에서 첫 테스트는 PGlite나 `.local/` 없이 실행할 수 있다. 두 번째는 모든
14필드의 전곡 일치, 5모델의 중앙·비대칭 목표 HTTP 결과 일치, 원본 해시 불변을 검사한다.

재생성 도구는 기존 대상 폴더를 덮어쓰지 않는다. 원본 DB의 임시 사본을 READ ONLY로
조회하며 원본에는 쓰지 않는다. 재생성이 필요하면 별도 새 버전 폴더를 지정한다.

```powershell
node --import tsx src/music/db/export_compact_experiment.mjs src/music/.local/music-experiment-20261020-v3 src/music/data/experiment-v2
```
