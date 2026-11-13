# tracks

DB에서 곡을 읽어 오는 일부터 `TrackLibrary`를 구현하는 일까지 담당하는 모듈입니다.

## 의존 방향

```
백엔드 → tracks → db/trackRepository
```

`trackRepository`는 `tracks` 안이 아니라 공통 디렉터리인 `db/`에 둡니다. 이유는 두 가지입니다.

- 다른 Repository와 함께 배치하여 DB 접근 코드를 한곳에 모아 응집성을 높이기 위함입니다.
- DB 접근은 연결 풀을 공유하는 공통 계층이므로, 모듈마다 따로 연결을 만들거나 모듈 안에 접근 코드를 두지 않기 위함입니다.

`tracks`는 이 저장소 계층만 사용하며 백엔드의 다른 코드는 알지 못합니다.

## 좌표 규약

백엔드에서는 valence와 arousal이 모두 `[-1, 1]` 범위여야 합니다. DB의 `valence`, `energy`는 `[0, 1]`이므로 `TrackLibrary`를 만들 때 변환이 필요하며, 백엔드 코드에서는 변환하지 않습니다.
