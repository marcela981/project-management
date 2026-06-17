/** Punto de entrada: OAuth, carga de datos, event delegation central. */

import { STATE }            from './core/state.js';
import { load }             from './core/storage.js';
import { fetchTasks, reopenTask, completeTask } from './api/api.js';
import {
    renderBoard, toggleCompletedAccordion,
    initBoardSortMenus, openSortMenu, closeSortMenus,
    applyColumnSort, resetColumnSort,
} from './board/render.js';
import { setupDragAndDrop } from './board/dragDrop.js';
import { initAuth }         from './auth/auth.js';
import { CONFIG }           from './core/config.js';
import { closeModal, closeModalSafe, hasDirtyCheck, isDirty } from './shared/modal.js';
import { fetchTeams }       from './dashboard/dashApi.js';
import { renderMyMetrics }  from './dashboard/myMetrics.js';
import { renderTeamDashboard } from './dashboard/teamDashboard.js';
import { renderSkills, submitEndorse } from './skills/skills.js';
import { renderAdmin }      from './admin/admin.js';

import {
    openNewTaskModal, openEditTaskModal,
    addSubtaskInput, submitNewTask, confirmDeleteTask,
    switchTab, toggleSubtask,
} from './tasks/taskForm.js';

import {
    openImportDeckModal, selectDeckBoard,
    toggleDeckSelection, importSelectedDeckCards, filterDeckCards,
    toggleDeckFilterPanel, toggleDeckTag, selectAllDeckTags, clearAllDeckTags,
} from './deck/deckImport.js';

import { renderCalendar, handleCalendarClick } from './calendar/calendar-router.js';
import { submitBlock, handleWeeklyModalEvent } from './weekly/weekly-modal.js';
import { pcGet } from './core/persistent-cache.js';
import {
    primePrefsCache, primeBlocksCache, weekStartIso as computeWeekStartIso,
} from './weekly/weekly-data.js';
import { initRetroAccordion } from './tasks/retroactiveAccordion.js';
import { openSettings, closeSettings, saveSettings } from './settings/settings.js';

// ---------------------------------------------------------------------------
// Navegación entre vistas
// ---------------------------------------------------------------------------

let _currentUser = null;

function navigateTo(view) {
    document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

    document.getElementById(`view-${view}`)?.classList.add('active');
    document.querySelector(`.nav-tab[data-view="${view}"]`)?.classList.add('active');

    // Lazy render cada vez (datos frescos)
    const container = document.getElementById(`view-${view}`);
    if (!container) return;
    switch (view) {
        case 'my-metrics':
            renderMyMetrics(container, _currentUser);
            break;
        case 'dashboard':
            renderTeamDashboard(container, _currentUser);
            break;
        case 'skills':
            if (_currentUser) renderSkills(container, _currentUser);
            break;
        case 'admin':
            if (_currentUser) renderAdmin(container, _currentUser);
            break;
        case 'weekly':
            renderCalendar(container);
            break;
    }
}

async function _maybeBootWeeklyFromCache() {
    const userId = _currentUser?.id ?? 'anon';
    let cachedPrefs = null;
    try {
        cachedPrefs = await pcGet(`weekly:prefs:${userId}`);
    } catch { /* IDB unavailable → skip boot, falls back to cold path */ }

    if (!cachedPrefs || cachedPrefs.calendar_view !== 'week') return false;

    primePrefsCache(cachedPrefs);

    // Pre-warm the in-memory mirror with the current week's blocks so _render
    // can skip its skeleton and paint real data on the first frame.
    try {
        const weekIso = computeWeekStartIso(new Date(), cachedPrefs);
        const cachedBlocks = await pcGet(`weekly:blocks:${userId}:${weekIso}`);
        if (cachedBlocks?.blocks) primeBlocksCache(weekIso, cachedBlocks);
    } catch { /* ignore */ }

    document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    const weeklyContainer = document.getElementById('view-weekly');
    if (!weeklyContainer) return false;
    weeklyContainer.classList.add('active');
    document.querySelector('.nav-tab[data-view="weekly"]')?.classList.add('active');

    // Fire-and-forget render (don't block init() on the actual paint).
    renderCalendar(weeklyContainer, { prefetch: true });
    return true;
}

function setupNav(user, isTechTeam) {
    if (user.role === 'leader' || user.role === 'admin') {
        document.querySelectorAll('.nav-leader').forEach(el => el.style.display = '');
    }
    if (isTechTeam) {
        document.querySelectorAll('.nav-tech').forEach(el => el.style.display = '');
    }

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => navigateTo(tab.dataset.view));
    });
}

// ---------------------------------------------------------------------------
// Event delegation: un único listener maneja toda la UI
// ---------------------------------------------------------------------------

async function handleClick(e) {
    if (!e.target.closest('.task-menu-wrapper')) {
        document.querySelectorAll('.task-dropdown.open').forEach(d => d.classList.remove('open'));
    }
    if (!e.target.closest('.sort-menu-wrapper')) {
        closeSortMenus();
    }

    const el = e.target.closest('[data-action]');
    if (!el) return;

    const { action, taskId, subtaskId, modalId, type, deckId } = el.dataset;

    switch (action) {
        case 'toggle-task-menu': {
            const dropdown = document.getElementById(`task-dropdown-${taskId}`);
            const isOpen = dropdown?.classList.contains('open');
            document.querySelectorAll('.task-dropdown.open').forEach(d => d.classList.remove('open'));
            if (!isOpen) dropdown?.classList.add('open');
            break;
        }

        // Tareas
        case 'new-task':          openNewTaskModal(type); break;
        case 'edit-task':         openEditTaskModal(taskId); break;
        case 'delete-task':       await confirmDeleteTask(taskId); break;
        case 'submit-task':       await submitNewTask(); break;
        case 'toggle-subtask':    toggleSubtask(taskId, subtaskId); break;

        // Formulario de nueva/editar tarea
        case 'add-subtask':       addSubtaskInput(); break;
        case 'remove-parent':     el.parentElement.remove(); break;

        case 'switch-tab':        switchTab(el.dataset.tab); break;

        // Reabrir tarea completada
        case 'reopen-task':       await reopenTask(taskId); renderBoard(); break;

        // Finalizar tarea desde Overview
        case 'finalize-task': {
            await completeTask(taskId);
            closeModal('modalNewTask');
            renderBoard();
            break;
        }

        // Acordeón de completadas
        case 'toggle-completed-accordion': toggleCompletedAccordion(el.dataset.colKey); break;

        // Sort de columnas del Board
        case 'toggle-sort-menu':  openSortMenu(el.dataset.colKey); break;
        case 'set-column-sort': {
            applyColumnSort(el.dataset.colKey, el.dataset.criterion, el.dataset.direction);
            closeSortMenus();
            renderBoard();
            break;
        }
        case 'reset-column-sort': {
            resetColumnSort(el.dataset.colKey);
            closeSortMenus();
            renderBoard();
            break;
        }

        // Deck
        case 'open-import-deck':          await openImportDeckModal(); break;
        case 'toggle-deck':               toggleDeckSelection(deckId); break;
        case 'import-deck-cards':         await importSelectedDeckCards(); break;
        case 'toggle-deck-filter-panel':  toggleDeckFilterPanel(); break;
        case 'toggle-deck-tag':           toggleDeckTag(el.dataset.tag); break;
        case 'toggle-deck-select-all':    selectAllDeckTags(); break;
        case 'toggle-deck-select-none':   clearAllDeckTags(); break;

        // Skills – endorse
        case 'submit-endorse':    await submitEndorse(); break;

        // Configuración
        case 'open-settings':     openSettings(); break;
        case 'close-settings':    closeSettings(); break;
        case 'save-settings':     saveSettings(); break;

        // Weekly tracker
        case 'weekly-submit-block': submitBlock(); break;

        // Modales
        case 'close-modal':       closeModalSafe(modalId); break;

        default:
            if (action?.startsWith('weekly-')) {
                if (!handleWeeklyModalEvent(action, el)) handleCalendarClick(action, el);
            } else if (action?.startsWith('calendar-') || action?.startsWith('day-') ||
                       action?.startsWith('month-') || action?.startsWith('quarter-') ||
                       action?.startsWith('semester-')) {
                handleCalendarClick(action, el);
            }
            break;
    }
}

function handleChange(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action } = el.dataset;
    switch (action) {
        case 'select-deck-board': selectDeckBoard(el.value); break;
    }
}

function handleInput(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'filter-deck-cards') filterDeckCards(el.value);
}

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------

async function init() {
    const user = await initAuth();

    if (!user) {
        if (CONFIG.NEXTCLOUD_OAUTH_CLIENT_ID) return;
        document.getElementById('userAvatar').textContent = '?';
        document.getElementById('userName').textContent   = 'User';
    } else {
        document.getElementById('userAvatar').textContent = user.initials   || '?';
        document.getElementById('userName').textContent   = user.displayname || user.id || 'User';
        _currentUser = user;
    }

    // Boot the user's default calendar view straight from IndexedDB BEFORE
    // we block on the heavy fetchTasks/fetchTeams round-trips. If the cached
    // pref says calendar_view='week' the weekly tab paints with cached blocks
    // in <200ms, well before any network response arrives.
    await _maybeBootWeeklyFromCache();

    load();

    let isTechTeam = false;
    const promises = [];

    if (CONFIG.BACKEND_URL) {
        promises.push(
            fetchTasks().then(fetched => {
                if (Array.isArray(fetched) && fetched.length > 0) STATE.tasks = fetched;
            }).catch(err => console.error('[init] Error al cargar tareas:', err))
        );
    }

    if (_currentUser?.teamId != null) {
        promises.push(
            fetchTeams().then(teams => {
                const myTeam = (teams ?? []).find(t => t.id === _currentUser.teamId);
                isTechTeam = myTeam?.isTechTeam ?? false;
            }).catch(() => {})
        );
    }

    await Promise.all(promises);
    
    initRetroAccordion();
    initBoardSortMenus();
    renderBoard();
    setupDragAndDrop();

    if (_currentUser) {
        setupNav(_currentUser, isTechTeam);
    }

    // Weekly tab is always available (no auth required)
    document.querySelectorAll('.nav-tab[data-view="weekly"]').forEach(tab => {
        tab.addEventListener('click', () => navigateTo('weekly'));
    });


    document.addEventListener('click',  handleClick);
    document.addEventListener('change', handleChange);
    document.addEventListener('input',  handleInput);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay.active').forEach(m => {
                // If dirty, ESC is disabled. If clean (or no dirty check), close normally.
                if (!isDirty(m.id)) closeModal(m.id);
            });
        }
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            // Backdrop click is fully disabled for creation/edit modals (those with a
            // registered dirty check). Other modals (timer, completion) still close.
            if (e.target === overlay && !hasDirtyCheck(overlay.id)) {
                overlay.classList.remove('active');
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', init);
