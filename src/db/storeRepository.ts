import { pool } from './connectionPool.js';

export interface StoreRow {
    id: string;
    name: string;
    /** `scrypt$N$r$p$salt$hash` 형식의 관리자 비밀번호 해시입니다. */
    admin_password_hash: string;
}

/** 등록된 모든 매장을 등록 순서대로 읽습니다. */
export async function findAllStores(): Promise<StoreRow[]> {
    const result = await pool.query<StoreRow>(
        'SELECT id, name, admin_password_hash FROM stores ORDER BY created_at, id',
    );
    return result.rows;
}
