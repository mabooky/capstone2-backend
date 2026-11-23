import express from 'express';
import { insertTrackRequest } from '../db/trackRequestRepository.js';
import { ApiError } from '../errors.js';
import { optionalUser, requireUser } from '../middleware.js';
import type { TrackLibrary } from '../tracks/trackLibrary.js';
import type { TrackRatings } from '../tracks/trackRatings.js';
import { adminRouter } from './adminRouter.js';
import { bodyRating, bodyString, queryNumber, queryString } from './input.js';

/** 매장 하나에 대한 고객용 API입니다. 곡 평가를 확인하고 저장하려면 곡 라이브러리와 평가 모음이 필요합니다. */
export function createStoreRouter(trackLibrary: TrackLibrary, trackRatings: TrackRatings): express.Router {
    const storeRouter = express.Router({ mergeParams: true });

    storeRouter.get('/', (req, res) => {
        const store = res.locals.store;
        res.json({ storeId: store.id, name: store.name });
    });

    storeRouter.get('/catalog/config', (req, res) => {
        res.json(res.locals.store.getCatalogConfig());
    });

    // 로그인은 선택입니다. 로그인하지 않았으면 모든 곡의 myRating이 null입니다.
    storeRouter.get('/catalog', optionalUser, (req, res) => {
        res.json(res.locals.store.getCatalog(res.locals.user?.id));
    });

    storeRouter.get('/search', optionalUser, (req, res) => {
        const q = queryString(req.query.q, 'q');
        const result = res.locals.store.search(q, queryNumber(req.query.limit), queryNumber(req.query.offset), res.locals.user?.id);
        res.json({ query: q, ...result });
    });

    // 로그인은 선택입니다. 로그인하지 않았으면 모든 항목의 mine이 false이고 모든 곡의 myRating이 null입니다.
    storeRouter.get('/state', optionalUser, (req, res) => {
        res.json(res.locals.store.getState(res.locals.user?.id));
    });

    storeRouter.post('/queue', requireUser, async (req, res) => {
        const store = res.locals.store;
        const userId = res.locals.user!.id;
        const id = bodyString(req.body, 'id');

        const entry = store.enqueue(userId, id);
        // 이력은 부가 정보이므로 저장에 실패해도 이미 접수된 신청은 성공으로 응답합니다.
        try {
            await insertTrackRequest(userId, store.id, id);
        } catch (error) {
            console.error('곡 신청 이력을 저장하지 못했습니다.', error);
        }
        res.status(201).json(entry);
    });

    storeRouter.get('/me', optionalUser, (req, res) => {
        res.json(res.locals.store.getMe(res.locals.user?.id));
    });

    // 곡을 추천(1)하거나 비추천(-1)으로 평가합니다. 이미 평가한 곡이면 값을 바꿉니다.
    storeRouter.put('/ratings/:id', requireUser, async (req, res) => {
        const store = res.locals.store;
        const userId = res.locals.user!.id;
        const id = req.params.id;
        const rating = bodyRating(req.body, 'rating');

        if (trackLibrary.get(id) === undefined) {
            throw new ApiError(404, 'TRACK_NOT_FOUND', '등록되지 않은 곡입니다.');
        }
        // 새 평가는 지금 재생 중인 곡에만 남길 수 있습니다. 이미 평가한 곡(취소한 곡 포함)은 재생 중이 아니어도 바꿀 수 있습니다.
        if (!store.isNowPlaying(id) && trackRatings.get(store.id, userId, id) === undefined) {
            throw new ApiError(409, 'NOT_NOW_PLAYING', '지금 재생 중인 곡만 새로 평가할 수 있습니다.');
        }

        await trackRatings.set(store.id, userId, id, rating);
        res.status(204).end();
    });

    // 평가를 취소합니다. 행을 지우지 않고 0으로 바꾸므로, 취소한 곡도 재생 중이 아니어도 다시 평가할 수 있습니다.
    storeRouter.delete('/ratings/:id', requireUser, async (req, res) => {
        const store = res.locals.store;
        const userId = res.locals.user!.id;
        const id = req.params.id;

        if (trackLibrary.get(id) === undefined) {
            throw new ApiError(404, 'TRACK_NOT_FOUND', '등록되지 않은 곡입니다.');
        }
        // 평가한 적이 없거나 이미 취소한 곡은 바꿀 것이 없으므로 그대로 성공으로 처리합니다.
        const current = trackRatings.get(store.id, userId, id);
        if (current !== undefined && current !== 0) {
            await trackRatings.set(store.id, userId, id, 0);
        }
        res.status(204).end();
    });

    storeRouter.use('/admin', adminRouter);

    return storeRouter;
}
