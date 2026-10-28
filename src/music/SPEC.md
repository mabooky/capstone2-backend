# 음악 추천 계약

개발 실행과 테스트는 [README](README.md), 출처와 공유 이력은 [SOURCES](SOURCES.md)를 따른다.
과거 연구 설계·검증 기록은 `archive/music-research-20261027`의 동일 경로에 원형 보존한다.

## 좌표와 모델

HTTP 좌표계는 `unit-interval-v1`(0~1)이며 내부 좌표는 `2*x-1`(-1~1)이다.
추측·clamp·문자열 숫자 변환은 하지 않는다. 원본 점수 정규화는
`2*(x-raw_min)/(raw_max-raw_min)-1`이다.

| 정규화 버전 | 원본 범위 |
|---|---|
| reccobeats-v1 | Valence/Energy 각각 [0, 1] |
| muse-theoretical-v1 | Valence/Arousal 각각 [0, 9] |
| muse-observed-v1 | Valence [0.23500000000000001, 8.475], Arousal [0.1081132075471698, 7.27] |

MuSe 관측 범위는 원본 90,408행 전체에서 고정했다. 부분집합마다 다시 계산하지 않는다.
정확한 모집단·원본 해시·출처 버전·설정은 [normalization.json](data/experiment-v1/normalization.json),
운영 계산식과 제약은 [002_normalization_v1.sql](db/002_normalization_v1.sql)에 보존한다.
모델 A=ReccoBeats V/E, B1=MuSe 이론 V/A, B2=MuSe 관측 V/A,
C1=ReccoBeats V+MuSe 이론 A, C2=ReccoBeats V+MuSe 관측 A다.

## 공유 데이터셋과 추천

[데이터 형식과 사용 조건](data/experiment-v1/README.md)을 따른다.
`music-compact-experiment-v2`는 27,948곡·17열 문자열 배열이다. 기존 0~14열의
실험 ID·Spotify ID·source ID/version·원본 점수 4개·고유 축 6개와 행 순서를 보존하고,
15열에 `title`, 16열에 `artist`를 추가했다(인덱스는 0부터 시작).
파일 크기·SHA-256·행 수·중복 ID·설정·좌표 범위 및 전 필드의 비어 있지 않은 문자열을
검사한 뒤 추천용 기존 14필드로 복원한다. 제목·아티스트는 추천용 필드에 포함하지 않는다.
numeric/bigint 정밀도를 보존하며 좌표를 다시 계산하지 않는다.

곡명·아티스트 출처는 MuSe `zenodo-4281165-v1.0.0`의 `muse_dataset.csv`이며
`track`을 `title`로, `artist`를 `artist`로 보존한다. 매칭 기록과 출처 해시는 manifest의
metadata에 있다. Spotify 공식 검증은 완료되지 않았으며
`metadata.spotify_officially_verified=false`다. `duration_ms`는 아직 수집하지 않았다.

추천은 `algorithm/recommend.ts`의 가중 거리·반경 확대·상한·제외·중복 충돌 검사와
Spotify ID 동점 순서를 그대로 사용한다. 결과가 부족해도 임의 곡을 채우지 않는다.
실험 envelope는 `verified=false`, `canonical_song_ids=false`,
namespace=`music_experiment.common_songs`다. 실험 ID를 운영 ID로 전달하지 않는다.

## 개발 HTTP

`POST /api/dev/music/recommendations`는 development와 명시 활성화 플래그를 모두 요구한다.
입력 필드는 coordinateSpace, view, valence, arousal, limit만 허용하며 모두 필수다.
view는 A/B1/B2/C1/C2, 좌표는 0~1 유한 숫자, limit는 0~100 정수다.
성공 응답은 coordinateSpace/view/tracks/returnedCount/reason/experimental/verified/
canonicalSongIds/idNamespace/datasetId다. 최상위 spotifyIds 배열은 반환하지 않는다.
tracks의 각 항목은 songId/spotifyId/title/artist/durationMs/valence/arousal/normalization이다.
추천 후 Spotify ID로 MuSe 제목·아티스트를 연결하고 songId 일치를 검사한다.
파일의 중복 식별자와 메타데이터 누락·불일치는 오류로 처리하며 추천 순서를 유지한다.
durationMs는 미수집으로 null이고 출력 좌표는 0~1이다. normalization은 valence/arousal의
정규화 버전이다. reccobeatsId/albumImageUrl/requestStatus는 추천 응답에 포함하지 않는다.
returnedCount는 tracks.length와 같고 최대 100곡이다. limit=0이면 tracks=[]와
reason=zero-limit를 반환하며 다른 종료 사유의 의미는 기존 알고리즘을 따른다.
experimental=true, verified=false, canonicalSongIds=false 및 실험 namespace·datasetId를
유지한다. Spotify ID의 존재가 공식 검증을 뜻하지 않는다.

기본 소스는 공유 dataset 파일이다. 파일형 PGlite는 지원하지 않으며 과거 source와
experimentRoot 설정은 명시적 503으로 처리한다. 자동 fallback은 없다.
비활성·production은 404, 입력 오류는 400, 데이터셋 누락·해시 오류는 503,
추천 입력 데이터 계약 오류는 500이다. 응답에 로컬 경로나 원래 예외를 노출하지 않는다.

## 내부 서비스 호출

`DevExperimentService.recommend(input)`은 같은 5개 입력 필드로
`Promise<ExperimentRecommendationOutput>`을 반환한다. 파일 공급과 실험 경계 검사를 거쳐
공통 `RecommendationService`에서 추천·메타데이터 결합·좌표 변환을 수행한다.
호출 예시와 인스턴스 수명 관리는 [README](README.md#팀원용-내부-호출)를 따른다.
직접 호출은 개발 HTTP 활성화 조건을 검사하지 않으며 권한 확인은 호출 측의 책임이다.

## 운영 전환 경계

`db/001~003`은 music.songs/song_sources/emotion_scores와 서비스 VIEW를 정의한다.
VIEW는 검증·선택된 source만 사용한다. pending 후보는 자동 연결·병합·승격하지 않는다.
`RecommendationRepository`는 주입된 PostgreSQL client와 고정 VIEW allowlist를 사용하고,
`RecommendationService`는 공급된 메타데이터와 외부 0~1 좌표 DTO를 반환하며 파일 공급에도
재사용한다. 실험 상태·namespace·datasetId는 `DevExperimentService`가 응답에 보존한다.
실제 운영 driver·접속·마이그레이션·적재·인증·매장/대기열 연결은 미구현이다.
기존 팀원의 Track 타입·라우터 계약은 임의로 바꾸지 않는다.
현재 매장 `/catalog`, `/tracks`는 고정 예시 곡을 반환하며 추천 결과·카탈로그 저장·
고객 신청·대기열과 연결되지 않았다. 추천 DTO는 기존 Track 타입을 대체하지 않는다.

## 안전한 검증과 연구 보관

개발 브랜치의 테스트는 공유 파일 및 `new PGlite()` 합성 메모리 DB만 사용한다.
비공개 파일 DB·컴파일 산출물·이름 필터에 의존하지 않는다.
수집·정제·파일 DB 실험·데이터셋 재생성·비교 보고서는 보관 브랜치의 collectors/,
reports/, db/와 PROJECT/PLAN/STATUS에 남긴다. 보관된 테스트를 개발 검증 명령에 섞지 않는다.
과거 기록과 manifest 해시는 수정하지 않는다. Spotify API나 재생 검증은 자동 테스트 범위 밖이다.
