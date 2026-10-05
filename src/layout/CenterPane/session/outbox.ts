import { create } from "zustand";
import { genId } from "../../../genId";
import { chatSend, resolveChatImage, type ChatImage, type ChatImageValue, type SendBehavior } from "../../../ipc/chat";
import { readOutbox, storeOutbox } from "./outboxStorage";

export interface Submission {
  id: string;
  text: string;
  images: ChatImageValue[];
  behavior: SendBehavior;
  status: "sending" | "sent" | "queued" | "failed" | "unknown";
  error?: string;
  observed?: boolean;
  recovered?: boolean;
}

const EMPTY: Submission[] = [];
const scopes = new Map<string, string>();
const writes = new Map<string, Promise<void>>();
export const useOutbox = create<{ sessions: Record<string, Submission[]> }>(() => ({ sessions: {} }));
export const submissionsFor = (session: string) => useOutbox.getState().sessions[session] ?? EMPTY;
export const emptySubmissions = EMPTY;

function change(session: string, update: (items: Submission[]) => Submission[]) {
  useOutbox.setState(state => ({ sessions: { ...state.sessions, [session]: update(state.sessions[session] ?? EMPTY) } }));
  const scope = scopes.get(session);
  if (scope) {
    const items = submissionsFor(session);
    const previous = writes.get(session) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => storeOutbox(`${scope}:${session}`, items));
    writes.set(session, next);
    void next.catch(() => {});
  }
}

export async function restoreSubmissions(session: string, scope: string, recovered: Submission[]) {
  const key = `${scope}:${session}`;
  const previousScope = scopes.get(session);
  const previous = writes.get(session);
  if (previous) await previous.catch(() => {});
  const cached = await readOutbox(key);
  scopes.set(session, scope);
  change(session, items => {
    const merged = new Map<string, Submission>(cached.map(item => [item.id, { ...item, status: item.status === "sending" ? "unknown" as const : item.status }]));
    if (!previousScope || previousScope === scope) items.forEach(item => merged.set(item.id, item));
    recovered.forEach(item => merged.set(item.id, item));
    return [...merged.values()];
  });
}

export function acknowledgeSubmissions(session: string, ids: string[], authoritative = false) {
  const confirmed = new Set(ids);
  if (submissionsFor(session).some(item => confirmed.has(item.id))) {
    change(session, items => items.flatMap(item => !confirmed.has(item.id) ? [item]
      : authoritative || item.status === "sent" || item.status === "queued" ? [] : [{ ...item, observed: true }]));
  }
}

/** Only unconfirmed UI state lives here; mounted panes share it across navigation. */
export function createSubmission(session: string, text: string, images: ChatImage[], behavior: SendBehavior): Submission {
  const item: Submission = { id: `msg-${genId()}`, text, images, behavior, status: "sending" };
  change(session, items => [...items, item]);
  return item;
}

const active = new Set<string>();
export async function deliverSubmission(session: string, item: Submission, start?: () => Promise<void>) {
  const key = `${session}:${item.id}`;
  if (active.has(key)) return;
  active.add(key);
  change(session, items => items.map(value => value.id === item.id ? { ...value, status: "sending", error: undefined } : value));
  try {
    // Do not clear the composer and launch a provider with the only recoverable copy still in memory.
    const saved = writes.get(session);
    if (saved) await saved;
    const images = item.images.some(image => "attachmentId" in image) ? await Promise.all(item.images.map(resolveChatImage)) : item.images as ChatImage[];
    if (start) await start();
    const receipt = await chatSend(session, item.text, item.behavior, images.length ? images : undefined, item.id);
    // A steered message is one that went out, whether or not the recipient is free to read it yet; the
    // composer draws it like any other sent message.
    const status = receipt === "steered" || receipt === "blocked" ? "sent" : receipt;
    change(session, items => items.flatMap(value => value.id !== item.id ? [value]
      : status === "command" || value.observed ? [] : [{ ...value, status }]));
  } catch (error) {
    const unknown = (error instanceof Error && error.name === "TransportError") || String(error).includes("chat_submission_pending");
    change(session, items => items.map(value => value.id === item.id
      ? { ...value, status: unknown ? "unknown" : "failed", error: unknown ? undefined : String(error) } : value));
  } finally {
    active.delete(key);
  }
}

export function retrySubmission(session: string, item: Submission, start?: () => Promise<void>) {
  // The backend reclaims only proven rejections; every retry retains the original operation identity.
  return deliverSubmission(session, item, start);
}

/** Revisions belong to one agent process and to one independently updated collection. */
export class ChatVersions {
  epoch = 0;
  rows = 0;
  queue = 0;
  accept(collection: "rows" | "queue", revision?: number, epoch?: number) {
    if (epoch !== undefined && epoch < this.epoch) return false;
    if (epoch !== undefined && epoch > this.epoch) {
      this.epoch = epoch;
      this.rows = this.queue = 0;
    }
    if (revision === undefined) return true;
    if (revision < this[collection]) return false;
    this[collection] = revision;
    return true;
  }
}
