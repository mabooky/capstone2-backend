import type { Store } from '../store.js';

declare global {
    namespace Express {
        interface Locals {
            /** resolveStore가 :storeId로 찾아 담아 둔 매장입니다. */
            store: Store;
        }
    }
}
