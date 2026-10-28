import { createServer } from 'node:http';
import { createApp } from './app.js';

const { app, close } = createApp();
const httpServer = createServer(app);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
        httpServer.close(() => {
            void close().catch(() => { process.exitCode = 1; });
        });
    });
}
