# 현재 상태

갱신일: 2026-11-09. [PLAN I4](PLAN.md#통합-기반)의 워크프로세스 적용은 **완료**했다.
루트 4문서는 작성·검토되어 내용과 구조를 사용자에게 승인받았고 GitHub `main`에 반영했다.
기능 구현은 시작하지 않았으며, 다음 단계는 개발 착수 전 주요 정책과 연동 계약 검토다.

## 개발 기준과 보존 상태

- 공식 폴더: `C:\Dev\capstone2-backend`.
- 브랜치: `main`, HEAD `860ada13ef7669eefca67e267e16f3c6824a89e6`.
  루트 4문서를 추가한 커밋 `860ada13`(`docs: initialize capstone workflow v1.3`)의 push는 완료됐고,
  이번 확인에서 로컬 `origin/main`과 실제 원격 `main`도 같은 SHA였다.
  이번 상태 갱신은 `PLAN.md`·`STATUS.md`의 미스테이징·미커밋 변경이며 commit/push는 사용자 담당이다.
  작업 시작 시 미추적 파일 `07_Main_Development_Workflow_v1.3.md`가 있었으며 그대로 보존했다.
- 기존 `feature/music-db`(`24c4142`), `archive/music-research-20261027`(`6eb1f96`),
  stash `891232d23e98d1552829d2ee7eb73bc3706d6e5d`를 보존한다.
- 백업: `C:\Backups\capstone2\20261109-173314`. 이전 1단계에서 세 clone·Git/stash·
  `.local`·연구 DB/자료 복사와 파일 해시·Git bundle 복구 검사를 완료했다고 보고했다.
- `.local`에는 비교 이미지 15개(`comparison_all.png` 포함), 실험표·보고서·MuSe/ReccoBeats
  수집/정제 자료·DB 스냅샷이 있다. 이번에는 `.local`과 이미지 15개의 존재를 확인했으며
  자료 무결성 해시 검사를 다시 수행하지 않았다.
- 사용자가 삭제했다고 보고한 두 폴더는 백업 기록의 원래 경로
  `C:\Dev\capstone2-backend-music-slim-20261028`,
  `C:\Dev\capstone2-backend-music-slim-verify-20261028`에 현재 없음을 확인해 삭제 완료로 기록한다.
  공식 개발 폴더와 기존 백업 내 세 저장소 사본은 존재하며, 이번 작업에서 삭제·이동하지 않았다.
- 문서 작성 당시 v1.3 원문은 루트에 없었고 `C:\Users\MY HOME\Downloads\07_Main_Development_Workflow_v1.3.md`를
  찾아 읽었다. 원문은 수정·복제하지 않았다. 요청에 제시된 두 2026-11-04 선택 참고 문서는
  확인하지 못했으며, 향후 요구사항은 이번 사용자 지시를 근거로 정리했다.

## 이전 문서 작성 단계에서 코드로 확인한 구현

| 영역 | 확인 사실 |
|---|---|
| 곡 라이브러리 | 시작/import 시 PostgreSQL `tracks_v3` 전체 조회. ReccoBeats V/E를 `[-1,1]`로 변환하고 조회·검색·최근접 제공 |
| 매장 서비스 | 단일 기준점, 최근접 카탈로그(기본 100·최대 100), 대기열·신청 제한·쿨타임·재생 보고·자동선곡·매장별 관리자 세션 구현 |
| 공개 API | `/api/stores/:storeId` 아래 GET `/mood`, `/catalog`, `/search`, `/state`, `/me`, POST `/queue`; 별도 GET `/api/health` |
| 관리자 API | POST `/admin/login`, PUT `/admin/mood`, GET `/admin/mood/preview`, GET `/admin/fallback-track`, PUT `/admin/now-playing`, DELETE `/admin/queue/:queueId` |
| 고객 갱신·저장 | `/state`에 `catalogHash`·재생·대기열 제공. 고객 식별은 `X-Client-Id`. Store 상태는 메모리이며 전화번호·영속 고객 이력은 미구현 |
| 기존 음악 모듈 | 5모델 알고리즘·파일 서비스·SQL VIEW/저장소 구현. 현재 매장 카탈로그는 이 실험 서비스를 호출하지 않음 |
| 향후 요구 | 영역 기반 생성·샘플링, 기준곡 입력, 블랙리스트, 전화번호 인증/이력은 현재 서비스에 미구현. 정밀 조정/고객 화면은 새 요구 수준의 완료로 볼 수 없음 |

프론트엔드 소스와 실제 운영 DB는 이전 문서 작성 단계와 이번 상태 갱신에서 조사·실행하지 않았다. UI·실제 재생·운영 데이터의
곡 수/내용·API 통합 상태를 코드 존재만으로 완료 처리하지 않는다.

## 이전 단계 검증 보고 — 이번 실행 결과가 아님

3단계 기록: `C:\Backups\capstone2\stage3-20261109-175748\result.json` 및 재검사 로그.

| 이전 3단계 항목 | 보고된 결과 |
|---|---|
| 실행 도구 | Node.js 24.19.0, pnpm 12.18.0, TypeScript 7.0.2 |
| 의존성 | frozen lockfile·설치 스크립트 차단 방식으로 설치 완료, lockfile 불변 |
| 타입 검사·음악 강화 검사·빌드 | 통과 |
| 알고리즘·추천 서비스 기존 테스트 | 39개 통과·실패 0 |
| 합성 메모리 PGlite SQL 검사 | 67개 통과. 실제 `tracks_v3` DB 연동 검증이 아님 |
| 공유 파일 기반 추천 | A/B1/B2/C1/C2와 기본 반환 계약 통과 |
| 자료 보존 | `.local` 6,878개 파일이 1단계 백업 SHA-256과 일치했다고 보고 |

실제 PostgreSQL·매장/관리자 API·프론트엔드·최종 사용 흐름은 미검증이다.
이전 4단계에서는 문서·코드·Git 기록을 읽고 문서 차이와 변경 범위만 확인했다.
이번 상태 갱신에서는 Git 상태·관련 경로·문서 diff를 확인했으며 빌드·테스트·DB 검증은 실행하지 않았다.

## 중요한 불일치와 판단 대기

- **낡은 음악 문서:** `src/music/README.md`·`SPEC.md`에는 매장 API가 고정 예시 곡이고
  카탈로그/신청/대기열 미구현이라는 설명이 남아 있다. 현재 코드는 위 표와 같다.
  하위 파일은 이번 범위 밖이므로 수정하지 않았다. 실험 모듈의 좌표·출처 계약은 계속 구분해 보존한다.
- **HTTP 테스트 2개:** `compact_experiment.test.mjs`와 `dev_recommendations.test.mjs`는
  `createApp(options)`의 `{app, close}` 및 `/api/dev/music/recommendations`를 기대한다.
  현재 `createApp()`은 Express 앱을 반환하고 해당 개발 라우트를 장착하지 않으며 import 시 DB를 읽는다.
  이전 단계 실행 제외를 유지한다. PLAN P1에서 정비 범위·개발 DB를 승인받아야 한다.
- **제품 방향 전환:** 최근접 카탈로그는 현행 동작이고 영역 내부 무작위 샘플링은 확정된 향후 방향이다.
  이를 문서로 구분했으며 코드·기존 API를 바꾸지 않았다.
- **사용자/팀 결정:** 다각형·경계·좌표 원천·샘플 수·후보 부족, 카탈로그 변경 시 기존 신청,
  블랙리스트/장르 데이터, 전화번호 인증·이력/보존·고객 ID, 담당 범위와 API/DB 계약이 미정이다.
  해당 설계의 구현은 보류한다. 상세 항목은 PROJECT의 미정 설계를 따른다.

## 다음 행동

1. 개발 착수 전 영역·샘플링·카탈로그 갱신·고객 식별/이력의 주요 정책과 API·DB·팀 연동 계약을 검토한다.
2. PLAN P1의 테스트 정합성/개발 DB 검증 기반과 P2의 정책·계약 합의를 검토하되,
   P1과 P2의 실행 순서는 아직 제안이며 최종 확정되지 않았다. 구현·DB 준비는 별도 승인 범위에 따른다.
3. 사용자가 이번 `PLAN.md`·`STATUS.md`의 상태 갱신 diff를 확인한 후 직접 commit/push한다.
   이번 작업에서는 후속 개발을 시작하지 않는다.
