// 매장을 조회하고 관리합니다.
//
// 명령:
//   list: 매장 목록을 출력합니다.
//   add <이름>: 매장을 등록합니다. 매장 ID는 무작위로 생성하고, 관리자 비밀번호는 프롬프트로 입력받습니다.
//   rename <ID> <이름>: 매장 이름을 바꿉니다.
//   set-password <ID>: 관리자 비밀번호를 다시 설정합니다.
//
// 옵션:
//   --yes: DB를 변경합니다. 지정하지 않으면 변경 없이 대상만 출력합니다. (list는 해당 없음)
//
// 환경변수: DATABASE_URL, DATABASE_SSL=false
//
// 주의: src 내부로 의존성이 향하는 문제를 막고자 비밀번호 해시 로직을 중복 구현했습니다.
// 로직을 바꿀 때는 서버 내 검증 로직도 함께 바꿔야 합니다.

import { randomBytes, scryptSync } from 'node:crypto';

const USAGE = `사용법:
  node --env-file=.env scripts/stores.mjs list
  node --env-file=.env scripts/stores.mjs add <이름> [--yes]
  node --env-file=.env scripts/stores.mjs rename <ID> <이름> [--yes]
  node --env-file=.env scripts/stores.mjs set-password <ID> [--yes]`;

const ID_LENGTH = 8;
const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // 32자. 혼동하기 쉬운 i, l, o, u 제외
const NAME_MAX_LENGTH = 50;

const SCRYPT = { N: 2 ** 17, r: 8, p: 1, saltBytes: 16, keyBytes: 32 };

function fail(message) {
    console.error(message);
    process.exit(1);
}

// ---------- 생성 ----------

// 바이트의 하위 5비트를 쓰므로 알파벳 32자에 치우침이 없습니다.
function generateStoreId() {
    const bytes = randomBytes(ID_LENGTH);
    return Array.from(bytes, byte => ID_ALPHABET[byte & 31]).join('');
}

/** `scrypt$N$r$p$salt$hash` 형식으로 해시합니다. salt와 hash는 base64입니다. */
function hashPassword(password) {
    const salt = randomBytes(SCRYPT.saltBytes);
    const hash = scryptSync(password, salt, SCRYPT.keyBytes, {
        N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
        maxmem: 256 * 1024 * 1024, // 기본 한도(32MiB)가 N=2^17에는 부족합니다.
    });
    return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

// ---------- 입력 ----------

/** 입력을 화면에 표시하지 않고 한 줄을 읽습니다. 터미널에서만 동작합니다. */
function readSecret(prompt) {
    if (!process.stdin.isTTY) fail('비밀번호는 터미널에서 직접 입력해야 합니다.');
    return new Promise(resolve => {
        let value = '';
        process.stdout.write(prompt);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        const onData = chunk => {
            for (const char of chunk) {
                if (char === '\r' || char === '\n') {
                    process.stdin.setRawMode(false);
                    process.stdin.pause();
                    process.stdin.off('data', onData);
                    process.stdout.write('\n');
                    resolve(value);
                    return;
                }
                if (char === '\u0003') { // Ctrl-C
                    process.stdin.setRawMode(false);
                    process.stdout.write('\n');
                    process.exit(130);
                }
                if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
                else value += char;
            }
        };
        process.stdin.on('data', onData);
    });
}

async function readNewPassword() {
    const password = await readSecret('관리자 비밀번호: ');
    if (password.length < 4) fail('비밀번호는 4자 이상이어야 합니다.');
    const confirm = await readSecret('비밀번호 확인: ');
    if (password !== confirm) fail('비밀번호가 일치하지 않습니다.');
    return password;
}

function validateName(name) {
    if (!name || name.trim() === '') fail(`매장 이름이 필요합니다.\n${USAGE}`);
    if (name.length > NAME_MAX_LENGTH) fail(`매장 이름은 ${NAME_MAX_LENGTH}자 이하여야 합니다.`);
}

// ---------- DB ----------

async function connect() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) fail('DATABASE_URL 환경변수가 필요합니다.\n.env 파일에 적고 --env-file=.env 옵션으로 실행해 주십시오.');
    let url;
    try {
        url = new URL(databaseUrl);
    } catch {
        fail('DATABASE_URL의 형식이 올바르지 않습니다. (값은 출력하지 않습니다.)');
    }
    console.log(`대상 DB: ${url.hostname}:${url.port || '5432'}/${url.pathname.slice(1)}`);
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    const ssl = isLocal || process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: databaseUrl, ssl });
    await client.connect();
    return client;
}

async function findStore(client, id) {
    const { rows } = await client.query('SELECT id, name FROM stores WHERE id = $1', [id]);
    if (rows.length === 0) fail(`매장을 찾을 수 없습니다: ${id}`);
    return rows[0];
}

// ---------- 명령 ----------

async function list(client) {
    const { rows } = await client.query('SELECT id, name, created_at FROM stores ORDER BY created_at, id');
    if (rows.length === 0) {
        console.log('등록된 매장이 없습니다.');
        return;
    }
    for (const row of rows) console.log(`${row.id}  ${row.name}  (${row.created_at.toISOString()})`);
    console.log(`총 ${rows.length}개`);
}

async function add(client, name, yes) {
    validateName(name);
    if (!yes) {
        console.log(`등록할 매장: ${name}\n실제로 등록하려면 --yes 옵션을 붙여 다시 실행해 주십시오. (DB는 바꾸지 않았습니다.)`);
        return;
    }
    const passwordHash = hashPassword(await readNewPassword());
    // ID가 충돌하면 새 ID로 다시 시도합니다. 충돌이 아닌 오류는 그대로 던집니다.
    for (;;) {
        const id = generateStoreId();
        const { rows } = await client.query(
            'INSERT INTO stores (id, name, admin_password_hash) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id',
            [id, name, passwordHash],
        );
        if (rows.length > 0) {
            console.log(`매장을 등록했습니다: ${id} (${name})`);
            return;
        }
    }
}

async function rename(client, id, name, yes) {
    validateName(name);
    const store = await findStore(client, id);
    if (!yes) {
        console.log(`이름 변경: ${store.name} -> ${name}\n실제로 변경하려면 --yes 옵션을 붙여 다시 실행해 주십시오. (DB는 바꾸지 않았습니다.)`);
        return;
    }
    await client.query('UPDATE stores SET name = $2 WHERE id = $1', [id, name]);
    console.log(`이름을 변경했습니다: ${id} (${store.name} -> ${name})`);
}

async function setPassword(client, id, yes) {
    const store = await findStore(client, id);
    if (!yes) {
        console.log(`비밀번호를 재설정할 매장: ${store.id} (${store.name})\n실제로 변경하려면 --yes 옵션을 붙여 다시 실행해 주십시오. (DB는 바꾸지 않았습니다.)`);
        return;
    }
    const passwordHash = hashPassword(await readNewPassword());
    await client.query('UPDATE stores SET admin_password_hash = $2 WHERE id = $1', [id, passwordHash]);
    console.log(`비밀번호를 변경했습니다: ${store.id} (${store.name})`);
}

// ---------- 진입점 ----------

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const [command, ...rest] = args.filter(arg => arg !== '--yes');
if (rest.some(arg => arg.startsWith('--'))) fail(`알 수 없는 옵션입니다.\n${USAGE}`);

const commands = {
    list: client => list(client),
    add: client => add(client, rest[0], yes),
    rename: client => rename(client, rest[0], rest[1], yes),
    'set-password': client => setPassword(client, rest[0], yes),
};
if (!commands[command]) fail(USAGE);
if ((command === 'rename' && rest.length !== 2) || (['add', 'set-password'].includes(command) && rest.length !== 1)) fail(USAGE);

const client = await connect();
try {
    await commands[command](client);
} finally {
    await client.end();
}
