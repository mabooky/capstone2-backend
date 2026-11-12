import express from 'express';
import { verifyPassword } from '../auth/password.js';
import { ApiError } from '../errors.js';
import { requireAdmin } from '../middleware.js';
import { bodyNumber, bodyString, queryNumber, regionQuery } from './input.js';
import { parseCatalogRequest } from '../tracks/catalogRecommendation.js';

export const adminRouter = express.Router();

// 로그인은 토큰이 없는 상태로 호출하므로 requireAdmin보다 먼저 등록합니다.
adminRouter.post('/login', async (req, res) => {
    const store = res.locals.store;
    // 검증이 비동기이므로 Store의 메서드를 동기로 유지하기 위해 비밀번호 확인은 라우터에서 합니다.
    if (!await verifyPassword(bodyString(req.body, 'password'), store.adminPasswordHash)) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', '비밀번호가 올바르지 않습니다.');
    }
    res.json({ token: store.issueAdminToken() });
});

adminRouter.use(requireAdmin);

adminRouter.put('/mood', (req, res) => {
    if (req.body?.mode !== undefined) {
        res.json(res.locals.store.setRegionCatalog(parseCatalogRequest(req.body)));
        return;
    }
    // Temporary compatibility: requests without mode keep the v0.7 point/array contract.
    const catalog = res.locals.store.setMood(
        bodyNumber(req.body, 'valence') ?? Number.NaN,
        bodyNumber(req.body, 'arousal') ?? Number.NaN,
        bodyNumber(req.body, 'n'),
    );
    res.json(catalog);
});

adminRouter.get('/mood/preview', (req, res) => {
    if (req.query.mode !== undefined) {
        res.json(res.locals.store.getRegionPreview(regionQuery(req.query)));
        return;
    }
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
