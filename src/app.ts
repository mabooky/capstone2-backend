import express from 'express';
import cors from 'cors';
import { storeRouter } from './routes/storeRouter.js';
import { createDevMusicRouter, type DevMusicOptions } from './music/integration/dev_router.js';

export function createApp(options: DevMusicOptions = {
    nodeEnv: process.env.NODE_ENV,
    enabled: process.env.ENABLE_DEV_MUSIC_RECOMMENDATIONS === 'true',
    experimentRoot: process.env.MUSIC_EXPERIMENT_ROOT,
    source: process.env.MUSIC_EXPERIMENT_SOURCE,
    datasetRoot: process.env.MUSIC_DATASET_ROOT,
}) {
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.get('/api/health', (req, res) => {
        res.status(200).json({ status: 'ok', timestamp: Date.now() });
    });
    app.use('/api/stores/:storeId', storeRouter);
    const devMusic = createDevMusicRouter(options);
    app.use('/api/dev/music', devMusic.router, devMusic.errorHandler);
    return { app, close: devMusic.close };
}
