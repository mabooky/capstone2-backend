import { ApiError } from '../errors.js';

const TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const USER_INFO_URL = 'https://kapi.kakao.com/v2/user/me';
const TIMEOUT_MS = 5000;

export interface KakaoProfile {
    /** 카카오 회원 번호입니다. */
    id: string;
    nickname: string;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
    return typeof value === 'object' && value !== null ? (value as JsonObject) : null;
}

function unavailable(): ApiError {
    return new ApiError(502, 'KAKAO_UNAVAILABLE', '카카오 서버와 통신하지 못했습니다.');
}

function readConfig() {
    const restApiKey = process.env.KAKAO_REST_API_KEY;
    const clientSecret = process.env.KAKAO_REST_API_CLIENT_SECRET;
    const redirectUri = process.env.KAKAO_REDIRECT_URI;
    if (!restApiKey || !clientSecret || !redirectUri) {
        throw new Error('KAKAO_REST_API_KEY, KAKAO_REST_API_CLIENT_SECRET, KAKAO_REDIRECT_URI 환경변수가 필요합니다.');
    }
    return { restApiKey, clientSecret, redirectUri };
}

async function request(step: string, url: string, init: RequestInit): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
        console.error(`카카오 ${step} 요청에 실패했습니다.`, error);
        throw unavailable();
    }
}

async function readJson(response: Response): Promise<JsonObject | null> {
    try {
        return asObject(await response.json());
    } catch {
        return null;
    }
}

/** 인가 코드를 카카오 액세스 토큰으로 바꿉니다. */
async function exchangeCode(code: string): Promise<string> {
    const { restApiKey, redirectUri, clientSecret } = readConfig();
    const form = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: restApiKey,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
    });

    const response = await request('토큰', TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: form,
    });
    const body = await readJson(response);
    if (!response.ok) {
        // 코드가 포함될 수 있는 error_description은 남기지 않습니다.
        console.error('카카오 토큰 요청이 거절되었습니다.', { status: response.status, error: body?.error, errorCode: body?.error_code });
        if (response.status >= 500) throw unavailable();
        throw new ApiError(401, 'INVALID_KAKAO_CODE', '카카오 인가 코드가 올바르지 않거나 만료되었습니다.');
    }
    const accessToken = body?.access_token;
    if (typeof accessToken !== 'string' || accessToken === '') {
        console.error('카카오 토큰 응답에 access_token이 없습니다.');
        throw unavailable();
    }
    return accessToken;
}

/**
 * 카카오 인가 코드로 로그인한 사용자의 회원 번호와 닉네임을 가져옵니다.
 * 카카오 액세스 토큰은 이 함수 안에서만 쓰고 저장하거나 돌려주지 않습니다.
 */
export async function fetchKakaoProfile(code: string): Promise<KakaoProfile> {
    const accessToken = await exchangeCode(code);

    const response = await request('사용자 정보', USER_INFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        console.error('카카오 사용자 정보 요청이 거절되었습니다.', { status: response.status });
        throw unavailable();
    }
    const body = await readJson(response);
    const id = body?.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id)) {
        console.error('카카오 사용자 정보 응답에 회원 번호가 없습니다.');
        throw unavailable();
    }
    // 닉네임은 필수 동의 항목이므로 없으면 카카오 콘솔의 동의항목 설정이 어긋난 것입니다.
    const nickname = asObject(asObject(body?.kakao_account)?.profile)?.nickname;
    if (typeof nickname !== 'string' || nickname.trim() === '') {
        console.error('카카오 사용자 정보 응답에 닉네임이 없습니다. 카카오 콘솔의 동의항목을 확인해 주십시오.');
        throw unavailable();
    }
    return { id: String(id), nickname: nickname.trim() };
}
