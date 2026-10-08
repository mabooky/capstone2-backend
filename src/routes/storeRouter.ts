import express from 'express';
import { Track } from '../models/track.js';

const EXAMPLE_TRACK: Track = {
    reccobeatsId: "2cd9d8ed-15b3-4719-bfa7-bdb5fe77cd1f",
    spotifyId: "11dFghVXANMlKmJXsNCbNl",
    title: "Cut To The Feeling",
    artist: "Carly Rae Jepsen",
    duration: 207959,
    albumImageUrl: 'https://i.scdn.co/image/ab67616d0000b2737359994525d219f64872d3b1',
    valence: 0.648,
    arousal: 0.909,
    requestStatus: 'available'
};

export const storeRouter = express.Router({ mergeParams: true });

// 신청 가능 곡(카탈로그) 조회
storeRouter.get('/catalog', (req, res, next) => {
    res.status(200).json([EXAMPLE_TRACK]);
    next();
});

// 전체 곡 조회(엔드포인트를 /stores/:storeId/ 아래에 두어 매장 별 신청 가능 여부까지 반환)
storeRouter.get('/tracks', (req, res, next) => {
    res.status(200).json([EXAMPLE_TRACK]);
    next();
});