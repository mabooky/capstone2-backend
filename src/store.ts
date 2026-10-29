import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import type { TrackLibrary } from './trackLibrary.js';
import type { RequestStatus, Track, TrackWithStatus } from './models/track.js';

/** 기준점에서 n을 따로 지정하지 않았을 때의 곡 수입니다. */
const DEFAULT_N = 100;
/** 카탈로그에 담을 수 있는 곡 수의 상한입니다. */
const MAX_N = 100;

export type Mood = { valence: number; arousal: number; n: number };

type PlaySource = 'request' | 'fallback';

/** 서버가 저장하는 대기열의 한 곡입니다. clientId는 서버 안에서만 쓰고 응답으로 내보내지 않습니다. */
type QueueEntryServer = { queueId: string; track: Track; requestedAt: number; clientId: string };

/** 응답으로 나가는 대기열의 한 곡입니다. API 명세의 QueueEntry에 해당합니다. */
export type QueueEntry = { queueId: string; track: Track; requestedAt: number; mine: boolean };

/** 재생 중인 곡입니다. 저장 모양과 응답 모양이 같습니다. */
export type NowPlayingEntry = { track: Track; startedAt: number; source: PlaySource };

/** GET /queue 응답의 모양입니다. */
export type QueueSnapshot = {
    serverTime: number;
    nowPlaying: NowPlayingEntry | null;
    queue: QueueEntry[];
};

export interface StoreOptions {
    password: string;
    /** 곡이 재생되기 시작한 뒤 다시 신청할 수 없는 시간(ms)입니다. */
    trackCooldownMs: number;
    /** 현재 시각(epoch ms)을 돌려주는 함수입니다. 시간에 의존하는 동작을 테스트할 때 활용할 수 있습니다. */
    now?: () => number;
    /** 0 이상 1 미만의 난수를 돌려주는 함수입니다. 무작위로 고르는 동작을 테스트할 때 활용할 수 있습니다. */
    random?: () => number;
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
    private readonly random: () => number;

    private mood: Mood = { valence: 0, arousal: 0, n: DEFAULT_N };
    /** 기준점에서 가까운 n곡입니다. 기준점이 바뀔 때마다 새로 만들어집니다. */
    private catalog: Track[];
    private catalogIds: Set<string>;
    private queue: QueueEntryServer[] = [];
    private nowPlaying: NowPlayingEntry | null = null;
    /** 곡별로 마지막에 재생이 시작된 시각입니다. */
    private readonly playedAt = new Map<string, number>();
    /** 다음에 만들 대기열 항목의 번호입니다. queueId는 q1, q2, ...로 매장 안에서 올라갑니다. */
    private nextQueueNumber = 1;
    /** 현재 유효한 관리자 토큰입니다. 매장당 하나만 유지하므로 새로 로그인하면 이전 토큰은 무효가 됩니다. */
    private adminToken: string | null = null;

    constructor(private readonly trackLibrary: TrackLibrary, options: StoreOptions) {
        this.password = options.password;
        this.trackCooldownMs = options.trackCooldownMs;
        this.now = options.now ?? Date.now;
        this.random = options.random ?? Math.random;
        this.catalog = trackLibrary.nearest(this.mood.valence, this.mood.arousal, this.mood.n);
        this.catalogIds = new Set(this.catalog.map(track => track.spotifyId));
    }

    /** POST /admin/login: 비밀번호가 맞으면 새 토큰을 발급하고, 이전에 발급한 토큰은 무효로 만듭니다. */
    login(password: string): string {
        if (password !== this.password) {
            throw new ApiError(401, 'INVALID_CREDENTIALS', '비밀번호가 올바르지 않습니다.');
        }
        this.adminToken = randomUUID();
        return this.adminToken;
    }

    /** 현재 유효한 관리자 토큰인지 확인합니다. */
    isAdminToken(token: string): boolean {
        return this.adminToken !== null && token === this.adminToken;
    }

    /**
     * PUT /admin/mood: 기준점을 통째로 교체하고 새 카탈로그를 돌려줍니다.
     * 이미 대기열에 들어간 곡과 재생 기록은 그대로 유지합니다.
     */
    setMood(valence: number, arousal: number, n: number = DEFAULT_N): TrackWithStatus[] {
        if (!(valence >= -1 && valence <= 1) || !(arousal >= -1 && arousal <= 1)) {
            throw new ApiError(400, 'INVALID_INPUT', 'valence와 arousal은 -1 이상 1 이하여야 합니다.');
        }
        if (!Number.isInteger(n) || n < 1 || n > MAX_N) {
            throw new ApiError(400, 'INVALID_INPUT', `n은 1 이상 ${MAX_N} 이하의 정수여야 합니다.`);
        }
        this.mood = { valence, arousal, n };
        this.catalog = this.trackLibrary.nearest(valence, arousal, n);
        this.catalogIds = new Set(this.catalog.map(track => track.spotifyId));
        return this.getCatalog();
    }

    /** GET /admin/mood/preview: 기준점을 바꾸지 않고, 해당 좌표에서 가까운 곡을 미리 조회합니다. */
    getPreview(valence: number, arousal: number, n: number = DEFAULT_N): Track[] {
        if (!(valence >= -1 && valence <= 1) || !(arousal >= -1 && arousal <= 1)) {
            throw new ApiError(400, 'INVALID_INPUT', 'valence와 arousal은 -1 이상 1 이하여야 합니다.');
        }
        if (!Number.isInteger(n) || n < 1 || n > MAX_N) {
            throw new ApiError(400, 'INVALID_INPUT', `n은 1 이상 ${MAX_N} 이하의 정수여야 합니다.`);
        }
        return this.trackLibrary.nearest(valence, arousal, n);
    }

    /** DELETE /admin/queue/:queueId: 대기열에서 곡을 제거합니다. 재생된 것이 아니므로 곡 쿨타임은 적용하지 않습니다. */
    removeQueueItem(queueId: string): void {
        const index = this.queue.findIndex(entry => entry.queueId === queueId);
        if (index === -1) throw new ApiError(404, 'QUEUE_ITEM_NOT_FOUND', '존재하지 않는 대기열 항목입니다.');
        this.queue.splice(index, 1);
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
                track: this.nowPlaying.track,
                startedAt: this.nowPlaying.startedAt,
                source: this.nowPlaying.source,
            },
            queue: this.queue.map(entry => ({
                queueId: entry.queueId,
                track: entry.track,
                requestedAt: entry.requestedAt,
                mine: clientId !== undefined && entry.clientId === clientId,
            })),
        };
    }

    /** GET /search: 전체 곡에서 검색하고, 카탈로그 밖의 곡에는 out-of-mood 상태가 붙습니다. */
    search(query: string, limit: number = 20, offset: number = 0): { total: number; tracks: TrackWithStatus[] } {
        if (query.trim() === '') {
            throw new ApiError(400, 'INVALID_INPUT', 'q는 비어 있을 수 없습니다.');
        }
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
            throw new ApiError(400, 'INVALID_INPUT', 'limit은 1 이상 50 이하의 정수여야 합니다.');
        }
        if (!Number.isInteger(offset) || offset < 0) {
            throw new ApiError(400, 'INVALID_INPUT', 'offset은 0 이상의 정수여야 합니다.');
        }
        const { total, tracks } = this.trackLibrary.search(query, limit, offset);
        return { total, tracks: tracks.map(track => this.withStatus(track)) };
    }

    /** 이 고객이 신청한 곡이 대기열에 있는지 확인합니다. 재생 중인 곡은 대기 중으로 보지 않습니다. */
    private hasPendingRequest(clientId: string): boolean {
        return this.queue.some(entry => entry.clientId === clientId);
    }

    /** GET /me: 이 고객이 지금 곡을 신청할 수 있는지 알려줍니다. */
    getMe(clientId: string): { canRequest: boolean; reason: 'MY_REQUEST_PENDING' | null } {
        return this.hasPendingRequest(clientId)
            ? { canRequest: false, reason: 'MY_REQUEST_PENDING' }
            : { canRequest: true, reason: null };
    }

    /**
     * POST /queue: 곡을 대기열에 신청합니다.
     * 명세의 순서대로 검사하고, 모두 통과했을 때만 마지막에 대기열을 바꿉니다.
     * 검사와 변경 사이에 await가 없으므로 다른 요청이 끼어들 수 없습니다.
     */
    enqueue(clientId: string, spotifyId: string): QueueEntry {
        // ---- 검사 ----
        const track = this.trackLibrary.get(spotifyId);
        if (!track) throw new ApiError(404, 'TRACK_NOT_FOUND', '등록되지 않은 곡입니다.');
        if (!this.catalogIds.has(spotifyId)) {
            throw new ApiError(403, 'OUT_OF_MOOD', '현재 기준점의 범위를 벗어난 곡입니다.');
        }
        const status = this.statusOf(track);
        if (status === 'now-playing' || status === 'already-queued') {
            throw new ApiError(409, 'TRACK_ALREADY_QUEUED', '이미 대기열에 있거나 재생 중인 곡입니다.');
        }
        if (status === 'recently-played') {
            const availableAt = this.playedAt.get(spotifyId)! + this.trackCooldownMs;
            const retryAfterSec = Math.max(1, Math.ceil((availableAt - this.now()) / 1000));
            throw new ApiError(429, 'TRACK_COOLDOWN', '최근에 재생된 곡입니다.', retryAfterSec);
        }
        if (this.hasPendingRequest(clientId)) {
            throw new ApiError(409, 'MY_REQUEST_PENDING', '이미 대기열에 신청한 곡이 있습니다.');
        }

        // ---- 변경 ----
        const entry: QueueEntryServer = {
            queueId: `q${this.nextQueueNumber++}`,
            track,
            requestedAt: this.now(),
            clientId,
        };
        this.queue.push(entry);
        return {
            queueId: entry.queueId,
            track,
            requestedAt: entry.requestedAt,
            mine: true,
        };
    }

    /**
     * PUT /admin/now-playing: 관리자가 재생하려는 곡을 보고받아 재생 상태를 기록합니다.
     * 명세의 순서대로 검사하고, 모두 통과했을 때만 마지막에 상태를 바꿉니다.
     */
    reportNowPlaying(spotifyId: string): NowPlayingEntry {
        // ---- 검사 ----
        const track = this.trackLibrary.get(spotifyId);
        if (!track) throw new ApiError(404, 'TRACK_NOT_FOUND', '등록되지 않은 곡입니다.');

        let source: PlaySource;
        let takeFromQueue = false;
        if (this.nowPlaying?.track.spotifyId === spotifyId) {
            // 같은 곡을 다시 재생하는 경우입니다. 대기열과 source는 그대로 둡니다.
            source = this.nowPlaying.source;
        } else if (this.queue.length > 0) {
            if (this.queue[0].track.spotifyId !== spotifyId) {
                throw new ApiError(409, 'NOT_NEXT_IN_QUEUE', '대기열의 맨 앞 곡이 아닙니다.');
            }
            source = 'request';
            takeFromQueue = true;
        } else {
            if (!this.catalogIds.has(spotifyId)) {
                throw new ApiError(403, 'OUT_OF_MOOD', '현재 기준점의 범위를 벗어난 곡입니다.');
            }
            source = 'fallback';
        }

        // ---- 변경 ----
        if (takeFromQueue) this.queue.shift();
        const startedAt = this.now();
        this.playedAt.set(spotifyId, startedAt);
        this.nowPlaying = { track, startedAt, source };
        return this.nowPlaying;
    }

    /**
     * GET /admin/fallback-track: 대기열이 비었을 때 자동으로 재생할 곡을 고릅니다. 상태는 바꾸지 않습니다.
     * 지금 신청할 수 있는 곡 중에서 무작위로 고르고, 없으면 카탈로그에서 가장 오래전에 재생된 곡을 돌려줍니다.
     */
    getFallbackTrack(): Track {
        const available = this.catalog.filter(track => this.statusOf(track) === 'available');
        if (available.length > 0) return available[Math.floor(this.random() * available.length)];

        let oldest: Track | undefined;
        for (const track of this.catalog) {
            const startedAt = this.playedAt.get(track.spotifyId);
            if (startedAt === undefined) continue;
            if (oldest === undefined || startedAt < this.playedAt.get(oldest.spotifyId)!) oldest = track;
        }
        if (!oldest) throw new ApiError(409, 'NO_TRACKS', '재생할 수 있는 곡이 없습니다.');
        return oldest;
    }
}
