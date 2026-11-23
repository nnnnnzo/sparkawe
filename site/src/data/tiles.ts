/**
 * Trait et couleur de chaque tuile présentée dans la section Produit.
 * Les couleurs sont celles des manifestes d'extension.
 * L'ordre suit celui de `copy.product.cards`.
 */
export interface TileMark {
  /** Variable CSS de la palette spectrale. */
  color: "violet" | "blue" | "cyan" | "lime" | "coral" | "honey";
  /** Contenu d'un svg 24 × 24, tracé Lucide. */
  icon: string;
}

export const TILE_MARKS: readonly TileMark[] = [
  {
    color: "blue",
    icon: '<polyline points="4 17 10 11 4 5" /> <line x1="12" x2="20" y1="19" y2="19" />',
  },
  {
    color: "violet",
    icon: '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" /> <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" /> <path d="M3 5a2 2 0 0 0 2 2h3" /> <path d="M3 3v13a2 2 0 0 0 2 2h3" />',
  },
  {
    color: "coral",
    icon: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /> <path d="M14 2v4a2 2 0 0 0 2 2h4" /> <path d="M10 9H8" /> <path d="M16 13H8" /> <path d="M16 17H8" />',
  },
  {
    color: "honey",
    icon: '<path d="M14 2v4a2 2 0 0 0 2 2h4" /> <path d="M4.268 21a2 2 0 0 0 1.727 1H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3" /> <path d="m9 18-1.5-1.5" /> <circle cx="5" cy="14" r="3" />',
  },
  {
    color: "lime",
    icon: '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />',
  },
  {
    color: "cyan",
    icon: '<circle cx="12" cy="12" r="10" /> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /> <path d="M2 12h20" />',
  },
];
