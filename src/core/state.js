/** Estado global compartido: tareas, tipo en modal, selección Deck. */

export const STATE = {
    tasks: [],
    currentTaskType: 'project',
    editingTaskId: null,
    selectedDeckCards: new Set()
};
