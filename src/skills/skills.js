/** Vista: Skills – auto-evaluación, evaluar compañeros (leader), agregar skills, comparativa. */

import {
    fetchSkills, fetchUserSkills, updateMySkills,
    fetchSkillsComparison, fetchCompare, endorseSkill,
    evaluateUser, createSkill,
} from '../dashboard/dashApi.js';
let _currentUser      = null;
let _currentContainer = null;       // reference for re-renders
let _pendingEndorse   = null;

const SKILL_CATEGORIES = ['Frontend', 'Backend', 'DevOps', 'Soft', 'Diseño', 'Data', 'Gestión', 'Otra'];

// ─── Public ───────────────────────────────────────────────────────────────────

export async function renderSkills(container, user) {
    _currentUser      = user;
    _currentContainer = container;

    container.innerHTML = `
        <div class="view-header">
            <h2 class="view-title"><i class="fas fa-star"></i> Skills</h2>
        </div>
        <div class="skills-tabs">
            <button class="skills-tab active" data-tab="my-skills">Mis Skills</button>
            <button class="skills-tab" data-tab="comparison">Comparativa del equipo</button>
        </div>
        <div id="skillsContent">
            <div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Cargando…</div>
        </div>`;

    container.querySelectorAll('.skills-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            container.querySelectorAll('.skills-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            if (tab.dataset.tab === 'my-skills') _loadMySkills(container);
            else _loadComparison(container);
        });
    });

    await _loadMySkills(container);
}

export async function submitEndorse() {
    if (!_pendingEndorse) return;
    const modal     = document.getElementById('modalEndorse');
    const score     = parseInt(modal.querySelector('#endorseScore').value, 10);
    const comment   = modal.querySelector('#endorseComment').value.trim() || null;
    const btn       = document.getElementById('btnSubmitEndorse');
    btn.disabled    = true;
    btn.innerHTML   = '<i class="fas fa-spinner fa-spin"></i> Enviando…';
    try {
        await endorseSkill(_pendingEndorse.userId, _pendingEndorse.skillId, score, comment);
        modal.classList.remove('active');
        _pendingEndorse = null;
    } catch (err) {
        alert('Error al endorsar: ' + err.message);
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fas fa-star"></i> Endorsar';
    }
}

// ─── "Mis Skills" tab ─────────────────────────────────────────────────────────

async function _loadMySkills(container) {
    const content = container.querySelector('#skillsContent');
    content.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Cargando skills…</div>';
    try {
        const [baseSkills, mySkills] = await Promise.all([fetchSkills(), fetchUserSkills(_currentUser.id)]);

        const allSkills = baseSkills ?? [];

        if (!allSkills?.length) {
            content.innerHTML = '<div class="empty-state">No hay skills configuradas aún.</div>';
            return;
        }

        const myMap = {};
        (mySkills ?? []).forEach(s => { myMap[s.skillId ?? s.id] = s; });

        const isLeader    = _currentUser?.role === 'leader' || _currentUser?.role === 'admin';
        const teamMembers = [];

        content.innerHTML = `
            ${_htmlSelfEval(allSkills, myMap)}
            ${isLeader ? _htmlEvalOther(teamMembers) : ''}`;

        _bindSelfEval(content, allSkills);
        if (isLeader) _bindEvalOther(content, allSkills);

    } catch (err) {
        content.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-circle"></i> ${_esc(err.message)}</div>`;
    }
}

// ── HTML builders ─────────────────────────────────────────────────────────────

function _htmlSelfEval(allSkills, myMap) {
    return `
    <div class="section-card">
        <div class="section-title-row">
            <h3 class="section-title"><i class="fas fa-sliders-h"></i> Mi auto-evaluación</h3>
            <div class="skills-actions-row">
                <button class="btn btn-secondary btn-sm" id="btnToggleAddSkill">
                    <i class="fas fa-plus"></i> Agregar skill
                </button>
                <button class="btn btn-primary btn-sm" id="btnSaveSkills">
                    <i class="fas fa-save"></i> Guardar cambios
                </button>
            </div>
        </div>

        <div class="skills-add-form" id="addSkillForm">
            <span class="add-skill-label"><i class="fas fa-plus-circle"></i> Nueva skill</span>
            <input  type="text"   class="form-input"   id="newSkillName"     placeholder="Nombre de la skill…" />
            <select class="form-select" id="newSkillCategory">
                <option value="">— Categoría —</option>
                ${SKILL_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" id="btnConfirmAddSkill">
                <i class="fas fa-check"></i> Agregar
            </button>
            <button class="btn btn-secondary btn-sm" id="btnCancelAddSkill">Cancelar</button>
        </div>

        <div class="skills-grid" id="mySkillsGrid">
            ${allSkills.map(s => _htmlSkillCard(s, myMap[s.id])).join('')}
        </div>
    </div>`;
}

function _htmlSkillCard(skill, entry) {
    const score        = entry?.score ?? 5;
    const endorsements = entry?.endorsements ?? [];
    return `
    <div class="skill-card" data-skill-id="${_esc(skill.id)}">
        <div class="skill-header">
            <span class="skill-name">${_esc(skill.name)}</span>
            ${skill.category ? `<span class="skill-category">${_esc(skill.category)}</span>` : ''}
        </div>
        <div class="skill-score-row">
            <input type="range" class="skill-range" min="1" max="10" value="${score}"
                   data-skill-id="${_esc(skill.id)}">
            <span class="skill-score-val">${score}</span>
        </div>
        ${endorsements.length ? `
        <div class="endorsements-summary">
            <i class="fas fa-thumbs-up"></i>
            ${endorsements.length} endorsement${endorsements.length !== 1 ? 's' : ''}
            &ndash; prom. ${(endorsements.reduce((s, e) => s + (e.score ?? 0), 0) / endorsements.length).toFixed(1)}
        </div>` : ''}
    </div>`;
}

function _htmlEvalOther(teamMembers) {
    return `
    <div class="section-card eval-other-section">
        <div class="section-title-row">
            <div>
                <h3 class="section-title" style="margin-bottom:.25rem">
                    <i class="fas fa-user-check"></i> Evaluar a un compañero
                </h3>
                <p class="eval-other-desc">
                    Como líder, puedes registrar tu evaluación de las skills de cada miembro del equipo.
                </p>
            </div>
        </div>

        <div class="eval-other-filters">
            <div class="filter-group">
                <label class="filter-label"><i class="fas fa-user"></i> Miembro</label>
                <select class="form-select-sm" id="evalMemberSelect">
                    <option value="">— Selecciona un miembro —</option>
                    ${teamMembers.map(m => `
                        <option value="${m.userId}">
                            ${_esc(m.displayname)}${m.jobTitle ? '&nbsp;·&nbsp;' + _esc(m.jobTitle) : ''}
                        </option>`).join('')}
                </select>
            </div>
        </div>

        <div id="evalOtherContent"></div>
    </div>`;
}

// ── Event binding ─────────────────────────────────────────────────────────────

function _bindRanges(root) {
    root.querySelectorAll('.skill-range').forEach(input => {
        input.addEventListener('input', () => {
            input.closest('.skill-card').querySelector('.skill-score-val').textContent = input.value;
        });
    });
}

function _bindSelfEval(content, allSkills) {
    _bindRanges(content.querySelector('#mySkillsGrid'));

    // Save self-evaluation
    content.querySelector('#btnSaveSkills')?.addEventListener('click', async () => {
        const skills = [...content.querySelectorAll('#mySkillsGrid .skill-range')].map(inp => ({
            skillId: inp.dataset.skillId,
            score:   parseInt(inp.value, 10),
        }));
        const btn = content.querySelector('#btnSaveSkills');
        btn.disabled  = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
        try {
            await updateMySkills(skills);
            btn.innerHTML = '<i class="fas fa-check"></i> Guardado';
            setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar cambios'; }, 2000);
        } catch (err) {
            btn.disabled  = false;
            btn.innerHTML = '<i class="fas fa-save"></i> Guardar cambios';
            alert('Error al guardar: ' + err.message);
        }
    });

    // Toggle add-skill form
    const addForm = content.querySelector('#addSkillForm');
    content.querySelector('#btnToggleAddSkill')?.addEventListener('click', () => {
        const open = addForm.classList.toggle('open');
        if (open) content.querySelector('#newSkillName')?.focus();
    });

    content.querySelector('#btnCancelAddSkill')?.addEventListener('click', () => {
        addForm.classList.remove('open');
        content.querySelector('#newSkillName').value    = '';
        content.querySelector('#newSkillCategory').value = '';
    });

    content.querySelector('#btnConfirmAddSkill')?.addEventListener('click', async () => {
        const name     = content.querySelector('#newSkillName').value.trim();
        const category = content.querySelector('#newSkillCategory').value;
        if (!name) { content.querySelector('#newSkillName').focus(); return; }

        const btn = content.querySelector('#btnConfirmAddSkill');
        btn.disabled  = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
            await createSkill(name, category || null);
            await _loadMySkills(_currentContainer);
        } catch (err) {
            btn.disabled  = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Agregar';
            alert('Error al agregar skill: ' + err.message);
        }
    });
}

function _bindEvalOther(content, allSkills) {
    const select      = content.querySelector('#evalMemberSelect');
    const evalContent = content.querySelector('#evalOtherContent');
    if (!select) return;

    select.addEventListener('change', async () => {
        const userId = select.value;
        if (!userId) { evalContent.innerHTML = ''; return; }

        const memberName = select.options[select.selectedIndex].text.split('\u00b7')[0].trim();
        evalContent.innerHTML = '<div class="loading-state" style="padding:1.5rem 0"><i class="fas fa-spinner fa-spin"></i></div>';

        try {
            let memberMap = {};
            const raw = await fetchUserSkills(userId) ?? [];
            raw.forEach(s => { memberMap[s.skillId ?? s.id] = s; });

            evalContent.innerHTML = `
                <div class="eval-member-label">
                    <div class="member-avatar sm">${_initials(memberName)}</div>
                    <span>Evaluando a <strong>${_esc(memberName)}</strong></span>
                </div>
                <div class="skills-grid" id="evalSkillsGrid">
                    ${allSkills.map(s => _htmlSkillCard(s, memberMap[s.id])).join('')}
                </div>
                <div class="eval-save-row">
                    <button class="btn btn-primary" id="btnSaveEval">
                        <i class="fas fa-save"></i> Guardar evaluación de ${_esc(memberName)}
                    </button>
                </div>`;

            _bindRanges(evalContent.querySelector('#evalSkillsGrid'));

            evalContent.querySelector('#btnSaveEval')?.addEventListener('click', async () => {
                const skills = [...evalContent.querySelectorAll('#evalSkillsGrid .skill-range')].map(inp => ({
                    skillId: inp.dataset.skillId,
                    score:   parseInt(inp.value, 10),
                }));
                const btn = evalContent.querySelector('#btnSaveEval');
                btn.disabled  = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando…';
                try {
                    await evaluateUser(userId, skills);
                    btn.innerHTML = '<i class="fas fa-check"></i> Evaluación guardada';
                    setTimeout(() => {
                        btn.disabled  = false;
                        btn.innerHTML = `<i class="fas fa-save"></i> Guardar evaluación de ${_esc(memberName)}`;
                    }, 2500);
                } catch (err) {
                    btn.disabled  = false;
                    btn.innerHTML = `<i class="fas fa-save"></i> Guardar evaluación de ${_esc(memberName)}`;
                    alert('Error al guardar: ' + err.message);
                }
            });

        } catch (err) {
            evalContent.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-circle"></i> ${_esc(err.message)}</div>`;
        }
    });
}

// ─── "Comparativa" tab ────────────────────────────────────────────────────────

async function _loadComparison(container) {
    const content = container.querySelector('#skillsContent');
    content.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Cargando comparativa…</div>';
    try {
        const [comparison, radarData] = await Promise.all([fetchSkillsComparison(), fetchCompare()]);

        if (!comparison && !radarData) {
            content.innerHTML = '<div class="empty-state">Sin datos de comparativa.</div>';
            return;
        }

        // ── Radar (full-width) ──
        let radarHTML = '';
        if (radarData?.labels?.length) {
            radarHTML = `
            <div class="section-card radar-full">
                <div class="radar-header">
                    <h3 class="chart-title"><i class="fas fa-chart-pie"></i> Tú vs. promedio del equipo</h3>
                    <div class="radar-legend-hint">
                        <span class="radar-dot" style="background:#f97316"></span><span>Yo</span>
                        <span class="radar-dot" style="background:#3b82f6;margin-left:.75rem"></span><span>Equipo</span>
                    </div>
                </div>
                <div class="chart-container-radar">
                    <canvas id="chartSkillsRadar"></canvas>
                </div>
            </div>`;
        }

        // ── Comparison table ──
        let tableHTML = '';
        if (comparison?.skills?.length && comparison?.members?.length) {
            const skills  = comparison.skills;
            const members = comparison.members;
            tableHTML = `
            <div class="section-card">
                <h3 class="section-title"><i class="fas fa-table"></i> Skills por miembro</h3>
                <div class="table-wrapper">
                    <table class="data-table skills-table">
                        <thead>
                            <tr>
                                <th>Skill</th>
                                ${members.map(m => `
                                <th>
                                    <div class="member-th">
                                        <div class="member-avatar sm">${_initials(m.displayname || m.userId)}</div>
                                        <span>${_esc(m.displayname || m.userId)}</span>
                                    </div>
                                </th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${skills.map(skill => `
                            <tr>
                                <td class="skill-name-cell">${_esc(skill.name)}</td>
                                ${members.map(m => {
                                    const score = m.skills?.[skill.id]?.score;
                                    const isMe  = m.userId === _currentUser?.id;
                                    return `
                                    <td class="${isMe ? 'my-score-cell' : ''}">
                                        <div class="score-cell-inner">
                                            <span class="score-pill score-${_scoreLevel(score)}">${score ?? '—'}</span>
                                            ${!isMe ? `
                                            <button class="btn-endorse" title="Endorsar"
                                                data-action="open-endorse"
                                                data-user-id="${m.userId}"
                                                data-skill-id="${skill.id}"
                                                data-user-name="${_esc(m.displayname || m.userId)}"
                                                data-skill-name="${_esc(skill.name)}">
                                                <i class="fas fa-thumbs-up"></i>
                                            </button>` : ''}
                                        </div>
                                    </td>`;
                                }).join('')}
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
        }

        content.innerHTML = `${radarHTML}${tableHTML}`;

        if (radarData?.labels?.length) {
            const { renderRadarChart } = await import('../dashboard/chartUtils.js');
            const datasets = [];
            if (radarData.myScores) datasets.push({ label: 'Yo',              data: radarData.myScores });
            if (radarData.teamAvg)  datasets.push({ label: 'Promedio equipo', data: radarData.teamAvg  });
            renderRadarChart('chartSkillsRadar', radarData.labels, datasets);
        }

        content.querySelectorAll('[data-action="open-endorse"]').forEach(btn => {
            btn.addEventListener('click', () => {
                _pendingEndorse = {
                    userId:    btn.dataset.userId,
                    skillId:   btn.dataset.skillId,
                    userName:  btn.dataset.userName,
                    skillName: btn.dataset.skillName,
                };
                _openEndorseModal();
            });
        });

    } catch (err) {
        content.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-circle"></i> ${_esc(err.message)}</div>`;
    }
}

// ─── Endorse modal ────────────────────────────────────────────────────────────

function _openEndorseModal() {
    const modal = document.getElementById('modalEndorse');
    if (!modal || !_pendingEndorse) return;
    modal.querySelector('#endorseTitle').textContent =
        `Endorsar "${_pendingEndorse.skillName}" de ${_pendingEndorse.userName}`;
    const scoreInput = modal.querySelector('#endorseScore');
    const scoreVal   = modal.querySelector('#endorseScoreValue');
    scoreInput.value    = 5;
    scoreVal.textContent = 5;
    modal.querySelector('#endorseComment').value = '';
    modal.classList.add('active');
    scoreInput.oninput = () => { scoreVal.textContent = scoreInput.value; };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _scoreLevel(score) {
    if (score == null) return 'none';
    if (score >= 8)    return 'high';
    if (score >= 5)    return 'mid';
    return 'low';
}

function _initials(name) {
    return (name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
