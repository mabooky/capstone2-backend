import { pool } from './connectionPool.js';
import type { UserRow } from './userRepository.js';

/** 세션을 저장합니다. tokenHash는 토큰 원문이 아니라 SHA-256 해시입니다. */
export async function insertSession(tokenHash: Buffer, userId: string, expiresAt: Date): Promise<void> {
    await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, expiresAt]);
}

/** 만료되지 않은 세션의 사용자를 찾습니다. 세션이 없거나 만료되었으면 null입니다. 만료는 DB의 현재 시각으로 판단합니다. */
export async function findUserBySessionHash(tokenHash: Buffer): Promise<UserRow | null> {
    const result = await pool.query<UserRow>(
        `SELECT u.id, u.nickname
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [tokenHash],
    );
    return result.rows[0] ?? null;
}

/** 세션을 삭제합니다. 이미 없는 세션이어도 오류가 아닙니다. */
export async function deleteSession(tokenHash: Buffer): Promise<void> {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}
