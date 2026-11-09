import express from 'express';
import cors from 'cors';
import { createTrackLibrary, type TrackLibrary } from './trackLibrary.js';
import { errorHandler, resolveStore } from './middleware.js';
import { storeRouter } from './routes/storeRouter.js';
import { findAllStores } from './db/storeRepository.js';
import { findAllTracks } from './db/trackRepository.js';
import { Store } from './store.js';

/**
 * 등록된 매장마다 Store 객체를 만듭니다. 모든 매장이 같은 trackLibrary를 공유하며,
 * 곡 쿨타임은 TRACK_COOLDOWN_MIN 환경변수(분)로 정합니다. 설정이 없으면 30분입니다.
 * 시작할 때 한 번만 만들므로 매장을 추가하면 서버를 재시작해야 합니다. 등록된 매장이 없으면 오류를 던집니다.
 */
async function createStores(trackLibrary: TrackLibrary): Promise<Store[]> {
    // 환경변수에서 설정한 곡 쿨타임을 불러와 Store 객체에 주입
    const cooldownMin = Number(process.env.TRACK_COOLDOWN_MIN ?? 30);
    if (!Number.isFinite(cooldownMin) || cooldownMin < 0) {
        throw new Error('TRACK_COOLDOWN_MIN은 0 이상의 숫자여야 합니다.');
    }

    const storeRows = await findAllStores();
    if (storeRows.length === 0) {
        throw new Error('등록된 매장이 없습니다. node --env-file=.env scripts/stores.mjs add <이름> --yes 로 매장을 등록해 주십시오.');
    }
    return storeRows.map(row => new Store(trackLibrary, {
        id: row.id,
        name: row.name,
        adminPasswordHash: row.admin_password_hash,
        trackCooldownMs: cooldownMin * 60_000,
    }));
}

export async function createApp() {
    const globalTrackLibrary = createTrackLibrary(await findAllTracks());
    console.log(`곡 ${globalTrackLibrary.size}개를 불러왔습니다.`);
    const stores = await createStores(globalTrackLibrary);

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
