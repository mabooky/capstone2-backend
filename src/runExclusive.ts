/**
 * 같은 키의 비동기 작업을 한 번에 하나씩, 호출한 순서대로 실행하는 함수를 만듭니다.
 * 키가 다르면 서로 기다리지 않고, 앞선 작업이 실패해도 다음 작업은 실행됩니다.
 * 호출한 쪽에는 자기 작업의 결과(또는 오류)가 그대로 돌아갑니다.
 */
export function createRunExclusive(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
    // 키별로 가장 마지막에 줄 선 작업이 끝나면 이행되는 Promise입니다. 실패하지 않도록 만들어 둡니다.
    const tails = new Map<string, Promise<void>>();

    return (key, task) => {
        const previous = tails.get(key) ?? Promise.resolve();
        const result = previous.then(task);
        const tail = result.then(() => {}, () => {});
        tails.set(key, tail);
        // 뒤에 줄 선 작업이 없으면 키를 지워서 맵이 계속 커지지 않게 합니다.
        void tail.then(() => {
            if (tails.get(key) === tail) tails.delete(key);
        });
        return result;
    };
}
