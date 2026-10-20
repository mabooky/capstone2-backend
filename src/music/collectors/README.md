# MuSe 로컬 정제

공유 문서에는 실제 곡 ID·좌표·원본 API 응답과 공개 조건이 미확정인 ReccoBeats 실측 결과를 포함하지 않는다. 아래는 구현/과거 단계의 사용 계약이며 새 API 호출을 허용하는 지시가 아니다. [공유 결과](../reports/README.md)와 [설치·검증 안내](../reports/REPRODUCING.md)를 먼저 확인한다.

Python 표준 라이브러리만 사용한다. MuSe 정제·분석은 오프라인이다. Spotify 표본 검증기는 명시적 실행과 인증 설정이 있을 때만 네트워크를 사용하며 DB·Git 명령은 실행하지 않는다.

저장소 루트에서:

```powershell
python -m unittest discover -s src/music/collectors -p "test_*.py"
python src/music/collectors/clean_muse.py --limit 100
```

기본 입력은 `src/music/.local/music-muse/zenodo-4281165-v1.0.0/muse_dataset.csv`, 출력은 `src/music/.local/muse-cleaned/trial-100-v1/`이다.
기존 출력 디렉터리는 덮어쓰지 않는다. 새 시험은 `--output-dir src/music/.local/muse-cleaned/새이름`을 지정한다.
입력 SHA-256·전체 행 수·지표별 Decimal 최소/최대·기존 analysis/provenance를 검증한다. 다른 데이터 버전은 자동 수용하지 않는다.
관측 정규화 범위는 SQL의 발급된 설정을 읽으며 전체 원본으로 대조한다. 제한된 SQL VALUES 형식만 지원하고 설정 구조가 달라지면 중단한다.

## 출력 계약

- `song_sources.jsonl`: 원본별 pending 소스. 원본 8개 필드의 문자열을 raw_payload에 그대로 보존한다.
- `emotion_scores.jsonl`: 소스당 V/A × 이론/관측 4행. source_key는 provider/external_id/source_version 자연 키이며, insert_values와 계산 검증용 preview를 분리한다.
- `classifications.jsonl`: 전체 원본 기준 unique_unverified/duplicate_spotify_id/missing_spotify_id/invalid_spotify_id 분류. 표본에서 한 번만 나와도 전체에 중복이면 중복으로 분류한다.
- `duplicate_groups.json`: 표본에 포함된 중복 ID와 전체 모집단의 관련 원본 id. 병합·대표 선택·삭제하지 않는다.
- `stats.json`: 선택 원본 id, 전체 모집단·설정/원본 해시, 설정 버전·범위, 분류 건수·검증 결과.

곡명·가수·dominance·원본 Spotify ID도 raw_payload에 남는다. 잘못된 ID는 candidate_spotify_id=NULL로 보류하며 원문은 보존한다.
검증되지 않은 곡을 songs에 넣거나 가짜 PK/FK를 만들지 않는다. 모든 song_id는 NULL, verified_at/evidence는 NULL, 추천 선택은 false다.
나중에 승인된 적재기가 song_sources의 실제 PK를 받은 뒤 source_key로 참조를 해소해야 한다. preview의 normalized_value는 SQL 생성 열이므로 INSERT 대상이 아니다.
숫자는 손실을 막기 위해 JSON 문자열로 출력하며 적재 시 numeric으로 변환해야 한다. 정규화는 Decimal 정밀도 50자리로 계산한다. PostgreSQL numeric 나눗셈과의 마지막 자릿수 차이는 가능하다.

## 100행 시험 선택

재현 가능한 coverage-v1 방식으로 V/A 전체 최솟값·최댓값, 기존 저점수 사례, 첫 중복 그룹, 첫 ID 누락 행을 우선 포함하고 원본 순서로 100행을 채운다.
이는 예외·경계 보존 시험이며 무작위 표본·분포 추정이나 매칭 정확성 검증이 아니다. 1 미만 점수와 누락·중복 행을 필터링하지 않는다.
입력 파일·기존 분석 결과·SQL은 변경하지 않으며 전체 원본 적재는 수행하지 않는다.

## 10,000행 분포 시험

`python src/music/collectors/test_muse_scale.py`는 기존 변환기를 재사용해
`.local/muse-cleaned/trial-10000-v1/`에 정제 결과와 독립 검증·분포 비교를 만든다.
기존 디렉터리가 있으면 덮어쓰지 않는다. 새 시험은 clean_muse.py의
`--limit 10000 --selection sha256-v1 --seed muse-trial-10000-v1 --output-dir ...`를 사용한다.
SHA256(UTF8(seed + NUL + 원본 id)) 순위의 앞 10,000행을 고르며 원본 id로 동점을 해소한다.
선정에는 ID 유무·점수를 사용하지 않고 전체 원본 기준 분류·정규화 범위를 유지한다.
고유 Spotify ID 후보와 실제 verified songs는 구분한다. 단위 테스트는 네트워크·DB 없이 기존 명령으로 수행한다.

## 전체 90,408행

```powershell
python src/music/collectors/test_muse_full.py
```

기존 transform과 고정 정규화 설정을 사용하며 출력은 `.local/muse-cleaned/full-90408-v1/`이다.
새 실행은 `--output-dir`로 새 경로를 지정한다. 정제만 할 때는 clean_muse.py에
`--limit 90408 --selection all-v1 --output-dir ...`를 전달한다. all-v1은 전체 행 수와 limit가 같아야 한다.
원본 인덱스를 보유하되 변환된 소스·점수·분류는 한 원본씩 JSONL에 기록하고,
중복 그룹도 전체/선택 ID 인덱스로 집계한다. 모든 점수를 메모리에 쌓지 않는다.
검증기는 저장된 모든 원문·분류·4개 점수 조합을 순차 대조하고 Fraction으로 독립 계산한다.
원본 및 두 정규화의 VA 구간·평균·표준편차·분위수/사분면, 후보/중복/결측을 validation.json에 기록한다.
메모리는 Windows OS의 프로세스 최대 working set(인터프리터·네이티브 메모리 포함)으로 측정한다.
전체 원본별 source 적재 대상과 미검증으로 songs 적재가 보류되는 후보 수는 load_policy로 구분한다.

## Spotify ID 100개 검증 준비

```powershell
python src/music/collectors/spotify_validate.py
python -m unittest discover -s src/music/collectors -p "test_*.py"
```

기본 출력은 `.local/spotify-validation/sample-100-v1/`이다. 새 실행에는 새 `--output-dir`을 지정하며 기존 결과를 덮어쓰지 않는다.
기존 전체 정제 결과의 체크섬·pending 상태·60,741개 후보를 확인하고,
고유 Spotify ID의 `SHA256(UTF8(muse-spotify-unique-100-v1 + NUL + ID))` 순위에서 100개를 선택한다.
제목·아티스트·중복 여부로 필터링하지 않으며 선택된 ID에 연결된 MuSe 원본들을 모두 비교한다.

확인한 환경에는 Python 3.14.7이 있고 별도 패키지는 필요 없다. 프로세스·Windows 사용자·시스템 환경에서 Spotify 인증 변수와 알려진 로컬 .env 파일은 발견되지 않았다. .env를 자동으로 읽지 않는다.
필요한 설정은 Spotify 개발자 앱의 **Client ID·Client Secret**, 명시적 market(예: KR), 앱의 API 접근 권한이다. 앱 모드·권한·Premium 요건은 기존 SPEC 7.3의 미확정 항목이며 인증 문자열 존재만으로 접근 가능하다고 판단하지 않는다.
[Client Credentials 공식 문서](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow)의 server-to-server 토큰 발급을 사용한다. 사용자 로그인/redirect URI·사용자 scope는 이 공개 곡 정보 조회 흐름에 필요하지 않다. 기존 Bearer 토큰은 SPOTIFY_ACCESS_TOKEN으로도 사용할 수 있으나 만료 시 재발급할 수 없으면 중단한다.

인증 설정 후 별도 셸에서 다음과 같이 실행한다. Client Secret은 숨김 입력을 사용하고 명령행 인자·코드·파일에 값을 적지 않는다.

```powershell
$env:SPOTIFY_CLIENT_ID = Read-Host 'Spotify Client ID'
$spotifySecretInput = Read-Host 'Spotify Client Secret' -AsSecureString
$env:SPOTIFY_CLIENT_SECRET = [System.Net.NetworkCredential]::new('', $spotifySecretInput).Password
$env:SPOTIFY_MARKET = 'KR'
python src/music/collectors/spotify_validate.py --execute --output-dir src/music/.local/spotify-validation/sample-100-live-v1
```

인증 누락·실행 플래그 없음·market 미설정이면 토큰 발급을 포함한 모든 API 호출을 보류한다.
토큰은 메모리에서만 발급·재사용하고 만료 전 갱신, 401 시 한 번 재발급한다.
고정 HTTPS 호스트의 `GET /v1/tracks/{id}?market=...`만 조회하고 인증 헤더의 redirect 전달은 금지한다.
[Get Track 문서](https://developer.spotify.com/documentation/web-api/reference/get-track)상 사용자 토큰의 국가가 market보다 우선할 수 있어 Bearer 사용자 토큰 실행은 명시한 market의 보장을 뜻하지 않는다.

기본 직렬 요청 간격은 1초다(프로젝트 보수적 설정이며 공식 quota가 아님).
[Rate Limits 문서](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)에 따라 429의 Retry-After 초/HTTP-date를 지키고, 네트워크 오류·5xx는 지수 backoff와 jitter로 최대 3회 재시도한다. 총 대기 예산은 120초이며 서버 대기를 줄여 재호출하지 않는다. 예산 초과·429 재시도 소진·인증 실패·403은 남은 ID를 확인 불가로 남기고 실행을 중단한다. 다른 404/5xx 조회 실패는 사유를 기록한다. SDK/공용 의존성은 추가하지 않는다.

판정 정책 `nfkc-casefold-whitespace-exact-v1`:

- success: 조회 ID가 동일하고 MuSe 제목 및 아티스트가 NFKC·casefold·연속 공백 정리 후 정확히 일치. 아티스트는 응답의 개별 아티스트 중 하나와 비교한다. ID별 성공은 연결된 **모든 원본**이 성공해야 한다.
- mismatch: 완전한 조회 응답에서 제목/아티스트가 위 정책과 다름. remaster·괄호·feat 표기를 제거하거나 fuzzy 점수로 승인하지 않는다. 중복 그룹의 일부만 맞아도 대표행을 선택하지 않고 모든 원본별 결과를 남긴다. 보수적 문자열 불일치는 곧 다른 녹음의 증명은 아니며 후속 검토가 필요하다.
- unconfirmed: 인증/권한/market/통신 문제, 404, relinking·다른 반환 ID, 응답 필드 누락, 재생 제한 등. 404는 해당 접근·market 조건의 조회 실패이며 전 세계 ID 부재로 확정하지 않는다.

`sample.json`은 MuSe에서 가져온 후보 ID·연결된 원본 id·선정 seed·해시만 포함한다.
`results.jsonl`은 ID별/원본별 판정·일치 boolean·고정 사유 코드·HTTP 상태만 포함한다.
`stats.json`은 인증 설정 유무(boolean), 호출·재시도·대기·성공/불일치/확인 불가 건수와 성공률 분모를 기록한다. 미실행 성공률은 null이다.
Spotify 응답 본문·제목·아티스트·새 반환 ID·토큰·오류 본문·Authorization은 저장/출력하지 않는다. Spotify 메타데이터 영구 보관은 권한 확인 전 구현하지 않는다.
이 결과의 success는 비교 정책상 일치일 뿐 DB verified 전환이 아니다. DB 적재·ReccoBeats 호출은 없다.

## ReccoBeats 소규모 접근·연동 점검

```powershell
python src/music/collectors/reccobeats_probe.py --execute
```

기존 고정 Spotify 표본의 앞 10개를 재사용하고 한 번의 metadata 요청에 담는다.
정확한 Spotify href가 반환된 곡만 UUID로 특징을 조회하며 전체 API 요청은 최대 11회·고유 곡은 최대 10개다.
직렬 2초 간격은 프로젝트 점검용 설정이며 공식 한도가 아니다. 403/429/서버 오류에는 추가 요청을 중단하고 재시도하지 않는다.
기본 결과는 `.local/reccobeats-probe/trial-10-v1/`에 저장한다. `--execute` 생략 시 호출하지 않으며
재실행은 새 `--output-dir`을 지정한다. 권한 확인 전 대량 호출·DB 적재는 수행하지 않는다.
응답은 메모리에서만 확인하고 원격 UUID·메타데이터·감정 수치는 저장하지 않는다.
결과 파일에는 입력 MuSe ID·참조·사유/HTTP 코드·필드 이름·유효 범위 boolean만 남긴다.
과거 접근 점검의 실제 통신/매칭 수치는 로컬 진단에 보존한다. 통신 오류와 정상 빈 응답을 구분하며 제공 필드의 문서 계약을 실제 확보율로 해석하지 않는다.
문서상 제공 필드와 실제 제공 여부를 구분한다. 상세 이용 조건·A/C1/C2 수집 제안은 SPEC 7.2.1~7.2.2를 따른다.

PC PowerShell의 Spotify ID 조회만 점검할 때는 다음을 실행한다. 기존과 동일한 고정 10개를 재추출하며
metadata GET 1건만 보내고 특징은 조회하지 않는다. 출력에는 HTTP 상태·반환 곡 수·정확한 Spotify href 매칭 수가 포함된다.
환경 라벨은 사용자가 실행 위치를 선언한 값이다. PC 결과는 기존 Codex 403 폴더와 분리된다.

```powershell
# 저장소 루트에서 실행한다. 작업 폴더를 개인 절대경로로 고정하지 않는다.
$out = "src/music/.local/reccobeats-probe/pc-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff')"
python src/music/collectors/reccobeats_probe.py --execute --lookup-only --execution-environment pc-powershell --output-dir $out
Get-Content "$out/results.jsonl" | ConvertFrom-Json | Select-Object spotify_id,id_match,lookup_outcome | Format-Table
```

HTTP 200 + 빈 content는 해당 요청 맥락의 정상 빈 응답이다. 통신 차단과 구분하며 개별 ID의 부재/삭제나 전체 카탈로그 커버리지를 확정하지 않는다.
실제 표본의 매칭률·반환/특징 확보 수치는 공유하지 않는다.

같은 환경의 Python urllib는 Cloudflare 403, PowerShell Invoke-WebRequest는 200을 확인했다.
`--transport powershell`은 기본 Windows HTTP 클라이언트로 조회하고 응답을 메모리 stdin/stdout 파이프로만 Python에 전달한다.
프록시·TLS·인증 설정을 변경하지 않으며 원격 응답 파일은 만들지 않는다. Python의 기존 ID/문자열/범위 비교와 최소 통계 저장을 재사용한다.
아래는 고정 표본과 특징 요청 상한을 지정하는 사용 예다. 요청 상한은 CLI 설정이며 실측 확보량·응답/매칭률은 공개하지 않는다.

```powershell
$out = "src/music/.local/reccobeats-probe/bridge-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff')"
python src/music/collectors/reccobeats_probe.py --execute --transport powershell --feature-limit 2 --execution-environment pc-powershell --output-dir $out
```

ID 매칭을 DB verified로 바꾸지 않는다. 감정 값은 메모리에서만 검사하고 영구 저장·대량 수집은 이용 조건 확인 전 보류한다.

10곡 통합 검증은 같은 명령의 `--feature-limit 10`으로 실행한다(최대 metadata 1+특징 10요청).
기존 출력 경로는 덮어쓰지 않는다. 파이프라인은 href/UUID·원본별 비교·Decimal·SQL 입력 계약을 검사하며, 실제 관측 결과는 로컬에만 보존한다.
합성 fixture 검증과 실제 데이터 관측을 구분하고 실제 소스 상태를 자동 승격하지 않는다.
PowerShell은 응답 Content 문자열을 파이프로만 넘기고 Python이 Decimal로 파싱한다.
생성된 메모리 입력 객체는 저장하지 않으며 통계에는 sql_contract_sources/scores와 검증 boolean만 남긴다.
잘못된 JSON·타임아웃·비유한/결측·다른 곡 특징·429는 합성 테스트로 확인했다. 403/429에는 자동 재시도나 자동 클라이언트 전환이 없다.
기존 SQL의 numeric·reccobeats-v1·pending 형식과 일치하지만, 실제 DB 적재나 값 영구 보관은 권한 확인 전 구현/실행하지 않는다.

## 오프라인 매칭·중복 감사 (후속 2단계)

`python -B src/music/collectors/matching_audit.py`는 기존 MuSe 전체 CSV와 기존 10곡 판정 기록만 읽는다. 외부 호출·DB 접속·실제 verified 전환 기능은 없다. 기존 canonical/Decimal/checksum 도구를 재사용하며 source-scoped-review-v1 규칙은 SPEC 2.1을 따른다.

출력은 `.local/matching-audit/stage2-v1/`의 집계·그룹별 충돌·표본별 보류 결과다. 재실행 시 새 `--output-dir src/music/.local/matching-audit/<새 경로>`를 사용하며 기존 출력은 덮어쓰지 않는다. 원격 제목/감정 값을 보관하지 않는다. assess의 성공/거절은 원본별 근거 검토 권고이며 반환 match_status는 항상 pending이다. 입력된 근거 필드의 진위를 코드가 증명하지 않는다.

collectors 디렉터리에서 `python -B -m unittest test_matching_audit test_clean_muse test_spotify_validate test_reccobeats_probe`로 신규 14개·기존 37개를 오프라인 검증한다. 기존 API 실행 명령은 이번 단계에서 사용하지 않는다.

## 전체 배치 수집 구조의 오프라인 검증 (후속 3단계)

```powershell
python -B src/music/collectors/reccobeats_batch.py --dry-run --max-requests 200
python -B src/music/collectors/reccobeats_batch.py --dry-run
```

첫 명령은 전체 60,741개 ID를 등록하고 200개 작업 경계에서 중단한다. 다음 명령은 같은 체크포인트에서 완료 작업을 재요청하지 않고 이어간다. 별도 시험은 `.local` 하위 새 `--checkpoint-dir`를 사용한다. 실수집 옵션은 없으며 dry-run은 합성 응답만 사용한다. 전체 결과를 실제 ReccoBeats 커버리지로 해석하지 않는다.

메타데이터 10-ID 배치와 UUID별 특징 큐를 분리했다. 중복 그룹·메타데이터 충돌·UUID 충돌은 특징 큐에서 보류한다. SQLite 체크포인트는 ID/판정/진행/시도/대기만 저장하고 원격 메타데이터·감정 값은 저장하지 않는다. 기존 PowerShell 전송 경로는 live_transport에 연결돼 있으나 코드 상수와 기본 Engine 전송 차단으로 잠겨 있다. 제공자 허용 조건과 별도 실행 권한 확인 전 해제하지 않는다.

403·uncertain은 운영자 검토 전 중단, 429는 Retry-After 전역 대기, 5xx/네트워크는 작업당 최대 3회·전역 5% 추가 예산을 적용한다. 프로그램 인터페이스 `Checkpoint.retry_job(key, acknowledge_possible_duplicate=...)`는 명시적 수동 재개용이며 대기/시도/총예산을 초기화하지 않는다. uncertain의 실제 전송 여부는 알 수 없으므로 중복 위험 확인 없이 재시도하지 않는다. 원본별 독립 검토·verified 전환·점수 저장 sink는 별도 작업이다. 세부 규칙은 SPEC 5.1을 따른다.

collectors 디렉터리에서 `python -B -m unittest test_reccobeats_batch test_matching_audit test_clean_muse test_spotify_validate test_reccobeats_probe`로 배치 18개 및 기존 51개 테스트를 실행한다. 테스트 전송은 합성이며 외부 API 호출이 없다.

## 연구용 고정 100-ID 실측 — 명시적 예외 모드

사용자가 승인한 비상용 2차원 V/A 추천 비교 연구의 100개 실험만 활성화했다. 전체 모집단 live 잠금은 유지한다. 기존 seed/hash의 Spotify 검증 표본 100개(원본 참조 101행)를 그대로 쓰며 누락된 ID를 다른 곡으로 대체하지 않는다. `reccobeats_research.py`가 기존 Checkpoint/Engine/PowerShell 전송/Decimal 파서/매칭 규칙을 재사용한다. base 엔진 변경은 명시적 분기와 최소 간격을 늘리는 옵션뿐이다.

```powershell
python -B src/music/collectors/reccobeats_batch.py --research-live --max-requests 1
python -B src/music/collectors/reccobeats_batch.py --research-live --max-requests 10
python -B src/music/collectors/reccobeats_batch.py --research-live
```

실모드는 고정 연구 checkpoint만 사용하며 초기화·수동 retry·클라이언트 전환으로 중단을 회피하지 않는다. 최소 시작 간격 3초·429 Retry-After 전역 대기·작업당 최대 3회·총 상한 116시도는 구현 설정이다. 실제 요청 횟수/통신 성능은 로컬 결과에만 보존한다.

연구용 research_features는 raw V/E와 2*x-1 결과·관측 시각만 임시 저장하며 job 완료와 같은 트랜잭션이다. 원격 제목/아티스트·원문 JSON·오디오는 저장하지 않는다. 연구 SQLite를 공유/음악 DB에 적재하거나 공개하지 않는다. manifest의 source_rows_with_id/duplicate_groups는 전체 MuSe 통계이며 표본 101행/1그룹은 summary.json의 sample_* 필드를 따른다.

실제 조회/매칭·특징 확보·분포·요청량은 로컬 summary/report에만 보존한다. 모든 원본은 hold/pending이며 수집 결과 공개와 verified 승격은 별도다.

연구 목적이라는 이유로 제공자 저장/재사용 허용을 확정하지 않는다. 임시 보관은 이번 사용자 지시 범위이며 제공자의 장기 보관/재사용/배포/TTL 조건은 미확인이다. 검토 종료 후 임시값 폐기 또는 별도 보관 허용 확인이 필요하고 자동 TTL 삭제는 구현하지 않았다. 확대는 추가 사용자 결정과 권한 검토 전까지 금지한다.

`--research-live --report-only`는 추가 API 없이 집계를 다시 읽는다. 신규 연구 6+기존 69=75개 단위 테스트는 모두 합성 전송이며 다음 명령으로 확인한다.

```powershell
Push-Location src/music/collectors
python -B -m unittest test_reccobeats_research test_reccobeats_batch test_matching_audit test_clean_muse test_spotify_validate test_reccobeats_probe
Pop-Location
```


## 누적 1,000-ID 연구 확대 (2026-10-17)

최신 사용자 승인으로 위 100개 상한을 누적 1,000개로 확장했다. 전체 live 잠금은 유지한다. 기존 100개 체크포인트가 정상 완료 상태인지 확인한 뒤 새 fixed-1000-v1로 원자적으로 인계한다. 기존 100개 완료 요청과 값은 재사용하며 추가 900개만 조회한다. 임의 경로/1,001개 이상 범위는 지원하지 않는다.

PowerShell: python -B src/music/collectors/reccobeats_batch.py --research-live --research-size 1000

추가 API 없이 확인하려면 동일 명령에 --report-only를 붙인다. --max-requests 1로 정상 경계 중단 후 재실행 가능하다. 인계가 끝나기 전 전송은 차단되며 403으로 중단된 원본에서 확대할 수 없다. 기존 최소 3초 간격/429 대기/403 sticky 중단을 재사용한다. 총 1,000개 누적 범위가 완료되면 추가 요청은 0건이다.

비상업적 대학 캡스톤 연구와 단기 보관도 이용 조건의 적용 대상이다. 제공자 저장·재사용 허용은 미확인이다. 2026년 12월 실제 프로젝트 종료 직후 기존 100개 및 1,000개 데이터·보고서·체크포인트/WAL/SHM·내보내기·백업/동기화 사본을 삭제하고 잔존 여부를 확인한다. 정확한 종료일과 담당자는 팀 확정 대상이며 자동 TTL 삭제는 미구현이다. SPEC의 삭제 계획을 따른다.

## 전체 60,741개 확대 준비 (2026-10-18, 최신 범위)

기존 10,000개 수집은 완료됐다. 아래 준비/dry-run은 원본과 기존 연구 체크포인트를 보존하고 외부 API를 호출하지 않는다. 추가 50,741개는 기존 seed/hash 순위의 나머지 전부이며 목록·해시는 `.local/reccobeats-full-preparation/`에 저장한다. 모든 명령은 저장소 루트 PowerShell 기준이다.

```powershell
python -B src/music/collectors/reccobeats_full.py --prepare
python -B -m unittest discover -s src/music/collectors -p "test_*.py"
python -B src/music/collectors/reccobeats_full.py --dry-run --max-requests 1
python -B src/music/collectors/reccobeats_full.py --dry-run
python -B src/music/collectors/reccobeats_full.py --report-only
```

실제 후속 수집을 시작할 때만 다음 명령을 사용한다. 이번 준비 작업에서는 실행하지 않는다. 동일 명령 재실행은 완료 요청을 재호출하지 않고 남은 작업부터 재개한다. `--max-requests 1`은 새 요청 1시도 후 정상 경계 중단용이며 Ctrl+C 후에도 체크포인트를 유지한다.

```powershell
python -B src/music/collectors/reccobeats_full.py --research-live --max-requests 1
python -B src/music/collectors/reccobeats_full.py --research-live
```

실제 결과는 `.local/reccobeats-full-v1/`, 합성 결과는 `.local/reccobeats-full-dry-v1/`에 저장한다. 각 폴더의 `progress.json`, `milestones.json`, `fixed-N-v1/checkpoint.sqlite`·`verification.json`을 확인한다. 누적 1,000개씩 인계하며 마지막은 741개다. 완료된 미반환/보류도 재호출하지 않는다. 실패/403/uncertain을 새 경로나 초기화로 우회하지 않는다. 403은 재개 명령에도 중단 상태를 유지하며, 429 대기는 재개 후에도 준수한다. dry-run은 완료 구간 재실행의 추가 0요청을 자동 검증한다.

SPEC 최신 절의 약관·호출량·조건부 소요 시간 및 2026년 12월 삭제 계획을 따른다. 연구 목적이 대량 수집/보관/재사용 권한을 보장하지 않는다. 자동 TTL은 미구현이다.
