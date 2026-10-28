# 축소 음악 추천 실험 데이터셋 v2

27,948곡의 Spotify Track ID와 5개 실험 모델 A/B1/B2/C1/C2를 재구성하는 데이터다.
기존 15필드는 `music-experiment-20261020-v3`의 PGlite VIEW에서 생성한 값이며,
v2에서는 기존 필드와 행 순서를 유지하고 MuSe 출처의 `title`, `artist`를 추가했다.
**검증된 운영 카탈로그가 아니다.** `verified=false`, `canonical_song_ids=false`,
ID namespace는 `music_experiment.common_songs`이며 Spotify에서의 현재 유효성·녹음
동일성·재생 가능성은 이 데이터셋으로 입증되지 않는다.

## 파일과 형식

- `songs.jsonl`: `music-compact-experiment-v2` 형식의 행당 17열 JSON 문자열 배열 1개.
  컬럼 순서는 manifest.columns가 정의하며 `title`, `artist`도 비어 있지 않은 문자열이다.
  모든 ID, 원본 점수와 좌표는 문자열이다. bigint 및 SQL numeric 정밀도를 유지하며
  반올림·소수 변환·좌표 재계산을 하지 않았다.
- `normalization.json`: 기존 정규화 설정의 축별 템플릿 6개, 공통 MuSe source version,
  모델의 축 조합을 보존한다. 곡별 ReccoBeats source version은 songs에 그대로 남긴다.
- `manifest.json`: 행 수, 컬럼, 버전, 바이트 수·SHA-256, 메타데이터 출처·매칭 기록과
  과거 원본 DB 전수 대조 결과.
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
| 15 | title: MuSe의 track |
| 16 | artist: MuSe의 artist |

모든 정규화 좌표는 -1~1이다. A는 9/10, B1은 11/12, B2는 13/14,
C1은 9/12, C2는 9/14를 사용한다. 중복 축만 제거했으며 곡은 삭제·병합하지 않았다.
source ID/version, 원본 점수, 정규화 버전·설정은 `compact_experiment.ts`에서
기존 recommend.ts의 14개 필드로 복원한다. 운영 song ID로 치환하지 않는다.
`title`, `artist`는 추천용 14필드에 포함하지 않으며 좌표·추천 순서는 그대로 유지한다.
`duration_ms`는 아직 수집하지 않았으며 이 데이터셋에 포함하지 않는다.

곡명·아티스트는 MuSe `zenodo-4281165-v1.0.0`의 `muse_dataset.csv`에서 가져왔다.
manifest에는 Spotify ID의 정확한 일치, 원본·정제본 각각 단일 행 매칭 및
ReccoBeats의 MuSe 외부 ID 교차 확인이 기록돼 있다. 이는 Spotify 공식 검증을 뜻하지 않으며
`metadata.spotify_officially_verified=false`다.

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
14필드 복원용 원본·출처 정보 보존 및 MuSe 곡명·아티스트 추가다.
원본 제공자의 추천·승인을 주장하지 않는다.
원본 CSV, DB/WAL, SQLite 체크포인트, 응답 본문, 이미지·인증정보는
포함하지 않는다. `.local/` 원본과 과거 연구 산출물의 기존 보관 규칙은 별도다.

## 실행과 검증

개발용 API는 기본으로 이 데이터셋을 사용한다. 설치·서버 실행·HTTP 요청·테스트 명령은
[음악 모듈 README](../../README.md)를 따른다. `.local/`이나 파일 DB는 필요 없다.
`MUSIC_EXPERIMENT_SOURCE=pglite` 및 `MUSIC_EXPERIMENT_ROOT`는 더 이상 지원하지 않으며
개발 API에서 명시적 503을 반환한다. 다른 데이터셋 위치는 `MUSIC_DATASET_ROOT`로 지정한다.
운영 환경에서는 API가 비활성화된다. 빌드 출력만 배포할 때는 이 데이터 폴더도 함께 제공한다.

데이터셋 재생성 도구와 기존 PGlite 전곡 비교 테스트는
`archive/music-research-20261027` 브랜치의 `src/music/db/export_compact_experiment.mjs` 및
`src/music/integration/compact_experiment.test.mjs`에 원형 보존한다.
해당 브랜치의 과거 실행 명령은 개발 브랜치의 검증 명령이 아니다.
원본·백업 DB를 직접 엔진으로 열지 않으며 재생성은 별도 승인된 격리 사본에서만 검토한다.
현재 개발 브랜치는 공유 데이터셋의 해시·건수·17열·전곡 제목/아티스트·기존 15필드와
행 순서의 해시·추천용 14필드·5모델 고정 추천 순서 회귀를 독립 검증한다.
개발 HTTP 응답은 Spotify ID 목록을 반환하며 제목·아티스트를 반환하지 않는다.

2026-10-28 검증 결과는 compact·알고리즘·개발 HTTP 테스트 40개 통과, 실패 0이다.
`recommendation.test.mjs`와 `db/validate.mjs`의 두 검증 명령은 선언된 개발 의존성
`@electric-sql/pglite`가 현재 설치되지 않아 미실행이며, 전체 SQL 검증 완료를 뜻하지 않는다.
