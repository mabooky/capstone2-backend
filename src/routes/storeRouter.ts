import express from 'express';
import { requireClientId } from '../middleware.js';
import { adminRouter } from './adminRouter.js';
import { bodyString, queryNumber, queryString } from './input.js';

export const storeRouter = express.Router({ mergeParams: true });

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

// X-Client-Id는 선택입니다. 없으면 모든 항목의 mine이 false입니다.
storeRouter.get('/queue', (req, res) => {
    const clientId = req.get('X-Client-Id')?.trim() || undefined;
    res.json(res.locals.store.getQueue(clientId));
});

storeRouter.post('/queue', requireClientId, (req, res) => {
    const entry = res.locals.store.enqueue(res.locals.clientId, bodyString(req.body, 'spotifyId'));
    res.status(201).json(entry);
});

storeRouter.get('/me', requireClientId, (req, res) => {
    res.json(res.locals.store.getMe(res.locals.clientId));
});

storeRouter.use('/admin', adminRouter);
