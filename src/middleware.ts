import type { ErrorRequestHandler } from 'express';
import { ApiError } from './errors.js';

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
