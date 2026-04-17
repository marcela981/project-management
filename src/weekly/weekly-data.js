/** Datos mock y persistencia localStorage para el weekly tracker. */

const STORAGE_KEY = 'weekly_blocks_mock';

export const MOCK_TASKS = [
    { id: 1, title: 'Desarrollo móvil',     type: 'task',     priority: 'high',   column: 'actively_working', completed: false },
    { id: 2, title: 'Revisión de PRs',       type: 'task',     priority: 'medium', column: 'working_right_now', completed: false },
    { id: 3, title: 'Reunión weekly',        type: 'activity', priority: 'high',   column: 'activities',        completed: false },
    { id: 4, title: 'Deploy producción',     type: 'task',     priority: 'urgent', column: 'actively_working', completed: false },
    { id: 5, title: 'Code review backend',   type: 'task',     priority: 'low',    column: 'activities',        completed: true  },
];

const DEFAULT_BLOCKS = [
    { id: 1, day: 1, task_id: 1,                                           start_time: '07:00', end_time: '15:00' },
    { id: 2, day: 1, task_id: 3,                                           start_time: '15:00', end_time: '16:00' },
    { id: 3, day: 2, task_id: 2,                                           start_time: '09:00', end_time: '12:00' },
    { id: 4, day: 2, block_type: 'personal', title: 'Almuerzo', color: '#e8b86d', start_time: '12:00', end_time: '13:00' },
    { id: 5, day: 3, task_id: 3,                                           start_time: '10:00', end_time: '11:00' },
];

export function loadBlocks() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (_) {}
    const copy = DEFAULT_BLOCKS.map(b => ({ ...b }));
    saveBlocks(copy);
    return copy;
}

export function saveBlocks(blocks) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blocks));
}

export function addBlock(block) {
    const blocks = loadBlocks();
    const id = blocks.length > 0 ? Math.max(...blocks.map(b => b.id)) + 1 : 1;
    const newBlock = { ...block, id };
    blocks.push(newBlock);
    saveBlocks(blocks);
    return newBlock;
}

export function removeBlock(blockId) {
    saveBlocks(loadBlocks().filter(b => b.id !== blockId));
}

export function updateBlock(blockId, updates) {
    saveBlocks(loadBlocks().map(b => b.id === blockId ? { ...b, ...updates } : b));
}

export function getPreferences() {
    try {
        const raw = localStorage.getItem('user_preferences');
        if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { week_start_day: 1, week_end_day: 5 };
}

export function savePreferences(prefs) {
    localStorage.setItem('user_preferences', JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent('preferences-updated', { detail: prefs }));
}

/** Returns array of Date objects for the week containing referenceDate, per prefs. */
export function getWeekDays(referenceDate, prefs) {
    const { week_start_day, week_end_day } = prefs;
    const date = new Date(referenceDate);
    date.setHours(0, 0, 0, 0);

    const daysBack = (date.getDay() - week_start_day + 7) % 7;
    const start = new Date(date);
    start.setDate(date.getDate() - daysBack);

    const days = [];
    const cur = new Date(start);
    for (let i = 0; i < 7; i++) {
        days.push(new Date(cur));
        if (cur.getDay() === week_end_day) break;
        cur.setDate(cur.getDate() + 1);
    }
    return days;
}

export function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

export function blockDurationH(block) {
    const mins = timeToMinutes(block.end_time) - timeToMinutes(block.start_time);
    return +(mins / 60).toFixed(1);
}

export function dayHours(blocks, dayOfWeek) {
    return blocks
        .filter(b => b.day === dayOfWeek)
        .reduce((sum, b) => sum + blockDurationH(b), 0);
}

export function hasOverlap(blocks, newBlock, excludeId = null) {
    const ns = timeToMinutes(newBlock.start_time);
    const ne = timeToMinutes(newBlock.end_time);
    return blocks.some(b => {
        if (b.id === excludeId) return false;
        if (b.day !== newBlock.day) return false;
        const bs = timeToMinutes(b.start_time);
        const be = timeToMinutes(b.end_time);
        return ns < be && ne > bs;
    });
}
