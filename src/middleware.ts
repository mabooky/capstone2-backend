import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError } from './errors.js';
import type { Store } from './store.js';

/** 요청 처리 중 발생한 오류를 명세의 에러 응답 형식으로 바꿉니다. 모든 라우터 뒤에 등록해야 합니다. */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
    if (res.headersSent) {
        next(error);
        return;
    }

    if (error instanceof ApiError) {
        res.status(error.status).json({
            error: {
                code: error.code,
                message: error.message,
                ...(error.retryAfterSec !== undefined && { retryAfterSec: error.retryAfterSec }),
            },
        });
        return;
    }

    // body-parser가 던지는 요청 본문 오류(잘못된 JSON, 너무 큰 본문 등)를 처리합니다.
    if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500 && error.expose) {
        res.status(400).json({ error: { code: 'INVALID_INPUT', message: '요청 본문의 형식이 올바르지 않습니다.' } });
        return;
    }

    console.error(error);
    
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '서버에서 예상하지 못한 오류가 발생했습니다.' } });
};

/** :storeId에 해당하는 매장을 찾아 res.locals.store에 담습니다. 매장이 없으면 404 STORE_NOT_FOUND를 반환합니다. */
export function resolveStore(stores: ReadonlyMap<string, Store>): RequestHandler {
    return (req, res, next) => {
        const storeId = req.params.storeId;
        const store = typeof storeId === 'string' ? stores.get(storeId) : undefined;
        if (store === undefined) {
            throw new ApiError(404, 'STORE_NOT_FOUND', '등록되지 않은 매장입니다.');
        }
        res.locals.store = store;
        next();
    };
}

/** X-Client-Id 헤더를 읽어 res.locals.clientId에 담습니다. 헤더가 없으면 400 MISSING_CLIENT_ID를 반환합니다. */
export const requireClientId: RequestHandler = (req, res, next) => {
    const clientId = req.get('X-Client-Id')?.trim();
    if (!clientId) {
        throw new ApiError(400, 'MISSING_CLIENT_ID', '요청 헤더에 X-Client-Id가 필요합니다.');
    }
    res.locals.clientId = clientId;
    next();
};

/** Authorization: Bearer 토큰이 매장의 현재 관리자 토큰인지 확인합니다. 아니면 401 UNAUTHORIZED를 반환합니다. resolveStore 뒤에 등록해야 합니다. */
export const requireAdmin: RequestHandler = (req, res, next) => {
    const token = /^Bearer (.+)$/i.exec(req.get('Authorization') ?? '')?.[1];
    if (token === undefined || !res.locals.store.isAdminToken(token)) {
        throw new ApiError(401, 'UNAUTHORIZED', '관리자 인증이 필요합니다.');
    }
    next();
};
