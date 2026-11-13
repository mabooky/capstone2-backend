import express from 'express';
import { verifyPassword } from '../auth/password.js';
import { ApiError } from '../errors.js';
import { requireAdmin } from '../middleware.js';
import { bodyString, regionQuery } from './input.js';
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
    res.json(res.locals.store.setRegionCatalog(parseCatalogRequest(req.body)));
});

adminRouter.get('/mood/preview', (req, res) => {
    res.json(res.locals.store.getRegionPreview(regionQuery(req.query)));
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
