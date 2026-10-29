// 환경변수를 읽는 이 줄이 library.js(DB 접속)를 불러오는 app.js보다 먼저 와야 합니다.
import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { library } from './library.js';

// library.js를 import하는 시점에 이미 library 초기화가 완료되어 있음
console.log(`곡 ${library.size}개를 불러왔습니다.`);

const app = createApp();
const httpServer = createServer(app);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
        httpServer.close();
    });
}
