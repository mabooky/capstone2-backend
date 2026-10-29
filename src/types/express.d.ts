import type { Store } from '../store.js';

declare global {
    namespace Express {
        interface Locals {
            /** resolveStore가 :storeId로 찾아 담아 둔 매장입니다. */
            store: Store;
            /** requireClientId가 X-Client-Id 헤더에서 읽어 담아 둔 고객 식별자입니다. */
            clientId: string;
        }
    }
}
