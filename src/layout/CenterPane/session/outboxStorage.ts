import { t } from "../../../i18n";
import type { Submission } from "./outbox";

/** A cache of requests awaiting a backend receipt. The backend's workspace UUID scopes every key. */
let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("velaterm-chat-outbox", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("requests");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(t("chat.recovery.saveError")));
  });
  return database;
}

export async function storeOutbox(key: string, items: Submission[]): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("requests", "readwrite");
    tx.objectStore("requests").put(items, key);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error(t("chat.recovery.saveError")));
  });
}

export async function readOutbox(key: string): Promise<Submission[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("requests", "readonly").objectStore("requests").get(key);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(new Error(t("chat.recovery.readError")));
  });
}
