import express from 'express';
import { createServer } from 'node:http';

const app = express();
const httpServer = createServer(app);

app.get('/', (req, res) => {
    console.log(req.body);
    res.send('Hello, World!');
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});