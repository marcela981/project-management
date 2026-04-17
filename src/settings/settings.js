/** Panel lateral de configuración global. */

import { getPreferences, savePreferences } from '../weekly/weekly-data.js';

export function openSettings() {
    _loadIntoForm();
    document.getElementById('settingsPanel').classList.add('open');
    document.getElementById('settingsOverlay').classList.add('open');
}

export function closeSettings() {
    document.getElementById('settingsPanel').classList.remove('open');
    document.getElementById('settingsOverlay').classList.remove('open');
}

export function saveSettings() {
    const startDay = parseInt(document.getElementById('settingWeekStart').value, 10);
    const endDay   = parseInt(document.getElementById('settingWeekEnd').value, 10);
    savePreferences({ week_start_day: startDay, week_end_day: endDay });
    closeSettings();
}

function _loadIntoForm() {
    const prefs = getPreferences();
    document.getElementById('settingWeekStart').value = prefs.week_start_day;
    document.getElementById('settingWeekEnd').value   = prefs.week_end_day;
}
