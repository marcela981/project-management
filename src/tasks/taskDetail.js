/** Modal de detalle de tarea: time log, subtareas, observaciones y edición de tiempo. */

import { STATE }      from '../core/state.js';
import { setTaskTime } from '../api/api.js';
import { save }        from '../core/storage.js';
import { renderBoard } from '../board/render.js';
import { formatTime, formatDate, isOverdue, formatTimeCompact, formatLogDate } from '../shared/utils.js';
import { openModal, closeModal } from '../shared/modal.js';

export function openTaskDetail(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    const isComplete = task.progress === 100;

    document.getElementById('modalDetailTitle').textContent = task.title;

    document.getElementById('modalDetailBody').innerHTML = `
        <div class="mb-2">
            <p class="text-muted">${task.description || 'No description.'}</p>
        </div>
        <div class="form-row mb-2">
            <div>
                <span class="form-label">Start</span>
                <p>${formatDate(task.startDate)}</p>
            </div>
            <div>
                <span class="form-label">Deadline</span>
                <p class="${isOverdue(task.deadline) && !isComplete ? 'text-danger' : ''} ${isComplete ? 'text-success' : ''}">
                    ${formatDate(task.deadline)}
                </p>
            </div>
        </div>
        <div class="mb-2">
            <span class="form-label">Time invested</span>
            <div style="display:flex; align-items:center; gap:0.75rem;">
                <span id="detail-time-display" style="font-size:1.5rem; font-weight:600; color:var(--color-primary);">
                    ${formatTime(task.timeSpent)}
                </span>
                <button class="task-menu-btn" data-action="open-time-edit" data-task-id="${task.id}" title="Edit time">
                    <i class="fas fa-pencil-alt"></i>
                </button>
            </div>
            <div id="detail-time-edit" style="display:none; margin-top:0.5rem;">
                <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
                    <input type="number" id="detail-time-h" class="form-input" style="width:68px;"
                           min="0" placeholder="h" value="${Math.floor(task.timeSpent / 3600)}">
                    <span>h</span>
                    <input type="number" id="detail-time-m" class="form-input" style="width:68px;"
                           min="0" max="59" placeholder="m" value="${Math.floor((task.timeSpent % 3600) / 60)}">
                    <span>m</span>
                    <input type="number" id="detail-time-s" class="form-input" style="width:68px;"
                           min="0" max="59" placeholder="s" value="${task.timeSpent % 60}">
                    <span>s</span>
                    <button class="btn btn-primary btn-sm" data-action="save-time-edit" data-task-id="${task.id}">
                        <i class="fas fa-save"></i> Save
                    </button>
                    <button class="btn btn-secondary btn-sm" data-action="cancel-time-edit">Cancel</button>
                </div>
            </div>
        </div>
        ${task.timeLog && task.timeLog.length > 0 ? `
        <div class="mb-2">
            <span class="form-label">Time log</span>
            <div class="time-log mt-1">
                ${[...task.timeLog]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map(entry => `
                        <div class="time-log-entry">
                            <span class="time-log-date">${formatLogDate(entry.date)}</span>
                            <span class="time-log-duration">${formatTimeCompact(entry.seconds)}</span>
                        </div>`).join('')}
            </div>
        </div>` : ''}
        ${task.subtasks.length > 0 ? `
            <div class="mb-2">
                <span class="form-label">
                    Subtasks (${task.subtasks.filter(s => s.completed).length}/${task.subtasks.length})
                </span>
                <div class="subtasks-list mt-1">
                    ${task.subtasks.map(sub => `
                        <div class="subtask-item ${sub.completed ? 'completed' : ''}"
                             data-action="toggle-subtask" data-task-id="${task.id}" data-subtask-id="${sub.id}">
                            <div class="subtask-checkbox">
                                ${sub.completed ? '<i class="fas fa-check"></i>' : ''}
                            </div>
                            <span class="subtask-text">${sub.text}</span>
                            <span class="subtask-time">${formatTime(sub.timeSpent)}</span>
                        </div>`).join('')}
                </div>
            </div>` : ''}
        ${task.observations.length > 0 ? `
            <div class="mb-2">
                <span class="form-label">Observations</span>
                <div class="mt-1">
                    ${task.observations.map(obs => {
                        const text = typeof obs === 'string' ? obs : obs.text;
                        const date = typeof obs === 'string' ? '' : new Date(obs.date).toLocaleString('en-US');
                        return `
                            <div style="padding:.5rem; background:var(--color-secondary-light);
                                        border-radius:var(--radius-sm); margin-bottom:.5rem;">
                                ${date ? `<small class="text-muted">${date}</small>` : ''}
                                <p style="margin-top:.25rem;">${text}</p>
                            </div>`;
                    }).join('')}
                </div>
            </div>` : ''}`;

    document.getElementById('modalDetailFooter').innerHTML = `
        <button class="btn btn-secondary" data-action="close-modal" data-modal-id="modalTaskDetail">Close</button>`;

    openModal('modalTaskDetail');
}

export function toggleSubtask(taskId, subtaskId) {
    const task    = STATE.tasks.find(t => t.id === taskId);
    const subtask = task?.subtasks.find(s => s.id === subtaskId);
    if (!subtask) return;

    subtask.completed = !subtask.completed;
    task.progress = Math.round(
        (task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100
    );

    save();
    openTaskDetail(taskId);
    renderBoard();
}

export function openTimeEdit() {
    document.getElementById('detail-time-edit').style.display = 'flex';
}

export function cancelTimeEdit() {
    document.getElementById('detail-time-edit').style.display = 'none';
}

export async function saveTimeEdit(taskId) {
    const h = Math.max(0, parseInt(document.getElementById('detail-time-h').value, 10) || 0);
    const m = Math.max(0, Math.min(59, parseInt(document.getElementById('detail-time-m').value, 10) || 0));
    const s = Math.max(0, Math.min(59, parseInt(document.getElementById('detail-time-s').value, 10) || 0));
    const newSeconds = h * 3600 + m * 60 + s;

    try {
        await setTaskTime(taskId, newSeconds);
    } catch (err) {
        console.error('[saveTimeEdit] Error al actualizar tiempo:', err);
        alert('Error al guardar el tiempo. Por favor intenta de nuevo.');
        return;
    }

    document.getElementById('detail-time-display').textContent = formatTime(newSeconds);
    document.getElementById('detail-time-edit').style.display = 'none';
    renderBoard();
}
