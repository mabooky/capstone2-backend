import express from 'express';
import { createServer } from 'node:http';
import cors from 'cors';
import { storeRouter } from './routes/storeRouter.js';

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

// 헬스 체크 엔드포인트
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

app.use('/api/stores/:storeId', storeRouter);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});