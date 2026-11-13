import express from 'express';
import { insertTrackRequest } from '../db/trackRequestRepository.js';
import { optionalUser, requireUser } from '../middleware.js';
import { adminRouter } from './adminRouter.js';
import { bodyString, queryNumber, queryString } from './input.js';

export const storeRouter = express.Router({ mergeParams: true });

storeRouter.get('/', (req, res) => {
    const store = res.locals.store;
    res.json({ storeId: store.id, name: store.name });
});

storeRouter.get('/mood', (req, res) => {
    res.json(res.locals.store.getRegion());
});

storeRouter.get('/catalog', (req, res) => {
    res.json(res.locals.store.getCatalog());
});

storeRouter.get('/search', (req, res) => {
    const q = queryString(req.query.q, 'q');
    const result = res.locals.store.search(q, queryNumber(req.query.limit), queryNumber(req.query.offset));
    res.json({ query: q, ...result });
});

// 로그인은 선택입니다. 로그인하지 않았으면 모든 항목의 mine이 false입니다.
storeRouter.get('/state', optionalUser, (req, res) => {
    res.json(res.locals.store.getState(res.locals.user?.id));
});

storeRouter.post('/queue', requireUser, async (req, res) => {
    const store = res.locals.store;
    const userId = res.locals.user!.id;
    const spotifyId = bodyString(req.body, 'spotifyId');

    const entry = store.enqueue(userId, spotifyId);
    // 이력은 부가 정보이므로 저장에 실패해도 이미 접수된 신청은 성공으로 응답합니다.
    try {
        await insertTrackRequest(userId, store.id, spotifyId);
    } catch (error) {
        console.error('곡 신청 이력을 저장하지 못했습니다.', error);
    }
    res.status(201).json(entry);
});

storeRouter.get('/me', optionalUser, (req, res) => {
    res.json(res.locals.store.getMe(res.locals.user?.id));
});

storeRouter.use('/admin', adminRouter);
