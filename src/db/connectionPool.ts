import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL 환경변수가 필요합니다.');

const isLocal = ['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname);

/**
 * 서버 전체가 공유하는 DB 연결 풀입니다.
 * DATABASE_URL이 필요하므로, 환경변수를 읽는 dotenv/config를 이 모듈보다 먼저 불러와야 합니다.
 */
export const pool = new pg.Pool({
    connectionString: databaseUrl,
    // 로컬 DB가 아니면 SSL로 접속합니다. 인증서 검증이 필요 없는 환경은 DATABASE_SSL=false로 끌 수 있습니다.
    ssl: isLocal || process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 5000,
});

// 유휴 연결이 끊길 때 발생하는 error 이벤트를 처리하지 않으면 프로세스가 종료됩니다.
pool.on('error', error => {
    console.error('유휴 DB 연결에서 오류가 발생했습니다.', error);
});

/** 모든 연결을 닫습니다. 서버를 종료할 때 호출합니다. */
export function closePool(): Promise<void> {
    return pool.end();
}
