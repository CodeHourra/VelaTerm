import { afterEach, describe, expect, it, vi } from "vitest";
import { genId } from "./genId";

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("IDs across browser security contexts", () => {
  it("uses the native UUID implementation when available", () => {
    const id = "08f8a04f-9352-4254-b486-ef72b7a20b78";
    const randomUUID = vi.fn(() => id);
    const randomValues = vi.fn(getRandomValues);
    vi.stubGlobal("crypto", { randomUUID, getRandomValues: randomValues });
    expect(genId()).toBe(id);
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(randomValues).not.toHaveBeenCalled();
  });

  it("creates distinct UUIDs using secure random bytes when HTTP hides randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues });
    const weakRandom = vi.spyOn(Math, "random");
    const ids = Array.from({ length: 512 }, () => genId());
    expect(ids.every(id => uuidV4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(weakRandom).not.toHaveBeenCalled();
  });

  it("still provides non-credential IDs when the crypto API is entirely absent", () => {
    vi.stubGlobal("crypto", undefined);
    const ids = Array.from({ length: 128 }, () => genId());
    expect(ids.every(id => uuidV4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
