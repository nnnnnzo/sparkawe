/**
 * Signal de disposition pour les contenus qui ne vivent pas dans le DOM.
 *
 * Une vue native — la page du navigateur, par exemple — ne suit ni les
 * animations FLIP de Dockview ni les mutations du DOM. Elle est donc masquée
 * pendant le déplacement animé d'un groupe, pas pendant son redimensionnement direct.
 */

let moving = false;
const motionListeners = new Set<() => void>();
const changeListeners = new Set<() => void>();

function emit(listeners: Set<() => void>) {
  for (const listener of listeners) listener();
}

/**
 * Plusieurs animations peuvent se chevaucher : le drapeau reste levé tant
 * qu’une fin n’est pas arrivée, et la dernière fin le rabaisse.
 */
export function beginLayoutMotion() {
  if (moving) return;
  moving = true;
  emit(motionListeners);
}

export function endLayoutMotion() {
  if (!moving) return;
  moving = false;
  emit(motionListeners);
}

export function layoutIsMoving() {
  return moving;
}

export function subscribeLayoutMotion(listener: () => void) {
  motionListeners.add(listener);
  return () => {
    motionListeners.delete(listener);
  };
}

let dragging = false;
const dragListeners = new Set<() => void>();

/**
 * Un onglet ou un groupe se déplace au pointeur. La tuile remplace alors sa
 * vue native par une image : dans le DOM, la vignette et la cible de dépôt
 * passent au-dessus, ce qu’une vue native ne permet pas.
 */
export function beginPanelDrag() {
  if (dragging) return;
  dragging = true;
  emit(dragListeners);
}

export function endPanelDrag() {
  if (!dragging) return;
  dragging = false;
  emit(dragListeners);
}

export function layoutIsDragging() {
  return dragging;
}

export function subscribeLayoutDrag(listener: () => void) {
  dragListeners.add(listener);
  return () => {
    dragListeners.delete(listener);
  };
}

/** La disposition a changé : les rectangles mesurés ne sont plus valables. */
export function notifyLayoutChange() {
  emit(changeListeners);
}

export function subscribeLayoutChange(listener: () => void) {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}
