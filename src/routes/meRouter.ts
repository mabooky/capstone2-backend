import express from 'express';
import { countTrackRequestsByUser, findTrackRequestsByUser } from '../db/trackRequestRepository.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../middleware.js';
import type { TrackLibrary } from '../tracks/trackLibrary.js';
import { queryNumber } from './input.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function invalid(message: string): ApiError {
    return new ApiError(400, 'INVALID_INPUT', message);
}

/** 로그인한 사용자 자신에 관한 API입니다. 매장과 무관하므로 /api/me에 연결합니다. */
export function createMeRouter(trackLibrary: TrackLibrary): express.Router {
    const meRouter = express.Router();

    meRouter.get('/requests', requireUser, async (req, res) => {
        const userId = res.locals.user!.id;
        const limit = queryNumber(req.query.limit) ?? DEFAULT_LIMIT;
        const offset = queryNumber(req.query.offset) ?? 0;
        const storeId = req.query.storeId;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
            throw invalid(`limit은 1 이상 ${MAX_LIMIT} 이하의 정수여야 합니다.`);
        }
        if (!Number.isInteger(offset) || offset < 0) {
            throw invalid('offset은 0 이상의 정수여야 합니다.');
        }
        if (storeId !== undefined && (typeof storeId !== 'string' || storeId.trim() === '')) {
            throw invalid('storeId의 형식이 올바르지 않습니다.');
        }

        const [rows, total] = await Promise.all([
            findTrackRequestsByUser(userId, { storeId, limit, offset }),
            countTrackRequestsByUser(userId, storeId),
        ]);
        // 곡 라이브러리에서 찾을 수 없는 행은 정상적으로는 없지만, 있으면 목록에서 뺍니다.
        const requests = rows.flatMap(row => {
            const track = trackLibrary.get(row.spotify_id);
            if (track === undefined) return [];
            return [{
                requestId: row.id,
                storeId: row.store_id,
                storeName: row.store_name,
                track,
                requestedAt: row.requested_at.getTime(),
            }];
        });
        res.json({ total, requests });
    });

    return meRouter;
}
