import { ApiError } from '../errors.js';

/** 요청 입력의 형식을 변환하고 확인하는 도구입니다. 값의 범위 같은 의미 검사는 Store가 합니다. */

function invalid(message: string): ApiError {
    return new ApiError(400, 'INVALID_INPUT', message);
}

/** 쿼리 문자열을 숫자로 바꿉니다. 없으면 undefined이고, 숫자가 아니면 NaN입니다. */
export function queryNumber(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    return typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
}

/** 필수 쿼리 문자열을 읽습니다. */
export function queryString(value: unknown, name: string): string {
    if (typeof value !== 'string') throw invalid(`${name} 쿼리 파라미터가 필요합니다.`);
    return value;
}

/** 요청 본문에서 필수 문자열 항목을 읽습니다. */
export function bodyString(body: unknown, key: string): string {
    const value = (body as Record<string, unknown> | undefined)?.[key];
    if (typeof value !== 'string' || value.trim() === '') throw invalid(`${key}의 형식이 올바르지 않습니다.`);
    return value;
}

/** 요청 본문에서 숫자 항목을 읽습니다. 없으면 undefined이고, 숫자가 아니면 오류입니다. */
export function bodyNumber(body: unknown, key: string): number | undefined {
    const value = (body as Record<string, unknown> | undefined)?.[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'number') throw invalid(`${key}의 형식이 올바르지 않습니다.`);
    return value;
}
