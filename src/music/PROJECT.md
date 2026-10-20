# 음악 DB·추천 담당 영역

디지털 주크박스의 음악 데이터와 TypeScript 감정 좌표 추천을 담당한다.
이 문서 모음은 팀 전체의 개발 규칙이나 기존 API 계약을 대체하지 않는다.

## 범위
- PostgreSQL `music` 스키마와 `songs`, `song_sources`, `emotion_scores`.
- Spotify ID 기반 매칭, 원본 보존, 감정 좌표의 -1~1 정규화.
- ReccoBeats와 MuSe를 조합한 VIEW A/B1/B2/C1/C2 및 TypeScript 추천.
- 초기 표본 연구에서 전체 수집·격리 통합·공통곡 비교·선정 편향 분석으로 진행했다. 현재 상태와 공개 가능한 결과는 STATUS 및 reports 인덱스를 따른다.
- 수집·저장·이용 권한 검증을 실제 수집의 선행 조건으로 둔다.

## 기존 환경과 경계
- Express 5, TypeScript strict, ESM/NodeNext, pnpm 기반 기존 백엔드다.
- `src/index.ts`: 서버 진입점. `src/routes/storeRouter.ts`: 매장별 예시 곡 응답.
- `src/models/track.ts`: 기존 응답 타입. 현재 예시는 0~1 좌표이며 타입 자체에는 범위·duration 단위 제약이 없다. DB/추천의 -1~1 좌표 및 필수 reccobeatsId 차이는 SPEC 6.1~6.3의 권장안으로 정리했고 팀 계약은 미확정이다. 기존 타입은 변경하지 않는다.
- 테이블 3개·VIEW 5종 SQL, 파일 영속 적재/replay, 수집/검증기, 추천/DB/API 준비 모듈과 격리 실험을 구현했다. 실제 서비스 verified 전환과 팀 라우터/공유 서버 적용은 별도다. 공개 조건이 미확정인 ReccoBeats 실측·개별 곡 자료는 로컬에 보존하며 공유 문서에는 포함하지 않는다.
- 인증, 매장·대기열, 재생, 프런트엔드, 배포 및 공통 설정 변경은 현재 범위 밖이다.
- 담당 루트는 `src/music/`다. 향후 Python 수집 코드는 `collectors/`, SQL은 `db/`, TypeScript 추천은 `algorithm/`에서 관리한다. 공통 API·의존성 변경은 팀 통합 사항으로 별도 확정한다.
- 문서 5개는 담당 루트 직속에 둔다. MuSe 원본·출처·분석 결과 및 기존 로컬 검증 스크립트는 `src/music/.local/music-muse/`에 보존한다.
- 경로는 별도 표시가 없으면 저장소 루트 기준이다. 대용량 데이터·비밀정보는 루트 `.gitignore`에서 제외한다.

## 문서 운영

- 공개 가능한 결과·이미지·집계는 [reports/README.md](reports/README.md), 설치/컴파일/테스트와 비공개 입력 의존성은 [REPRODUCING.md](reports/REPRODUCING.md)를 따른다.
- 워크프로세스 v1.2를 담당 영역에 한정 적용한다. 원본은 수정·삭제하지 않는다.
- 새 세션: PROJECT → PLAN → STATUS → AGENTS → 필요한 SPEC/코드 순으로 확인한다.
- 상세 데이터 설계의 기준은 [SPEC.md](SPEC.md), 진행 현황은 [STATUS.md](STATUS.md)다.
- 현재 문서는 로컬 초안이며 commit/push 및 팀 합의가 완료된 상태가 아니다.
