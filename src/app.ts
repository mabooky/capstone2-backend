import express from 'express';
import cors from 'cors';
import { errorHandler, resolveStore } from './middleware.js';
import { storeRouter } from './routes/storeRouter.js';
import { createDevMusicRouter, type DevMusicOptions } from './music/integration/dev_router.js';

type StoreConfig = { password: string };

/** STORES 환경변수(JSON, 예: {"1":"1234"})로 매장 목록을 만듭니다. 설정이 없으면 매장 1(비밀번호 1234)을 사용합니다. */
function loadStores(): ReadonlyMap<string, StoreConfig> {
    const passwords = JSON.parse(process.env.STORES ?? '{"1":"1234"}') as Record<string, string>;
    return new Map(Object.entries(passwords).map(([id, password]): [string, StoreConfig] => [id, { password }]));
}

export function createApp(options: DevMusicOptions = {
    nodeEnv: process.env.NODE_ENV,
    enabled: process.env.ENABLE_DEV_MUSIC_RECOMMENDATIONS === 'true',
    experimentRoot: process.env.MUSIC_EXPERIMENT_ROOT,
    source: process.env.MUSIC_EXPERIMENT_SOURCE,
    datasetRoot: process.env.MUSIC_DATASET_ROOT,
}) {
    const stores = loadStores();
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.get('/api/health', (req, res) => {
        res.status(200).json({ status: 'ok', timestamp: Date.now() });
    });
    app.use('/api/stores/:storeId', resolveStore(stores), storeRouter);
    const devMusic = createDevMusicRouter(options);
    app.use('/api/dev/music', devMusic.router, devMusic.errorHandler);
    app.use(errorHandler);
    return { app, close: devMusic.close };
}
