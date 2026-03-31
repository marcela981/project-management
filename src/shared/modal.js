/** Helpers para abrir/cerrar modales por ID. */

export function openModal(id) {
    document.getElementById(id).classList.add('active');
}

export function closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
}
