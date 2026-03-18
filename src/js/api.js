/** Capa de datos: REST cuando hay BACKEND_URL; localStorage en modo offline. Nextcloud Deck opcional. */

import { CONFIG } from './config.js';
import { STATE }  from './state.js';
import { save }   from './storage.js';
import { generateId } from './utils.js';

async function apiFetch(path, options = {}) {
    const response = await fetch(`${CONFIG.BACKEND_URL}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    if (!response.ok) {
        throw new Error(`API error ${response.status}: ${response.statusText}`);
    }
    return response.json();
}

export async function fetchTasks() {
    if (!CONFIG.BACKEND_URL) return [];
    return apiFetch('/tasks');
}

export async function saveTime(taskId, timeSpent, subtaskId = null, feedback = null) {
    if (CONFIG.BACKEND_URL) {
        await apiFetch(`/tasks/${taskId}/time`, {
            method: 'POST',
            body: JSON.stringify({ timeSpent, subtaskId, feedback })
        });
    }

    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.timeSpent += timeSpent;

    if (subtaskId && subtaskId !== 'none') {
        const sub = task.subtasks.find(s => s.id === subtaskId);
        if (sub) sub.timeSpent += timeSpent;
    }

    if (feedback) {
        if (feedback.progress !== undefined) task.progress = feedback.progress;
        if (feedback.observation) {
            task.observations.push({ date: new Date().toISOString(), text: feedback.observation });
        }
    }

    save();
}

export async function createTask(data) {
    const newTask = {
        id: generateId('task'),
        progress:     0,
        timeSpent:    0,
        observations: [],
        subtasks:     [],
        ...data
    };

    if (CONFIG.BACKEND_URL) {
        const saved = await apiFetch('/tasks', {
            method: 'POST',
            body: JSON.stringify(newTask)
        });
        STATE.tasks.push(saved);
        save();
        return saved;
    }

    STATE.tasks.push(newTask);
    save();
    return newTask;
}

export async function updateColumn(taskId, column) {
    if (CONFIG.BACKEND_URL) {
        await apiFetch(`/tasks/${taskId}`, {
            method: 'PATCH',
            body: JSON.stringify({ column })
        });
    }

    const task = STATE.tasks.find(t => t.id === taskId);
    if (task) task.column = column;
    save();
}

export async function completeTask(taskId) {
    if (CONFIG.BACKEND_URL) {
        await apiFetch(`/tasks/${taskId}/complete`, { method: 'POST' });
    }

    const task = STATE.tasks.find(t => t.id === taskId);
    if (task) {
        task.progress = 100;
        task.subtasks.forEach(s => (s.completed = true));
        task.column = 'actively-working';
    }
    save();
}

export async function fetchDeckCards() {
    if (!CONFIG.NEXTCLOUD_URL || !CONFIG.NEXTCLOUD_BOARD_ID) return [];

    const response = await fetch(
        `${CONFIG.NEXTCLOUD_URL}/index.php/apps/deck/api/v1.0/boards/${CONFIG.NEXTCLOUD_BOARD_ID}/stacks`,
        {
            headers: {
                'OCS-APIREQUEST': 'true',
                'Accept': 'application/json'
            },
            credentials: 'include'
        }
    );

    if (!response.ok) {
        throw new Error(`Nextcloud Deck error ${response.status}: ${response.statusText}`);
    }

    const stacks = await response.json();
    return stacks.flatMap(stack => stack.cards ?? []);
}
