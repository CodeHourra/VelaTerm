import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../../ipc/chat", () => ({ chatSend: vi.fn(), resolveChatImage: vi.fn() }));
vi.mock("./outboxStorage", () => ({ readOutbox: vi.fn(), storeOutbox: vi.fn() }));
import { readOutbox, storeOutbox } from "./outboxStorage";
import { chatSend } from "../../../ipc/chat";
import { acknowledgeSubmissions, ChatVersions, createSubmission, deliverSubmission, retrySubmission, restoreSubmissions, submissionsFor, useOutbox } from "./outbox";

beforeEach(() => {
  useOutbox.setState({ sessions: {} });
  vi.mocked(chatSend).mockReset();
  vi.mocked(readOutbox).mockReset().mockResolvedValue([]);
  vi.mocked(storeOutbox).mockReset().mockResolvedValue();
});

it("keeps one optimistic message until both its row and receipt arrive, in either order", async () => {
  for (const eventFirst of [true, false]) {
    let resolve!: (status: "sent") => void;
    vi.mocked(chatSend).mockImplementation(() => new Promise(done => { resolve = done; }));
    const item = createSubmission("s", "Hello", [], "queue");
    const sending = deliverSubmission("s", item);
    await deliverSubmission("s", item);
    if (eventFirst) acknowledgeSubmissions("s", [item.id]);
    resolve("sent");
    await sending;
    if (!eventFirst) {
      expect(submissionsFor("s")[0].status).toBe("sent");
      acknowledgeSubmissions("s", [item.id]);
    }
    expect(submissionsFor("s")).toEqual([]);
  }
  expect(chatSend).toHaveBeenCalledTimes(2);
});

it("rechecks uncertain delivery with the same identifier and retains its attachments", async () => {
  const error = new Error("Disconnected");
  error.name = "TransportError";
  vi.mocked(chatSend).mockRejectedValueOnce(error).mockResolvedValueOnce("queued");
  const images = [{ mimeType: "image/png", data: "abc" }];
  const item = createSubmission("s", "Hello", images, "interrupt");
  await deliverSubmission("s", item);
  expect(submissionsFor("s")[0].status).toBe("unknown");
  await retrySubmission("s", submissionsFor("s")[0]);
  expect(chatSend).toHaveBeenNthCalledWith(2, "s", "Hello", "interrupt", images, item.id);
  expect(submissionsFor("s")[0].status).toBe("queued");
});

it("retries a confirmed rejection with its original identifier and the same behavior", async () => {
  vi.mocked(chatSend).mockRejectedValueOnce(new Error("No running turn")).mockResolvedValueOnce("sent");
  const item = createSubmission("s", "Hello", [], "steer");
  await deliverSubmission("s", item);
  await retrySubmission("s", submissionsFor("s")[0]);
  expect(submissionsFor("s")).toHaveLength(1);
  expect(submissionsFor("s")[0].id).toBe(item.id);
  expect(submissionsFor("s")[0].behavior).toBe("steer");
});

it("rejects old collection versions and old processes after a restart", () => {
  const versions = new ChatVersions();
  expect(versions.accept("rows", 5, 100)).toBe(true);
  expect(versions.accept("rows", 4, 100)).toBe(false);
  expect(versions.accept("queue", 2, 100)).toBe(true);
  expect(versions.accept("queue", 1, 100)).toBe(false);
  expect(versions.accept("rows", 1, 200)).toBe(true);
  expect(versions.accept("rows", 999, 100)).toBe(false);
});

it("waits for durable storage and never starts or sends after a failed commit", async () => {
  await restoreSubmissions("commit-test", "workspace", []);
  await vi.waitFor(() => expect(storeOutbox).toHaveBeenCalled());
  let reject!: (reason: Error) => void;
  vi.mocked(storeOutbox).mockRejectedValue(new Error("storage unavailable")).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const item = createSubmission("commit-test", "preserve me", [], "queue");
  const start = vi.fn();
  const delivery = deliverSubmission("commit-test", item, start);
  await vi.waitFor(() => expect(reject).toBeDefined());
  expect(chatSend).not.toHaveBeenCalled();
  reject(new Error("storage unavailable"));
  await delivery;
  expect(start).not.toHaveBeenCalled();
  expect(chatSend).not.toHaveBeenCalled();
  expect(submissionsFor("commit-test")[0]).toMatchObject({ id: item.id, text: "preserve me", status: "failed" });
});

it("restores the original uncertain identity and retires it only on authoritative proof", async () => {
  const image = { mimeType: "image/png", data: "AQID" };
  vi.mocked(readOutbox).mockResolvedValue([{ id: "msg-cached", text: "pending", images: [image], behavior: "steer", status: "sending" }]);
  await restoreSubmissions("cache-test", "workspace", []);
  expect(submissionsFor("cache-test")[0]).toMatchObject({ id: "msg-cached", images: [image], status: "unknown" });
  acknowledgeSubmissions("cache-test", ["msg-cached"]);
  expect(submissionsFor("cache-test")).toHaveLength(1);
  acknowledgeSubmissions("cache-test", ["msg-cached"], true);
  expect(submissionsFor("cache-test")).toEqual([]);
});

it("keeps another backend workspace from inheriting pending requests with the same session id", async () => {
  await restoreSubmissions("scope-test", "first-workspace", []);
  createSubmission("scope-test", "first workspace only", [], "queue");
  await restoreSubmissions("scope-test", "second-workspace", []);
  expect(submissionsFor("scope-test")).toEqual([]);
});
