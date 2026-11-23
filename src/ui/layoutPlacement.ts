/**
 * Placement demandé par une tuile qui s’ouvre.
 *
 * Une tuile créée par un agent ou par une page qui demande une nouvelle
 * fenêtre doit se poser en onglet dans le groupe de la tuile d’origine, et pas
 * selon le mode de l’espace. La demande est volatile : elle est consommée au
 * moment où Dockview ajoute le panneau, donc rien n’est persisté.
 */

const groupRequests = new Map<string, string>();

export function openAsTab(tile: string, reference: string) {
  groupRequests.set(tile, reference);
}

export function takeGroupReference(tile: string) {
  const reference = groupRequests.get(tile);
  groupRequests.delete(tile);
  return reference;
}
