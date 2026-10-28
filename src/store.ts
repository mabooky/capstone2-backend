import type { Library } from './library.js';
import type { RequestStatus, Track, TrackWithStatus } from './models/track.js';

export type Mood = { valence: number; arousal: number; n: number };

type PlaySource = 'request' | 'fallback';

/** 대기열에 들어 있는 한 곡입니다. clientId는 서버 안에서만 쓰고 응답으로 내보내지 않습니다. */
type QueueEntry = { queueId: string; track: Track; requestedAt: number; clientId: string };

type NowPlayingEntry = { track: Track; startedAt: number; source: PlaySource };

/** GET /queue 응답의 모양입니다. */
export type QueueSnapshot = {
    serverTime: number;
    nowPlaying: { track: TrackWithStatus; startedAt: number; source: PlaySource } | null;
    queue: Array<{ queueId: string; track: TrackWithStatus; requestedAt: number; mine: boolean }>;
};

export interface StoreOptions {
    password: string;
    /** 곡이 재생되기 시작한 뒤 다시 신청할 수 없는 시간(ms)입니다. */
    trackCooldownMs: number;
    /** 현재 시각(epoch ms)을 돌려주는 함수입니다. 시간에 의존하는 동작을 테스트할 때 활용할 수 있습니다. */
    now?: () => number;
}

/**
 * 매장 하나의 상태와 규칙입니다. 서버를 재시작하면 초기화됩니다.
 * 검사와 변경 사이에 await를 두지 않으면 Node의 싱글 스레드 덕분에 락 없이도 안전하므로,
 * 이 클래스의 메서드는 모두 동기로 유지합니다.
 */
export class Store {
    readonly password: string;
    private readonly trackCooldownMs: number;
    private readonly now: () => number;

    private mood: Mood = { valence: 0, arousal: 0, n: 100 };
    /** 기준점에서 가까운 n곡입니다. 기준점이 바뀔 때마다 새로 만들어집니다. */
    private catalog: Track[];
    private catalogIds: Set<string>;
    private queue: QueueEntry[] = [];
    private nowPlaying: NowPlayingEntry | null = null;
    /** 곡별로 마지막에 재생이 시작된 시각입니다. */
    private readonly playedAt = new Map<string, number>();

    constructor(private readonly library: Library, options: StoreOptions) {
        this.password = options.password;
        this.trackCooldownMs = options.trackCooldownMs;
        this.now = options.now ?? Date.now;
        this.catalog = library.nearest(this.mood.valence, this.mood.arousal, this.mood.n);
        this.catalogIds = new Set(this.catalog.map(track => track.spotifyId));
    }

    getMood(): Mood {
        return { ...this.mood };
    }

    /** 곡의 신청 상태를 정합니다. 여러 상태에 해당하면 아래 순서에서 가장 앞선 하나를 돌려줍니다. */
    statusOf(track: Track): RequestStatus {
        if (this.nowPlaying?.track.spotifyId === track.spotifyId) return 'now-playing';
        if (this.queue.some(entry => entry.track.spotifyId === track.spotifyId)) return 'already-queued';
        if (!this.catalogIds.has(track.spotifyId)) return 'out-of-mood';
        const startedAt = this.playedAt.get(track.spotifyId);
        if (startedAt !== undefined && this.now() - startedAt < this.trackCooldownMs) return 'recently-played';
        return 'available';
    }

    /** 곡에 상태 정보를 붙여 반환합니다. */
    private withStatus(track: Track): TrackWithStatus {
        return { ...track, requestStatus: this.statusOf(track) };
    }

    /** GET /catalog: 기준점에서 가까운 순서의 카탈로그입니다. */
    getCatalog(): TrackWithStatus[] {
        return this.catalog.map(track => this.withStatus(track));
    }

    /** GET /queue: 재생 중인 곡과 대기열 전체입니다. clientId가 신청한 곡에는 mine이 true입니다. */
    getQueue(clientId?: string): QueueSnapshot {
        return {
            serverTime: this.now(),
            nowPlaying: this.nowPlaying && {
                track: this.withStatus(this.nowPlaying.track),
                startedAt: this.nowPlaying.startedAt,
                source: this.nowPlaying.source,
            },
            queue: this.queue.map(entry => ({
                queueId: entry.queueId,
                track: this.withStatus(entry.track),
                requestedAt: entry.requestedAt,
                mine: clientId !== undefined && entry.clientId === clientId,
            })),
        };
    }

    /** GET /search: 전체 곡에서 검색하고, 카탈로그 밖의 곡에는 out-of-mood 상태가 붙습니다. */
    search(query: string, limit: number, offset: number): { total: number; tracks: TrackWithStatus[] } {
        const { total, tracks } = this.library.search(query, limit, offset);
        return { total, tracks: tracks.map(track => this.withStatus(track)) };
    }
}
