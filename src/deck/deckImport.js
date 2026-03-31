/** Importación de tarjetas desde Nextcloud Deck. */

import { STATE }      from '../core/state.js';
import { fetchDeckBoards, fetchDeckCards, createTask, fetchTasks } from '../api/api.js';
import { renderBoard } from '../board/render.js';
import { formatDate }  from '../shared/utils.js';
import { CONFIG }      from '../core/config.js';
import { openModal, closeModal } from '../shared/modal.js';

let _deckCards = [];

export async function openImportDeckModal() {
    STATE.selectedDeckCards.clear();
    _deckCards = [];

    const content = document.getElementById('deckModalContent');
    content.innerHTML = _loadingHtml('Loading your boards...');
    openModal('modalImportDeck');

    try {
        const boards = await fetchDeckBoards();

        if (boards.length === 0) {
            content.innerHTML = `
                <p class="text-center text-muted">
                    No boards found in your Nextcloud Deck account.
                </p>`;
            return;
        }

        content.innerHTML = `
            <div class="form-group mb-2">
                <label class="form-label" for="deckBoardSelect">
                    <i class="fas fa-columns"></i> Select a board
                </label>
                <select id="deckBoardSelect" class="form-select"
                        data-action="select-deck-board">
                    <option value="">-- Choose a board --</option>
                    ${boards.map(b => `
                        <option value="${b.id}">${_boardTitle(b)}</option>
                    `).join('')}
                </select>
            </div>
            <div id="deckCardList"></div>`;

    } catch (err) {
        content.innerHTML = `<p class="text-center text-danger">
            <i class="fas fa-exclamation-circle"></i> ${err.message}
        </p>`;
    }
}

export async function selectDeckBoard(boardId) {
    STATE.selectedDeckCards.clear();
    _deckCards = [];

    const cardList = document.getElementById('deckCardList');
    if (!boardId) {
        cardList.innerHTML = '';
        return;
    }

    cardList.innerHTML = _loadingHtml('Loading cards...');

    try {
        _deckCards = await fetchDeckCards(boardId);

        if (_deckCards.length === 0) {
            cardList.innerHTML = `
                <p class="text-center text-muted">
                    This board has no cards yet.
                </p>`;
            return;
        }

        const importedIds = new Set(
            STATE.tasks.filter(t => t.deck_card_id).map(t => String(t.deck_card_id))
        );

        cardList.innerHTML = `
            <div class="form-label mb-1" style="margin-top:.75rem;">
                <i class="fas fa-credit-card"></i>
                Cards (${_deckCards.length}) — click to select
            </div>
            <div class="deck-list">
                ${_deckCards.map(card => {
                    const alreadyImported = importedIds.has(String(card.id));
                    return `
                    <div class="deck-item${alreadyImported ? ' already-imported' : ''}"
                         data-deck-id="${card.id}"
                         ${alreadyImported ? '' : `data-action="toggle-deck" data-deck-id="${card.id}"`}>
                        <div class="deck-item-checkbox">
                            ${alreadyImported
                                ? '<i class="fas fa-check-double" title="Already imported"></i>'
                                : '<i class="fas fa-check" style="display:none;"></i>'}
                        </div>
                        <div class="deck-item-content">
                            <div class="deck-item-title">${card.title}</div>
                            <div class="deck-item-meta">
                                ${alreadyImported
                                    ? '<i class="fas fa-ban"></i> Already imported'
                                    : card.duedate
                                        ? `<i class="fas fa-calendar"></i> ${formatDate(card.duedate.split('T')[0])}`
                                        : 'No deadline'}
                            </div>
                        </div>
                    </div>`;
                }).join('')}
            </div>`;

    } catch (err) {
        cardList.innerHTML = `<p class="text-center text-danger">
            <i class="fas fa-exclamation-circle"></i> ${err.message}
        </p>`;
    }
}

export function toggleDeckSelection(deckId) {
    const item = document.querySelector(`[data-deck-id="${deckId}"]`);
    if (!item) return;

    if (STATE.selectedDeckCards.has(deckId)) {
        STATE.selectedDeckCards.delete(deckId);
        item.classList.remove('selected');
        item.querySelector('.fa-check').style.display = 'none';
    } else {
        STATE.selectedDeckCards.add(deckId);
        item.classList.add('selected');
        item.querySelector('.fa-check').style.display = 'block';
    }
}

export async function importSelectedDeckCards() {
    if (STATE.selectedDeckCards.size === 0) {
        alert('Please select at least one card to import.');
        return;
    }

    const btn = document.getElementById('btnImportSelected');
    if (btn) btn.disabled = true;

    const importedIds = new Set(
        STATE.tasks.filter(t => t.deck_card_id).map(t => String(t.deck_card_id))
    );

    let count = 0;
    for (const deckId of STATE.selectedDeckCards) {
        if (importedIds.has(String(deckId))) continue;

        const card = _deckCards.find(c => String(c.id) === String(deckId));
        if (!card) continue;

        try {
            await createTask({
                deck_card_id: card.id,
                title:        card.title,
                description:  card.description ?? '',
                column:       'actively-working',
                type:         'project',
                priority:     'medium',
                startDate:    new Date().toISOString().split('T')[0],
                deadline:     card.duedate ? card.duedate.split('T')[0] : null,
                subtasks:     [],
            });
            count++;
        } catch (err) {
            console.error(`[importSelectedDeckCards] Error al importar card ${deckId}:`, err);
        }
    }

    if (count === 0) {
        if (btn) btn.disabled = false;
        return;
    }

    if (CONFIG.BACKEND_URL) {
        try {
            const tareas = await fetchTasks();
            if (Array.isArray(tareas)) STATE.tasks = tareas;
        } catch (err) {
            console.error('[importSelectedDeckCards] Error al recargar tareas:', err);
        }
    }

    renderBoard();
    closeModal('modalImportDeck');
    alert(`${count} card(s) imported successfully!`);
    if (btn) btn.disabled = false;
}

function _loadingHtml(msg) {
    return `<p class="text-center text-muted">
        <i class="fas fa-spinner fa-spin"></i> ${msg}
    </p>`;
}

function _boardTitle(board) {
    return board.title || `Board ${board.id}`;
}
