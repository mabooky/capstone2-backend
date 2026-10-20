# 팀원용 설치·컴파일·검증 안내

이 문서는 **앞으로 사용할 명령**을 설명한다. 공유본을 만드는 이번 작업에서는 설치·빌드·테스트·수집·DB 실행을 하지 않았다. 저장소 루트에서 실행하며 공용 package/잠금 파일과 기존 로컬 데이터를 덮어쓰지 않는다.

## 코드만으로 가능한 범위

Node/npm과 저장소 `package.json`에 지정된 pnpm 12.9.1 환경이 필요하다. 팀 공용 의존성 설치와 앱 빌드는 별도 단계다.

```powershell
# 팀 공용 개발 환경이 준비된 뒤 실행. 이번 작업에서 실행하지 않음.
pnpm install --frozen-lockfile
pnpm build
```

루트 package에는 PGlite가 없다. 기존 음악 검증 도구는 ignored `.local`의 TypeScript 7.0.2와 PGlite 0.5.10을 직접 참조한다. 아래는 새 clone 또는 해당 로컬 검증 폴더가 없는 환경의 준비 예시다. 기존 package 설정을 덮어쓰지 않는다. 설치 명령은 패키지 레지스트리에 접근하며 모델/API 수집 명령은 아니다.

```powershell
node -e "const fs=require('node:fs');for(const d of ['src/music/.local/algorithm-validation','src/music/.local/sql-validation']){fs.mkdirSync(d,{recursive:true});const p=d+'/package.json';if(!fs.existsSync(p))fs.writeFileSync(p,JSON.stringify({private:true,type:'module'},null,2)+'\n');}"
npm install --prefix src/music/.local/algorithm-validation --save-exact --ignore-scripts --no-package-lock --no-audit --no-fund typescript@7.0.2
npm install --prefix src/music/.local/sql-validation --save-exact --ignore-scripts --no-package-lock --no-audit --no-fund @electric-sql/pglite@0.5.10
```

기존 로컬 package가 이미 있다면 그 버전·type 설정을 먼저 확인한다. 이 준비 폴더를 GitHub에 올리지 않는다.

### 순수 추천 테스트

```powershell
node src/music/.local/algorithm-validation/node_modules/typescript/bin/tsc -p src/music/algorithm/tsconfig.check.json
node --test src/music/algorithm/recommend.test.mjs
```

합성 행을 사용하는 기존 추천 테스트다. 22개 테스트가 코드에 정의되어 있고, 10,000곡 공통 집합·독립 정렬 대조·거리/반경·동률·제외·중복·잘못된 입력을 검사한다. 실제 MuSe CSV/API 인증은 필요하지 않는다. 이번 사본 생성에서 다시 통과했다고 주장하지 않는다.

### 메모리 SQL 검증

```powershell
node src/music/db/validate.mjs
```

새 PGlite 메모리 DB의 합성 fixture로 001~003 SQL과 서비스 VIEW/제약을 검사하는 기존 실행기다. 공유 PostgreSQL이나 실제 source를 승격하는 명령이 아니다.

### 서비스 어댑터의 합성 테스트만 실행

```powershell
node src/music/.local/algorithm-validation/node_modules/typescript/bin/tsc -p src/music/integration/tsconfig.check.json
node --test --test-name-pattern="^(?!actual persistent MuSe database)" src/music/integration/recommendation.test.mjs
```

기존 테스트 파일의 실제 영속 MuSe DB 검사 1개를 이름 패턴으로 제외한다. 나머지는 메모리 fixture와 가짜 쿼리 클라이언트를 사용한다. 전체 테스트 파일을 패턴 없이 실행하면 `muse-persistent/stage4-v1`의 비공개 영속 DB가 필요하다. 테스트 이름/구성이 바뀌면 패턴을 다시 확인한다.

서비스 모듈은 프레임워크 독립 준비 코드다. 실제 Express 추천 endpoint·매장 권한·대기열 이력 연동은 이 문서의 명령으로 구현되지 않는다.

## 비공개 입력이 필요한 범위

| 검사·실험 | 필요한 비공개 자료 |
|---|---|
| MuSe 정제/전체 모집단 감사 | 원본 CSV, 출처/해시 기록, 기존 로컬 분석 파일 |
| 영속 적재·재개·통합 검증 | 정제 JSONL, 해당 DB snapshot·schema manifest·실행 이력 |
| 실험 조회/원본 5모델 비교 | `music-experiment-20261020-v3`의 PASS manifest·snapshot·모델별 JSONL·공통 매핑 |
| 원본 시각화·편향 분석 | MuSe 원본, 수집 체크포인트, B1/B2 JSONL, 기존 비교 결과·보존 SHA |

이 자료는 공유 폴더에 없다. 권한과 데이터 수신 범위가 확인되지 않은 팀원에게 원본을 전달하거나 API로 자동 보충하지 않는다. v1/v2 미채택 DB를 v3 대신 사용하지 않는다. 기존 입력의 정규화 기준·SHA가 달라지면 임의로 맞춰서 재현하지 않는다.

원본 전체 실행에는 네트워크 수집·재적재를 수행할 수 있는 별도 코드도 있으므로 모든 collectors 테스트/수집기를 무조건 실행하지 않는다. 이 문서에는 live API 실행 플래그나 공유 DB 접속 명령을 제공하지 않는다. Windows System.Drawing PNG 생성도 원본 좌표가 필요하며, 공유한 집계 JSON만으로 원본 산점도를 복원하는 절차를 제공하지 않는다.

## 공유 사본의 의미

공유 JSON은 `_share_copy`에 원본 상대경로·원본 SHA·정제 내역을 기록한다. `original_run_result` 및 원본 5모델 실행 카운터는 당시 검증 기록이다. 공유 파일 자체의 검사·해시는 `verification.json`과 `manifest.json`을 확인한다. 원본 데이터가 없는 clone에서 전체 수치 실험을 재실행할 수 있다는 뜻은 아니다.
