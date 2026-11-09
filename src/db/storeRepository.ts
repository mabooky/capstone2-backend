import { pool } from './connectionPool.js';

export interface StoreRecord {
    id: string;
    name: string;
    /** `scrypt$N$r$p$salt$hash` 형식의 관리자 비밀번호 해시입니다. */
    adminPasswordHash: string;
}

/** 등록된 모든 매장을 등록 순서대로 읽습니다. */
export async function findAllStores(): Promise<StoreRecord[]> {
    const result = await pool.query<{ id: string; name: string; admin_password_hash: string }>(
        'SELECT id, name, admin_password_hash FROM stores ORDER BY created_at, id',
    );
    return result.rows.map(row => ({ id: row.id, name: row.name, adminPasswordHash: row.admin_password_hash }));
}
