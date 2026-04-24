export const appEvents = new EventTarget();

export function emitTimeLogChanged(detail) {
    appEvents.dispatchEvent(new CustomEvent('timelog:changed', { detail }));
}

export function onTimeLogChanged(handler) {
    appEvents.addEventListener('timelog:changed', handler);
    return () => appEvents.removeEventListener('timelog:changed', handler);
}
