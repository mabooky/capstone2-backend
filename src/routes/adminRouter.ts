import express from 'express';
import { requireAdmin } from '../middleware.js';
import { bodyNumber, bodyString, queryNumber } from './input.js';

export const adminRouter = express.Router();

// 로그인은 토큰이 없는 상태로 호출하므로 requireAdmin보다 먼저 등록합니다.
adminRouter.post('/login', (req, res) => {
    res.json({ token: res.locals.store.login(bodyString(req.body, 'password')) });
});

adminRouter.use(requireAdmin);

adminRouter.put('/mood', (req, res) => {
    const catalog = res.locals.store.setMood(
        bodyNumber(req.body, 'valence') ?? Number.NaN,
        bodyNumber(req.body, 'arousal') ?? Number.NaN,
        bodyNumber(req.body, 'n'),
    );
    res.json(catalog);
});

adminRouter.get('/mood/preview', (req, res) => {
    const tracks = res.locals.store.getPreview(
        queryNumber(req.query.valence) ?? Number.NaN,
        queryNumber(req.query.arousal) ?? Number.NaN,
        queryNumber(req.query.n),
    );
    res.json(tracks);
});

adminRouter.get('/fallback-track', (req, res) => {
    res.json(res.locals.store.getFallbackTrack());
});

adminRouter.put('/now-playing', (req, res) => {
    res.json({ nowPlaying: res.locals.store.reportNowPlaying(bodyString(req.body, 'spotifyId')) });
});

adminRouter.delete('/queue/:queueId', (req, res) => {
    res.locals.store.removeQueueItem(req.params.queueId);
    res.status(204).end();
});
