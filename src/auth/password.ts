import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// 저장 형식은 `scrypt$N$r$p$salt$hash`이며 salt와 hash는 base64입니다.
// scripts/stores.mjs의 hashPassword도 같은 형식이어야 합니다. 한쪽을 바꾸면 다른 쪽도 함께 바꿔야 합니다.
const COST = { N: 2 ** 17, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 32;
// scrypt가 요구하는 메모리(128 * N * r)가 기본 한도(32MiB)를 넘으므로 한도를 올립니다.
const MAX_MEMORY = 256 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer, keyBytes: number, cost: typeof COST): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, keyBytes, { ...cost, maxmem: MAX_MEMORY }, (error, key) => (error ? reject(error) : resolve(key)));
    });
}

/** 비밀번호를 `scrypt$N$r$p$salt$hash` 형식으로 해시합니다. */
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey(password, salt, KEY_BYTES, COST);
    return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** 비밀번호가 저장된 해시와 일치하는지 확인합니다. 해시 형식이 올바르지 않으면 false를 반환합니다. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return false;

    const expected = Buffer.from(hash, 'base64');
    const cost = { N: Number(n), r: Number(r), p: Number(p) };
    if (expected.length === 0 || !Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) {
        return false;
    }

    const actual = await deriveKey(password, Buffer.from(salt, 'base64'), expected.length, cost).catch(() => null);
    return actual !== null && timingSafeEqual(actual, expected);
}
