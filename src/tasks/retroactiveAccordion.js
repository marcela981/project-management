/** Retroactive-completion accordion for task/activity/project creation.
 *  Captures only the past completion date (completedAt); time logging was removed. */

import { fromZonedTime } from 'date-fns-tz';

const TODAY = () => new Date().toISOString().split('T')[0];

// completedAt semantically represents a calendar day in the business timezone
// (America/New_York). Anchoring at NY midnight before serializing ensures the
// backend receives a tz-aware ISO and stores the same calendar date the user
// picked, independent of the browser's local timezone.
const BUSINESS_TZ = 'America/New_York';

function _completedAtToIso(dateOnly) {
    if (!dateOnly) return null;
    return fromZonedTime(`${dateOnly}T00:00:00`, BUSINESS_TZ).toISOString();
}

let _createMode  = false;
let _startDate   = null;
let _enabled     = false;
let _completedAt = null;
let _bound       = false;

// ─── Public API ──────────────────────────────────────────────────────────────

export function initRetroAccordion() {
    if (_bound) return;
    _bound = true;
    document.addEventListener('change', e => {
        if (e.target.id === 'inputStartDate') _onStartDateChange(e);
    });
}

/** Call when opening CREATE modal — enables accordion logic. */
export function enableRetro() {
    _createMode  = true;
    _enabled     = false;
    _completedAt = TODAY();
    _startDate   = document.getElementById('inputStartDate')?.value ?? null;
    _render();
}

/** Call when opening EDIT modal — hides accordion entirely. */
export function disableRetro() {
    _createMode = false;
    _enabled    = false;
    const c = document.getElementById('retroAccordionContainer');
    if (c) c.innerHTML = '';
}

/** Returns values to include in submit payload. */
export function getRetroValues() {
    return {
        isActive:    _enabled,
        completedAt: _enabled ? _completedAtToIso(_completedAt) : null,
    };
}

/** True if accordion is enabled (has unsaved retro data). */
export function isRetroActive() {
    return _enabled;
}

/**
 * Validate retro state before submit.
 * Returns an error string, or null if valid.
 */
export function validateRetro() {
    if (!_enabled) return null;
    if (!_completedAt) return 'Indica la fecha de finalización.';
    return null;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function _onStartDateChange(e) {
    if (!_createMode) return;
    _startDate = e.target.value;
    const today = TODAY();
    if (_startDate && _startDate < today) {
        _render();
    } else {
        _enabled = false;
        _render();
    }
}

function _render() {
    const container = document.getElementById('retroAccordionContainer');
    if (!container) return;

    const today  = TODAY();
    const isPast = _startDate && _startDate < today;

    if (!isPast) { container.innerHTML = ''; return; }

    container.innerHTML = `
        <div class="retro-accordion${_enabled ? ' retro-accordion--open' : ''}">
            <div class="retro-accordion-header">
                <span class="retro-accordion-label">
                    <i class="fas fa-history retro-icon"></i>
                    Esta tarea tiene fecha en el pasado
                </span>
                <label class="retro-switch">
                    <input type="checkbox" data-retro-action="toggle-switch" ${_enabled ? 'checked' : ''}>
                    <span class="retro-switch-track"></span>
                    <span class="retro-switch-lbl">¿Ya finalizó?</span>
                </label>
            </div>
            ${_enabled ? `
            <div class="retro-accordion-body">
                <div class="retro-row">
                    <span class="form-label retro-inline-lbl">Fecha de finalización</span>
                    <input type="date" id="retroCompletedAt" class="form-input retro-date-sm"
                           value="${_completedAt ?? today}"
                           min="${_startDate}" max="${today}"
                           data-retro-action="completed-at">
                </div>
            </div>` : ''}
        </div>`;

    container.querySelectorAll('[data-retro-action]').forEach(el => {
        const act = el.dataset.retroAction;
        if      (act === 'toggle-switch') el.addEventListener('change', _onToggle);
        else if (act === 'completed-at')  el.addEventListener('change', _onCompletedAt);
    });
}

function _onToggle(e) {
    _enabled = e.target.checked;
    if (_enabled && !_completedAt) _completedAt = TODAY();
    _render();
}

function _onCompletedAt(e) {
    _completedAt = e.target.value;
    _render();
}
