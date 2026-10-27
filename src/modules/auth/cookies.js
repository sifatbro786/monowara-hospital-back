import { env } from "../../config/env.js";

export const ACCESS_COOKIE = "mh_at";
export const REFRESH_COOKIE = "mh_rt";

/**
 * HttpOnly (no JS access → XSS can't steal it), SameSite=Strict (never sent from another site;
 * monowarahospital.com ↔ api.monowarahospital.com is the same site), Secure in production.
 * The refresh cookie is scoped to /api/auth so it only travels to login/refresh/logout.
 */
const base = () => ({
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
    ...(env.COOKIE_DOMAIN && { domain: env.COOKIE_DOMAIN }),
});

export function setAuthCookies(res, { accessToken, refreshToken, sessionExpiresAt }) {
    res.cookie(ACCESS_COOKIE, accessToken, {
        ...base(),
        path: "/api",
        maxAge: env.ACCESS_TOKEN_TTL_MIN * 60_000,
    });
    res.cookie(REFRESH_COOKIE, refreshToken, {
        ...base(),
        path: "/api/auth",
        expires: new Date(sessionExpiresAt),
    });
}

export function clearAuthCookies(res) {
    res.clearCookie(ACCESS_COOKIE, { ...base(), path: "/api" });
    res.clearCookie(REFRESH_COOKIE, { ...base(), path: "/api/auth" });
}
