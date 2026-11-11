import express from 'express';
import { optionalUser, requireUser } from '../middleware.js';
import { adminRouter } from './adminRouter.js';
import { bodyString, queryNumber, queryString } from './input.js';

export const storeRouter = express.Router({ mergeParams: true });

storeRouter.get('/', (req, res) => {
    const store = res.locals.store;
    res.json({ storeId: store.id, name: store.name });
});

storeRouter.get('/mood', (req, res) => {
    res.json(res.locals.store.getMood());
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

storeRouter.post('/queue', requireUser, (req, res) => {
    const entry = res.locals.store.enqueue(res.locals.user!.id, bodyString(req.body, 'spotifyId'));
    res.status(201).json(entry);
});

storeRouter.get('/me', optionalUser, (req, res) => {
    res.json(res.locals.store.getMe(res.locals.user?.id));
});

storeRouter.use('/admin', adminRouter);
