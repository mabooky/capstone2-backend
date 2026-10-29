import express from 'express';
import cors from 'cors';
import { library } from './library.js';
import { errorHandler, resolveStore } from './middleware.js';
import { storeRouter } from './routes/storeRouter.js';
import { Store } from './store.js';

/**
 * STORES 환경변수(JSON, 예: {"1":"1234"})로 매장 목록을 만듭니다. 설정이 없으면 매장 1(비밀번호 1234)을 사용합니다.
 * 곡 쿨타임은 TRACK_COOLDOWN_MIN 환경변수(분)로 정하며, 설정이 없으면 30분입니다. 모든 매장이 같은 Library를 공유합니다.
 */
function loadStores(): ReadonlyMap<string, Store> {
    const passwords = JSON.parse(process.env.STORES ?? '{"1":"1234"}') as Record<string, string>;
    const cooldownMin = Number(process.env.TRACK_COOLDOWN_MIN ?? 30);
    if (!Number.isFinite(cooldownMin) || cooldownMin < 0) {
        throw new Error('TRACK_COOLDOWN_MIN은 0 이상의 숫자여야 합니다.');
    }
    return new Map(
        Object.entries(passwords).map(([id, password]): [string, Store] => [
            id,
            new Store(library, { password, trackCooldownMs: cooldownMin * 60_000 }),
        ]),
    );
}

export function createApp() {
    const stores = loadStores();

    const app = express();
    app.use(cors());
    app.use(express.json());

    app.get('/api/health', (req, res) => {
        res.status(200).json({ status: 'ok', timestamp: Date.now() });
    });

    app.use('/api/stores/:storeId', resolveStore(stores), storeRouter);

    app.use(errorHandler);

    return app;
}
