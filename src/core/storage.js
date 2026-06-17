/** Persistencia en localStorage (clave dashboard_tasks_v2). */

import { STATE } from './state.js';

const STORAGE_KEY = 'dashboard_tasks_v2';

export function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE.tasks));
}

export function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
        STATE.tasks = JSON.parse(raw);
    } catch {
        STATE.tasks = [];
    }
}

export function clear() {
    localStorage.removeItem(STORAGE_KEY);
    STATE.tasks = [];
}
