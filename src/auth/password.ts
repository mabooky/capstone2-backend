import { scrypt, timingSafeEqual } from 'node:crypto';

// scrypt가 요구하는 메모리(128 * N * r)가 기본 한도(32MiB)를 넘으므로 한도를 올립니다.
const MAX_MEMORY = 256 * 1024 * 1024;

/**
 * 비밀번호가 저장된 해시와 일치하는지 확인합니다.
 * 해시 형식은 `scrypt$N$r$p$salt$hash`이며 salt와 hash는 base64입니다. 형식이 올바르지 않으면 false를 반환합니다.
 *
 * scripts/stores.mjs의 hashPassword와 형식이 같아야 합니다. 한쪽을 바꾸면 다른 쪽도 함께 바꿔야 합니다.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return false;

    const expected = Buffer.from(hash, 'base64');
    const params = { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEMORY };
    if (expected.length === 0 || !Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
        return false;
    }

    const actual = await new Promise<Buffer | null>(resolve => {
        scrypt(password, Buffer.from(salt, 'base64'), expected.length, params, (error, key) => resolve(error ? null : key));
    });
    return actual !== null && timingSafeEqual(actual, expected);
}
