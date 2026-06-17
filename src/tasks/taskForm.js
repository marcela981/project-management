import { STATE }      from '../core/state.js';
import { createTask, updateTask, deleteTask, fetchTasks } from '../api/api.js';
import { renderBoard } from '../board/render.js';
import { generateId, formatDate, isOverdue }  from '../shared/utils.js';
import { CONFIG }      from '../core/config.js';
import { openModal, closeModal, registerDirtyCheck } from '../shared/modal.js';
import {
    enableRetro, disableRetro,
    getRetroValues, isRetroActive, validateRetro,
} from './retroactiveAccordion.js';
import { save }        from '../core/storage.js';

let currentTab    = 'edicion';
let _formSnapshot = null;
// In-flight guard for submitNewTask. Without this, rapid double-clicks fired
// N parallel createTask() calls and the backend produced N duplicate cards.
let _isSubmitting = false;
// Idempotency key per "new task" modal session — paired with the unique
// client_op_id column in the backend so a retry of the same create returns
// the original row instead of inserting a duplicate.
let _newTaskClientOpId = null;

function _uuid() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch { /* fall through */ }
    return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function _getFormState() {
    return {
        name:        document.getElementById('inputTaskName')?.value ?? '',
        description: document.getElementById('inputDescription')?.value ?? '',
        startDate:   document.getElementById('inputStartDate')?.value ?? '',
        deadline:    document.getElementById('inputDeadline')?.value ?? '',
        priority:    document.getElementById('inputPriority')?.value ?? '',
        subtasks:    [...document.querySelectorAll('.subtask-input')].map(s => s.value).join('\n'),
        retroActive: isRetroActive(),
    };
}

function _isTaskFormDirty() {
    if (!_formSnapshot) return false;
    return JSON.stringify(_getFormState()) !== JSON.stringify(_formSnapshot);
}

registerDirtyCheck('modalNewTask', _isTaskFormDirty);

export function switchTab(tab) {
    currentTab = tab;
    ['edicion', 'resumen'].forEach(t => {
        const btn = document.querySelector(`[data-tab="${t}"]`);
        const body = document.getElementById(`tab-${t}`);
        if (btn) {
            btn.classList.toggle('active', t === tab);
            btn.style.borderBottomColor = t === tab ? 'var(--color-primary)' : 'transparent';
            btn.style.color = t === tab ? 'inherit' : 'var(--text-muted)';
        }
        if (body) body.style.display = t === tab ? 'block' : 'none';
    });

    // Sólo la tab Edición tiene Save/Cancel. En Tiempo/Resumen se oculta.
    const footer = document.getElementById('modalNewTaskFooter');
    if (footer) footer.style.display = tab === 'edicion' ? 'flex' : 'none';
}

export function openNewTaskModal(type) {
    STATE.currentTaskType = type;
    STATE.editingTaskId = null;

    document.getElementById('modalTaskTabs').style.display = 'none';
    switchTab('edicion');

    document.getElementById('modalNewTaskTitle').textContent   = type === 'activity' ? 'New Activity' : 'New Task';
    document.getElementById('activityTypeGroup').style.display = type === 'activity' ? 'block' : 'none';
    document.getElementById('subtasksGroup').style.display     = type === 'activity' ? 'none'  : 'block';

    document.getElementById('inputTaskName').value    = '';
    document.getElementById('inputStartDate').value   = new Date().toISOString().split('T')[0];
    document.getElementById('inputDeadline').value    = '';
    document.getElementById('inputPriority').value    = 'medium';
    document.getElementById('inputDescription').value = '';
    document.getElementById('subtasksContainer').innerHTML = '';

    const submitBtn = document.querySelector('#modalNewTaskFooter .btn-primary');
    if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-check"></i> Create';
        submitBtn.disabled = false;
    }
    document.getElementById('modalNewTaskFooter').style.display = 'flex';

    // One idempotency key per modal session. All retries from the same modal
    // open share it; closing and reopening generates a fresh one.
    _newTaskClientOpId = _uuid();

    enableRetro();
    _formSnapshot = _getFormState();
    openModal('modalNewTask');
}

export async function openEditTaskModal(taskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    if (!task) return;

    STATE.editingTaskId = taskId;
    STATE.currentTaskType = task.type;

    document.getElementById('modalTaskTabs').style.display = 'flex';
    switchTab('edicion');

    const isActivity = task.type === 'activity';

    document.getElementById('modalNewTaskTitle').textContent   = isActivity ? 'Edit Activity' : 'Edit Task';
    document.getElementById('activityTypeGroup').style.display = isActivity ? 'block' : 'none';
    document.getElementById('subtasksGroup').style.display     = isActivity ? 'none'  : 'block';

    document.getElementById('inputTaskName').value    = task.title ?? '';
    document.getElementById('inputDescription').value = task.description ?? '';
    document.getElementById('inputStartDate').value   = task.startDate ?? '';
    document.getElementById('inputDeadline').value    = task.deadline ?? '';
    document.getElementById('inputPriority').value    = task.priority ?? 'medium';

    if (isActivity) {
        const actTypeEl = document.getElementById('inputActivityType');
        if (actTypeEl && task.activityType) actTypeEl.value = task.activityType;
    }

    const container = document.getElementById('subtasksContainer');
    container.innerHTML = '';
    (task.subtasks ?? []).forEach((sub, index) => {
        const div = document.createElement('div');
        div.style.cssText = 'display: flex; gap: 0.5rem; margin-bottom: 0.5rem;';
        div.innerHTML = `
            <input type="text" class="form-input subtask-input" placeholder="Subtask ${index + 1}..." value="${sub.text ?? ''}" data-subtask-id="${sub.id ?? ''}">
            <button type="button" class="btn btn-secondary btn-sm" data-action="remove-parent">
                <i class="fas fa-times"></i>
            </button>`;
        container.appendChild(div);
    });

    const submitBtn = document.querySelector('#modalNewTaskFooter .btn-primary');
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';

    // Render inicial con lo que ya tenemos en STATE.
    renderResumenTab(task);

    disableRetro();
    _formSnapshot = _getFormState();
    openModal('modalNewTask');
}

// ── Tab Resumen (solo lectura, subtasks interactivas) ────────────────────────

function renderResumenTab(task) {
    const isComplete = task.progress === 100;
    const completedCount = (task.subtasks ?? []).filter(s => s.completed).length;
    const totalCount     = (task.subtasks ?? []).length;
    const pct = task.progress ?? (totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0);

    let html = `
        <div class="mb-2">
            <p class="text-muted">${task.description ? escapeHtml(task.description) : 'No description.'}</p>
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
            <span class="form-label">Priority</span>
            <p>${task.priority ?? '—'}</p>
        </div>
        ${totalCount > 0 || (task.progress ?? 0) > 0 ? `
        <div class="mb-2">
            <span class="form-label">Progress (${pct}%)</span>
            <div class="progress-bar" style="margin-top:.35rem;">
                <div class="progress-fill ${isComplete ? 'complete' : ''}" style="width:${pct}%"></div>
            </div>
        </div>` : ''}
    `;

    if (totalCount > 0) {
        html += `
            <div class="mb-2">
                <span class="form-label">
                    Subtasks (${completedCount}/${totalCount})
                </span>
                <div class="subtasks-list mt-1">
                    ${task.subtasks.map(sub => `
                        <div class="subtask-item ${sub.completed ? 'completed' : ''}"
                             data-action="toggle-subtask" data-task-id="${task.id}" data-subtask-id="${sub.id}">
                            <div class="subtask-checkbox">
                                ${sub.completed ? '<i class="fas fa-check"></i>' : ''}
                            </div>
                            <span class="subtask-text">${escapeHtml(sub.text ?? '')}</span>
                        </div>`).join('')}
                </div>
            </div>`;
    }

    if (task.observations && task.observations.length > 0) {
        html += `
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
                                <p style="margin-top:.25rem;">${escapeHtml(text ?? '')}</p>
                            </div>`;
                    }).join('')}
                </div>
            </div>`;
    }

    if (!isComplete) {
        html += `
        <div class="overview-finalize-cta">
            <button class="btn btn-primary" data-action="finalize-task" data-task-id="${task.id}">
                <i class="fas fa-check-double"></i> ¿Ya finalizaste?
            </button>
        </div>`;
    }

    document.getElementById('resumen-content').innerHTML = html;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

export async function toggleSubtask(taskId, subtaskId) {
    const task = STATE.tasks.find(t => t.id === taskId);
    const subtask = task?.subtasks.find(s => s.id === subtaskId);
    if (!subtask) return;

    subtask.completed = !subtask.completed;
    task.progress = Math.round(
        (task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100
    );

    save();
    try {
        await updateTask(taskId, { subtasks: task.subtasks, progress: task.progress });
    } catch (e) {
        console.error(e);
    }

    if (STATE.editingTaskId === taskId) {
        renderResumenTab(task);
    }
    renderBoard();
}

// ── Subtasks (tab Edición) ───────────────────────────────────────────────────

export function addSubtaskInput() {
    const container = document.getElementById('subtasksContainer');
    const index     = container.children.length;
    const div       = document.createElement('div');

    div.style.cssText = 'display: flex; gap: 0.5rem; margin-bottom: 0.5rem;';
    div.innerHTML = `
        <input type="text" class="form-input subtask-input" placeholder="Subtask ${index + 1}...">
        <button type="button" class="btn btn-secondary btn-sm" data-action="remove-parent">
            <i class="fas fa-times"></i>
        </button>`;

    container.appendChild(div);
}

// ── Submit (crear o editar tarea/actividad) ──────────────────────────────────

export async function submitNewTask() {
    if (_isSubmitting) return;

    const name = document.getElementById('inputTaskName').value.trim();
    if (!name) {
        alert('Name is required.');
        return;
    }

    const subtasks = Array.from(document.querySelectorAll('.subtask-input'))
        .map(input => ({
            raw: input.value.trim(),
            prevId: input.dataset.subtaskId || null,
        }))
        .filter(({ raw }) => raw)
        .map(({ raw, prevId }) => ({
            id:        prevId || generateId('sub'),
            text:      raw,
            completed: false,
        }));

    const isEditing = !!STATE.editingTaskId;
    const submitBtn = document.querySelector('#modalNewTaskFooter .btn-primary');
    const prevBtnHtml = submitBtn?.innerHTML ?? '';

    _isSubmitting = true;
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    }

    try {
    if (isEditing) {
        const taskId = STATE.editingTaskId;
        const existingTask = STATE.tasks.find(t => t.id === taskId);

        const prevById = new Map((existingTask?.subtasks ?? []).map(s => [s.id, s]));
        const mergedSubtasks = subtasks.map(s => {
            const prev = prevById.get(s.id);
            return prev ? { ...prev, text: s.text } : s;
        });
        const completedCount = mergedSubtasks.filter(s => s.completed).length;
        const recalcProgress = mergedSubtasks.length > 0
            ? Math.round((completedCount / mergedSubtasks.length) * 100)
            : (existingTask?.progress ?? 0);

        const data = {
            title:        name,
            description:  document.getElementById('inputDescription').value.trim(),
            column:       existingTask?.column ?? (STATE.currentTaskType === 'activity' ? 'activities' : 'actively-working'),
            type:         STATE.currentTaskType,
            priority:     document.getElementById('inputPriority').value,
            startDate:    document.getElementById('inputStartDate').value,
            deadline:     document.getElementById('inputDeadline').value || null,
            activityType: STATE.currentTaskType === 'activity'
                ? document.getElementById('inputActivityType').value
                : null,
            subtasks:  mergedSubtasks,
            progress:  recalcProgress,
        };

        try {
            await updateTask(taskId, data);
        } catch (err) {
            console.error('[submitNewTask] Error al actualizar tarea:', err);
            alert('Error al actualizar la tarea. Por favor intenta de nuevo.');
            return;
        }

        if (CONFIG.BACKEND_URL) {
            try {
                const tareas = await fetchTasks();
                if (Array.isArray(tareas)) STATE.tasks = tareas;
            } catch (err) {
                console.error('[submitNewTask] Error al recargar tareas:', err);
            }
        }

        renderBoard();
        closeModal('modalNewTask');

        const submitBtn = document.querySelector('#modalNewTaskFooter .btn-primary');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-check"></i> Create';

        STATE.editingTaskId = null;
        return;
    }

    // Validate retro accordion before submit
    const retroErr = validateRetro();
    if (retroErr) { alert(retroErr); return; }

    const retro = getRetroValues();
    const retroFields = retro.isActive ? {
        isRetroactive: true,
        completedAt:   retro.completedAt,
        progress:      100,
    } : {};

    const payload = {
        title:        name,
        description:  document.getElementById('inputDescription').value.trim(),
        column:       retro.isActive
            ? 'completed'
            : (STATE.currentTaskType === 'activity' ? 'activities' : 'actively-working'),
        type:         STATE.currentTaskType,
        priority:     document.getElementById('inputPriority').value,
        startDate:    document.getElementById('inputStartDate').value,
        deadline:     document.getElementById('inputDeadline').value || null,
        activityType: STATE.currentTaskType === 'activity'
            ? document.getElementById('inputActivityType').value
            : null,
        subtasks,
        clientOpId:   _newTaskClientOpId,
        ...retroFields,
    };

    try {
        await createTask(payload);
    } catch (err) {
        console.error('[submitNewTask] Error al crear tarea:', err);
        alert('Error al crear la tarea. Por favor intenta de nuevo.');
        return;
    }

    if (CONFIG.BACKEND_URL) {
        try {
            const tareas = await fetchTasks();
            if (Array.isArray(tareas)) STATE.tasks = tareas;
        } catch (err) {
            console.error('[submitNewTask] Error al recargar tareas:', err);
        }
    }

    renderBoard();
    closeModal('modalNewTask');
    } finally {
        _isSubmitting = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = prevBtnHtml;
        }
    }
}

export async function confirmDeleteTask(taskId) {
    const confirmed = confirm('¿Está seguro que desea eliminar esta tarjeta?');
    if (!confirmed) return;

    try {
        await deleteTask(taskId);
    } catch (err) {
        console.error('[confirmDeleteTask] Error al eliminar tarea:', err);
        alert('Error al eliminar la tarea. Por favor intenta de nuevo.');
        return;
    }

    if (CONFIG.BACKEND_URL) {
        try {
            const tareas = await fetchTasks();
            if (Array.isArray(tareas)) STATE.tasks = tareas;
        } catch (err) {
            console.error('[confirmDeleteTask] Error al recargar tareas:', err);
        }
    }

    renderBoard();
}
