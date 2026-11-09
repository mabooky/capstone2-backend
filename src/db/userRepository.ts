import { pool } from './connectionPool.js';

export interface UserRow {
    id: string;
    nickname: string;
}

async function findUserByIdentity(provider: string, providerUserId: string): Promise<UserRow | null> {
    const result = await pool.query<UserRow>(
        `SELECT u.id, u.nickname
         FROM auth_identities i
         JOIN users u ON u.id = i.user_id
         WHERE i.provider = $1 AND i.provider_user_id = $2`,
        [provider, providerUserId],
    );
    return result.rows[0] ?? null;
}

/**
 * 외부 로그인 계정에 연결된 사용자를 찾고, 없으면 새로 만듭니다. 기존 사용자의 닉네임은 바꾸지 않습니다.
 * 같은 계정의 첫 로그인이 동시에 들어오면 한쪽만 사용자를 만들고, 다른 쪽은 그 사용자를 돌려받습니다.
 */
export async function findOrCreateUser(provider: string, providerUserId: string, nickname: string): Promise<UserRow> {
    const existing = await findUserByIdentity(provider, providerUserId);
    if (existing !== null) return existing;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const created = await client.query<UserRow>('INSERT INTO users (nickname) VALUES ($1) RETURNING id, nickname', [nickname]);
        const user = created.rows[0];
        const linked = await client.query(
            'INSERT INTO auth_identities (provider, provider_user_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [provider, providerUserId, user.id],
        );
        if (linked.rowCount === 0) {
            // 동시에 들어온 다른 요청이 먼저 만들었으므로 방금 만든 사용자는 버리고 그 사용자를 사용합니다.
            await client.query('ROLLBACK');
            const winner = await findUserByIdentity(provider, providerUserId);
            if (winner === null) throw new Error('로그인 계정에 연결된 사용자를 찾지 못했습니다.');
            return winner;
        }
        await client.query('COMMIT');
        return user;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}
