export function murmur3(input: string, seed: number = 0): number {
    const bytes = Buffer.from(input, 'utf8');
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    const rotateLeft = (value: number, bits: number) => (value << bits) | (value >>> (32 - bits));
    const mixBlock = (block: number) => Math.imul(rotateLeft(Math.imul(block, c1), 15), c2);

    let hash = seed >>> 0;
    const blockCount = bytes.length >>> 2;
    for (let i = 0; i < blockCount; i++) {
        hash ^= mixBlock(bytes.readUInt32LE(i * 4));
        hash = rotateLeft(hash, 13);
        hash = (Math.imul(hash, 5) + 0xe6546b64) | 0;
    }

    // 4바이트로 나누어떨어지지 않는 마지막 바이트들입니다.
    const tailStart = blockCount * 4;
    let tail = 0;
    switch (bytes.length & 3) {
        case 3:
            tail ^= bytes[tailStart + 2] << 16;
        // falls through
        case 2:
            tail ^= bytes[tailStart + 1] << 8;
        // falls through
        case 1:
            tail ^= bytes[tailStart];
            hash ^= mixBlock(tail);
    }

    hash ^= bytes.length;
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    return hash >>> 0;
}
