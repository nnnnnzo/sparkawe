import { invoke } from "@tauri-apps/api/core";
import type { ServiceKey } from "../sdk/index.ts";

export interface NotificationsService {
  /** Notification système. Échoue si l’OS refuse ; l’appelant décide du repli. */
  send(options: { title: string; body?: string }): Promise<void>;
}

/**
 * Service noyau, lu par identifiant : une extension peut l’obtenir avec
 * `api.services.get(sparkNotifications)` sans dépendre du bundle de l’hôte.
 */
export const sparkNotifications: ServiceKey<NotificationsService> = {
  id: "spark.notifications@1",
};

export const notifications: NotificationsService = {
  async send({ title, body }) {
    await invoke("notify_desktop", { title, body });
  },
};
