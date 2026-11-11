import express from 'express';
import { fetchKakaoProfile } from '../auth/kakao.js';
import { SESSION_TTL_MS, generateSessionToken, hashSessionToken } from '../auth/sessionToken.js';
import { deleteSession, insertSession } from '../db/sessionRepository.js';
import { findOrCreateUser, updateNickname } from '../db/userRepository.js';
import { bodyString } from './input.js';
import { requireUser } from '../middleware.js';

export const authRouter = express.Router();

authRouter.post('/kakao/login', async (req, res) => {
    const kakaoProfile = await fetchKakaoProfile(bodyString(req.body, 'code'));
    const user = await findOrCreateUser('kakao', kakaoProfile.id, kakaoProfile.nickname);
    // 카카오에서 닉네임을 바꿨다면 로그인할 때 반영합니다.
    if (user.nickname !== kakaoProfile.nickname) await updateNickname(user.id, kakaoProfile.nickname);

    const token = generateSessionToken();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    await insertSession(hashSessionToken(token), user.id, new Date(expiresAt));
    res.json({ token, expiresAt, user: { nickname: kakaoProfile.nickname } });
});

authRouter.post('/logout', requireUser, async (req, res) => {
    await deleteSession(res.locals.sessionHash!);
    res.status(204).end();
});
