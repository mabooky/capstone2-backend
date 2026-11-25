import { murmur3 } from '../murmur3.js';
import { CatalogConfigError, type CatalogConfig } from '../models/catalogConfig.js';
import type { Track } from './track.js';
import type { TrackLibrary } from './trackLibrary.js';

/** 카탈로그를 만든 결과입니다. candidateCount는 기준곡을 포함한 영역 안의 고유 후보 곡 수입니다. */
export type CatalogResult = {
    tracks: Track[];
    status: 'complete' | 'insufficient-candidates' | 'empty';
    candidateCount: number;
};

type Point = { valence: number; arousal: number };

/** 기준곡 방식에서 볼록 껍질 바깥으로 넓히는 원형 버퍼의 반지름입니다. */
const BUFFER = 0.1;

/** 경계를 계산할 때 허용하는 부동소수점 오차입니다. 정규화한 좌표 기준의 절댓값입니다. */
const EPS = 1e-12;

function cross(a: Point, b: Point, c: Point): number {
    return (b.valence - a.valence) * (c.arousal - a.arousal) - (b.arousal - a.arousal) * (c.valence - a.valence);
}

/** 모노톤 체인으로 볼록 껍질을 구합니다. 한 직선 위의 점들은 양 끝점으로, 모두 같은 점은 한 점으로 줄어듭니다. */
function hull(points: Point[]): Point[] {
    const unique = [...new Map(points.map(p => [`${p.valence},${p.arousal}`, p])).values()]
        .sort((a, b) => a.valence - b.valence || a.arousal - b.arousal);
    if (unique.length <= 1) return unique;

    const lower: Point[] = [];
    for (const p of unique) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }

    const upper: Point[] = [];
    for (const p of [...unique].reverse()) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }

    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** 점 p와 선분 ab 사이의 최단 거리입니다. a와 b가 같으면 두 점 사이의 거리입니다. */
function segmentDistance(p: Point, a: Point, b: Point): number {
    const dx = b.valence - a.valence;
    const dy = b.arousal - a.arousal;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.valence - a.valence) * dx + (p.arousal - a.arousal) * dy) / lengthSquared));
    return Math.hypot(p.valence - a.valence - t * dx, p.arousal - a.arousal - t * dy);
}

/** 점 p가 볼록 껍질 안에 있거나, 껍질의 변에서 BUFFER 거리 안에 있는지 확인합니다. */
function inBufferedHull(p: Point, polygon: Point[]): boolean {
    if (polygon.length >= 3 && polygon.every((a, i) => cross(a, polygon[(i + 1) % polygon.length], p) >= 0)) return true;
    return polygon.some((a, i) => segmentDistance(p, a, polygon[(i + 1) % polygon.length]) <= BUFFER + EPS);
}

/** 곡마다 randomSeed와 곡 ID로 점수(32비트 해시)를 매겨 낮은 순으로 정렬합니다. 점수가 같으면 곡 ID순이며, 곡의 입력 순서와 무관합니다. */
function rankByScore(tracks: readonly Track[], randomSeed: number): Track[] {
    return tracks
        .map(track => ({ track, score: murmur3(track.id, randomSeed) }))
        .sort((a, b) => a.score - b.score || (a.track.id < b.track.id ? -1 : a.track.id > b.track.id ? 1 : 0))
        .map(entry => entry.track);
}

/**
 * 설정에 따라 곡 라이브러리에서 카탈로그를 만듭니다. DB에는 접근하지 않습니다.
 * config는 parseCatalogConfig로 형식이 검증된 값이어야 합니다. 기준곡이 라이브러리에 없으면 CatalogConfigError를 던집니다.
 * 후보를 randomSeed로 정한 점수순으로 정렬해 앞의 곡을 뽑으므로, 같은 입력은 항상 같은 결과입니다.
 */
export function recommendCatalog(trackLibrary: TrackLibrary, config: CatalogConfig): CatalogResult {
    const seeds: Track[] = config.mode === 'seeds'
        ? config.seedTrackSpotifyIds.map(id => {
            const track = trackLibrary.get(id);
            if (!track) throw new CatalogConfigError('등록되지 않은 기준곡이 있습니다.');
            return track;
        })
        : [];

    const polygon = hull(seeds);
    const candidates = trackLibrary.tracks.filter(p => config.mode === 'range'
        ? p.valence >= config.valenceMin - EPS && p.valence <= config.valenceMax + EPS &&
          p.arousal >= config.energyMin - EPS && p.arousal <= config.energyMax + EPS
        : inBufferedHull(p, polygon)
    );

    const seedIds = new Set(seeds.map(t => t.id));
    const others = rankByScore(candidates.filter(t => !seedIds.has(t.id)), config.randomSeed).slice(0, config.n - seeds.length);
    const tracks = rankByScore([...seeds, ...others], config.randomSeed);

    return {
        tracks,
        candidateCount: candidates.length,
        status: tracks.length === 0 ? 'empty' : tracks.length < config.n ? 'insufficient-candidates' : 'complete',
    };
}
