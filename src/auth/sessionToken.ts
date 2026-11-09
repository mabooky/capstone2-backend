import { createHash, randomBytes } from 'node:crypto';

/** 세션 유효 기간입니다. 활동해도 연장하지 않는 고정 만료입니다. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 256비트 무작위 세션 토큰을 만듭니다. 헤더에 그대로 실을 수 있는 base64url 문자열입니다. */
export function generateSessionToken(): string {
    return randomBytes(32).toString('base64url');
}

/**
 * 세션 토큰의 SHA-256 해시를 돌려줍니다. DB에는 토큰 원문 대신 이 값을 저장합니다.
 * 토큰이 충분히 무작위라 느린 해시나 상수 시간 비교는 필요하지 않습니다.
 */
export function hashSessionToken(token: string): Buffer {
    return createHash('sha256').update(token).digest();
}
