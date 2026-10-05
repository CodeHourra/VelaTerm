import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FormModal } from "./FormModal";

vi.mock("../i18n", () => ({ useT: () => (key: string) => key }));

const fields = [{ key: "name", label: "Name", required: true }];

describe("FormModal submission", () => {
  it("retains values on failure and allows retrying the same request", async () => {
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new Error("Database unavailable"))
      .mockResolvedValueOnce(undefined);
    render(<FormModal title="Create" fields={fields} onSubmit={onSubmit} onCancel={vi.fn()} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "common.confirm" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Database unavailable");
    expect(input.value).toBe("Research");
    const submit = screen.getByRole("button", { name: "common.confirm" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(onSubmit).toHaveBeenLastCalledWith({ name: "Research" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("blocks duplicate submissions, edits, and dismissal while a request is pending", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onCancel = vi.fn();
    render(<FormModal title="Create" fields={fields} onSubmit={onSubmit} onCancel={onCancel} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Research" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(input.disabled).toBe(true);
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
    await act(async () => { finish(); });
    expect(input.disabled).toBe(false);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("formats submission errors and clears them when the value changes", async () => {
    render(<FormModal
      title="Create"
      fields={fields}
      onSubmit={() => Promise.reject("duplicate")}
      formatSubmitError={() => "Choose another name"}
      onCancel={vi.fn()}
    />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "common.confirm" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose another name");
    fireEvent.change(input, { target: { value: "Notes" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
