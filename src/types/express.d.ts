import type { Store } from '../store.js';
import type { UserRow } from '../db/userRepository.js';

declare global {
    namespace Express {
        interface Locals {
            /** resolveStore가 :storeId로 찾아 담아 둔 매장입니다. */
            store: Store;
            /** requireUser와 optionalUser가 담아 둔 로그인 사용자입니다. optionalUser 뒤에서는 없을 수 있습니다. */
            user?: UserRow;
            /** 로그인 세션 토큰의 SHA-256 해시입니다. user와 함께 담깁니다. */
            sessionHash?: Buffer;
        }
    }
}
