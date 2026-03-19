/** OAuth2 con Nextcloud: token en localStorage (persiste entre refreshes en iframes). */

import { CONFIG } from './config.js';

const TOKEN_KEY = 'nc_access_token';
const USER_KEY  = 'nc_user_info';

// Fallback en memoria para navegadores que bloquean localStorage en iframes (Safari ITP, etc.)
const _mem = {};

function _set(key, value) {
    try { localStorage.setItem(key, value); } catch { _mem[key] = value; }
}

function _get(key) {
    try {
        const v = localStorage.getItem(key);
        if (v !== null) return v;
    } catch { /* bloqueado */ }
    return _mem[key] ?? null;
}

function _remove(key) {
    try { localStorage.removeItem(key); } catch { /* bloqueado */ }
    delete _mem[key];
}

// ---------------------------------------------------------------------------

export function getToken() {
    return _get(TOKEN_KEY);
}

function _saveToken(token) {
    _set(TOKEN_KEY, token);
}

export function getCachedUser() {
    const raw = _get(USER_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function _saveUser(user) {
    _set(USER_KEY, JSON.stringify(user));
}

function _redirectUri() {
    return window.location.origin + window.location.pathname;
}

function _buildAuthUrl() {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id:     CONFIG.NEXTCLOUD_OAUTH_CLIENT_ID,
        redirect_uri:  _redirectUri(),
    });
    return `${CONFIG.NEXTCLOUD_URL}/index.php/apps/oauth2/authorize?${params}`;
}

async function _exchangeCode(code) {
    const res = await fetch(`${CONFIG.BACKEND_BASE_URL}/auth/callback`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, redirect_uri: _redirectUri() }),
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
    const { access_token } = await res.json();
    return access_token;
}

async function _fetchUserInfo(token) {
    const res = await fetch(`${CONFIG.BACKEND_BASE_URL}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`User info failed: ${res.status}`);
    return res.json();
}

export async function initAuth() {
    if (!CONFIG.NEXTCLOUD_OAUTH_CLIENT_ID) {
        // OAuth no configurado: modo sin autenticación (dev / offline)
        return null;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const code      = urlParams.get('code');

    if (code) {
        window.history.replaceState({}, '', window.location.pathname);
        const token = await _exchangeCode(code);
        _saveToken(token);
    }

    const token = getToken();
    if (!token) {
        window.location.href = _buildAuthUrl();
        return null;
    }

    let user = getCachedUser();
    if (!user) {
        user = await _fetchUserInfo(token);
        const words   = (user.displayname || user.id || '').trim().split(/\s+/);
        user.initials = words.map(w => w[0]).join('').slice(0, 2).toUpperCase();
        _saveUser(user);
    }

    return user;
}

export function logout() {
    _remove(TOKEN_KEY);
    _remove(USER_KEY);
    window.location.href = _buildAuthUrl();
}
