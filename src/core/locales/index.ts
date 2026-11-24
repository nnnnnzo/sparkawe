import activity from "./activity.ts";
import data from "./data.ts";
import errors from "./errors.ts";
import explorer from "./explorer.ts";
import manifests from "./manifests.ts";
import markdown from "./markdown.ts";
import openalex from "./openalex.ts";
import preview from "./preview.ts";
import shell from "./shell.ts";
import store from "./store.ts";
import terminal from "./terminal.ts";
import web from "./web.ts";

/**
 * Toutes les traductions, fusionnées par domaine. Chaque clé est unique :
 * le test `i18n.test.ts` vérifie qu'aucun domaine ne se chevauche.
 */
const messages = {
  ...activity,
  ...data,
  ...errors,
  ...explorer,
  ...manifests,
  ...markdown,
  ...openalex,
  ...preview,
  ...shell,
  ...store,
  ...terminal,
  ...web,
} as const;

export type TranslationKey = keyof typeof messages;

export default messages;
