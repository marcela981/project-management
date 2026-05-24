/** Retroactive-completion accordion for task/activity/project creation. */

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
let _logs        = [];       // [{ date:'YYYY-MM-DD', hours:N }]
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
    _logs        = [];
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
        timeLogs:    _enabled ? _logs.map(l => ({ logDate: l.date, hours: l.hours })) : [],
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
    if (_logs.length === 0) return 'Agrega al menos un día de trabajo.';
    const totalHours = _logs.reduce((s, l) => s + (parseFloat(l.hours) || 0), 0);
    if (totalHours <= 0) return 'El total de horas debe ser mayor a 0.';
    const bad = _logs.find(l => parseFloat(l.hours) <= 0);
    if (bad) return `El día ${bad.date} tiene 0 horas. Asigna al menos 0.25 h o elimínalo.`;
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
        _logs    = [];
        _render();
    }
}

function _render() {
    const container = document.getElementById('retroAccordionContainer');
    if (!container) return;

    const today  = TODAY();
    const isPast = _startDate && _startDate < today;

    if (!isPast) { container.innerHTML = ''; return; }

    const maxDate    = today;
    const rangeMax   = _completedAt ?? maxDate;
    const totalHours = _logs.reduce((s, l) => s + (parseFloat(l.hours) || 0), 0);
    const totalDays  = _logs.length;

    const logsHtml = _logs.length === 0
        ? `<p class="retro-empty-hint">Agrega los días en que trabajaste esta tarea</p>`
        : _logs.map((log, i) => `
            <div class="retro-log-row" data-idx="${i}">
                <input type="date" class="form-input retro-log-date"
                       value="${log.date}"
                       min="${_startDate}" max="${rangeMax}"
                       data-retro-action="log-date" data-idx="${i}">
                <input type="number" class="form-input retro-log-hours"
                       value="${log.hours}" min="0.25" max="24" step="0.25"
                       data-retro-action="log-hours" data-idx="${i}">
                <span class="retro-log-unit">h</span>
                <button type="button" class="retro-log-delete"
                        data-retro-action="log-delete" data-idx="${i}" title="Eliminar">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>`).join('');

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
                <div class="retro-summary-row">
                    <span class="retro-total">${totalDays > 0
                        ? `Total: <strong>${+totalHours.toFixed(2)}h</strong> en <strong>${totalDays}</strong> día${totalDays !== 1 ? 's' : ''}`
                        : ''}</span>
                    <div class="retro-btns">
                        <button type="button" class="btn btn-primary btn-sm"
                                data-retro-action="add-day">
                            <i class="fas fa-plus"></i> Agregar día
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm"
                                data-retro-action="autofill">
                            <i class="fas fa-magic"></i> Auto-rellenar
                        </button>
                    </div>
                </div>
                <div class="retro-logs-list">${logsHtml}</div>
            </div>` : ''}
        </div>`;

    container.querySelectorAll('[data-retro-action]').forEach(el => {
        const act = el.dataset.retroAction;
        if      (act === 'toggle-switch') el.addEventListener('change', _onToggle);
        else if (act === 'completed-at')  el.addEventListener('change', _onCompletedAt);
        else if (act === 'add-day')       el.addEventListener('click',  _onAddDay);
        else if (act === 'autofill')      el.addEventListener('click',  _onAutofill);
        else if (act === 'log-date')      el.addEventListener('change', _onLogDate);
        else if (act === 'log-hours')     el.addEventListener('input',  _onLogHours);
        else if (act === 'log-delete')    el.addEventListener('click',  _onLogDelete);
    });
}

function _onToggle(e) {
    _enabled = e.target.checked;
    if (_enabled && !_completedAt) _completedAt = TODAY();
    _render();
}

function _onCompletedAt(e) {
    _completedAt = e.target.value;
    _logs = _logs.filter(l => l.date >= _startDate && l.date <= _completedAt);
    _render();
}

function _onAddDay() {
    const rangeMax = _completedAt ?? TODAY();
    const used     = new Set(_logs.map(l => l.date));
    let   cand     = rangeMax;
    while (cand >= _startDate && used.has(cand)) cand = _prevDay(cand);
    if (cand >= _startDate && !used.has(cand)) {
        _logs.push({ date: cand, hours: 1 });
        _logs.sort((a, b) => a.date.localeCompare(b.date));
    }
    _render();
}

function _onAutofill() {
    if (!_startDate || !_completedAt) return;
    const used = new Set(_logs.map(l => l.date));
    let   cur  = _startDate;
    while (cur <= _completedAt) {
        const dow = new Date(cur + 'T00:00:00').getDay();
        if (dow >= 1 && dow <= 5 && !used.has(cur)) {
            _logs.push({ date: cur, hours: 0 });
            used.add(cur);
        }
        cur = _nextDay(cur);
    }
    _logs.sort((a, b) => a.date.localeCompare(b.date));
    _render();
}

function _onLogDate(e) {
    const idx  = parseInt(e.target.dataset.idx, 10);
    const val  = e.target.value;
    const used = new Set(_logs.filter((_, i) => i !== idx).map(l => l.date));
    if (used.has(val)) {
        alert('Ya existe un registro para esta fecha.');
        e.target.value = _logs[idx].date;
        return;
    }
    _logs[idx].date = val;
    _logs.sort((a, b) => a.date.localeCompare(b.date));
    _render();
}

function _onLogHours(e) {
    const idx = parseInt(e.target.dataset.idx, 10);
    _logs[idx].hours = parseFloat(e.target.value) || 0;
    _refreshTotal();
}

function _onLogDelete(e) {
    const row = e.target.closest('[data-idx]');
    if (!row) return;
    const idx = parseInt(row.dataset.idx, 10);
    _logs.splice(idx, 1);
    _render();
}

function _refreshTotal() {
    const el  = document.querySelector('.retro-total');
    if (!el) return;
    const total = _logs.reduce((s, l) => s + (parseFloat(l.hours) || 0), 0);
    const d     = _logs.length;
    el.innerHTML = d > 0
        ? `Total: <strong>${+total.toFixed(2)}h</strong> en <strong>${d}</strong> día${d !== 1 ? 's' : ''}`
        : '';
}

function _nextDay(d) {
    const dt = new Date(d + 'T00:00:00');
    dt.setDate(dt.getDate() + 1);
    return dt.toISOString().split('T')[0];
}

function _prevDay(d) {
    const dt = new Date(d + 'T00:00:00');
    dt.setDate(dt.getDate() - 1);
    return dt.toISOString().split('T')[0];
}
