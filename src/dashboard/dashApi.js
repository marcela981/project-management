/** API calls for dashboard, metrics, skills, and admin endpoints. */

import { getToken, logout } from '../auth/auth.js';
import { CONFIG } from '../core/config.js';

async function apiFetch(path, options = {}) {
    const token = getToken();
    const res = await fetch(`${CONFIG.BACKEND_BASE_URL}${path}`, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
    if (res.status === 401) { logout(); return null; }
    if (!res.ok) throw new Error(`Error ${res.status}: ${res.statusText}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

// --- Metrics ---
export const fetchMyMetrics = (start, end) =>
    apiFetch(`/api/dashboard/my-metrics?start_date=${start}&end_date=${end}`);

export const fetchMyTeam = () =>
    apiFetch('/api/dashboard/my-team');

export const fetchTeamMetrics = (teamId, start, end) =>
    apiFetch(`/api/dashboard/team/${teamId}/metrics?start_date=${start}&end_date=${end}`);

export const fetchCompare = () =>
    apiFetch('/api/dashboard/compare');

export const fetchSkillsComparison = () =>
    apiFetch('/api/dashboard/skills-comparison');

export const fetchDeliveryTrend = (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/dashboard/delivery-trend?${qs}`);
};

// --- Skills ---
export const fetchSkills = () =>
    apiFetch('/api/skills');

export const fetchUserSkills = (userId) =>
    apiFetch(`/api/users/${userId}/skills`);

export const updateMySkills = (skills) =>
    apiFetch('/api/users/me/skills', { method: 'POST', body: JSON.stringify(skills) });

export const endorseSkill = (userId, skillId, score, comment) =>
    apiFetch(`/api/users/${userId}/skills/${skillId}/endorse`, {
        method: 'POST',
        body: JSON.stringify({ score, comment }),
    });

export const evaluateUser = (userId, skills) =>
    apiFetch(`/api/users/${userId}/skills/evaluate`, {
        method: 'POST',
        body: JSON.stringify(skills),
    });

export const createSkill = (name, category) =>
    apiFetch('/api/skills', {
        method: 'POST',
        body: JSON.stringify({ name, category }),
    });

// --- Admin ---
export const fetchAdminUsers = () =>
    apiFetch('/api/admin/users');

export const updateAdminUser = (userId, data) =>
    apiFetch(`/api/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(data) });

export const fetchTeams = () =>
    apiFetch('/api/teams');

export const createTeam = (data) =>
    apiFetch('/api/admin/teams', { method: 'POST', body: JSON.stringify(data) });

export const updateTeam = (teamId, data) =>
    apiFetch(`/api/admin/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteTeam = (teamId) =>
    apiFetch(`/api/admin/teams/${teamId}`, { method: 'DELETE' });

export const addTeamMember = (teamId, ncUserId) =>
    apiFetch(`/api/admin/teams/${teamId}/add-member?nc_user_id=${encodeURIComponent(ncUserId)}`, { method: 'POST' });

export const removeTeamMember = (teamId, userId) =>
    apiFetch(`/api/admin/teams/${teamId}/remove-member?user_id=${encodeURIComponent(userId)}`, { method: 'POST' });

export const setUserRole = (userId, role) =>
    apiFetch(`/api/admin/users/${userId}/set-role?role=${encodeURIComponent(role)}`, { method: 'POST' });
