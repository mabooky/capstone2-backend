export type ErrorCode =
    | 'INVALID_INPUT'
    | 'MISSING_CLIENT_ID'
    | 'UNAUTHORIZED'
    | 'INVALID_CREDENTIALS'
    | 'OUT_OF_MOOD'
    | 'STORE_NOT_FOUND'
    | 'TRACK_NOT_FOUND'
    | 'QUEUE_ITEM_NOT_FOUND'
    | 'TRACK_ALREADY_QUEUED'
    | 'MY_REQUEST_PENDING'
    | 'NOT_NEXT_IN_QUEUE'
    | 'NO_TRACKS'
    | 'TRACK_COOLDOWN';

/** API 명세의 에러 응답으로 변환되는 오류입니다. 던지면 errorHandler가 응답을 만듭니다. */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: ErrorCode,
        message: string,
        readonly retryAfterSec?: number,
    ) {
        super(message);
    }
}
