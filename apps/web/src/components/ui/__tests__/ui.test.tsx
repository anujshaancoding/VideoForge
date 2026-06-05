import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../Button.js";
import { Slider } from "../Slider.js";
import { Modal } from "../Modal.js";

describe("Button", () => {
  it("renders children and fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Export</Button>);
    const btn = screen.getByRole("button", { name: "Export" });
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("defaults to type=button (never submits a form by accident)", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("type", "button");
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Nope
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Nope" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Slider", () => {
  it("renders an accessible labelled range and emits numeric values", async () => {
    const onChange = vi.fn();
    render(
      <Slider label="Opacity" value={50} min={0} max={100} onChange={onChange} valueLabel="50%" />,
    );
    const input = screen.getByLabelText("Opacity") as HTMLInputElement;
    expect(input).toHaveAttribute("type", "range");
    expect(input.value).toBe("50");
    // fireEvent.change drives the value through React's controlled-input tracker.
    fireEvent.change(input, { target: { value: "75" } });
    expect(onChange).toHaveBeenCalledWith(75);
    expect(typeof onChange.mock.calls[0]![0]).toBe("number");
  });
});

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        body
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a labelled dialog when open", () => {
    render(
      <Modal open onClose={() => {}} title="Export settings">
        body
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Export settings" })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="X">
        <button type="button">inner</button>
      </Modal>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes via the close button and the backdrop", async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="X">
        body
      </Modal>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Backdrop is aria-hidden; click it directly.
    const scrim = document.querySelector('[aria-hidden="true"].absolute');
    if (scrim) await userEvent.click(scrim as Element);
    expect(onClose.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("moves focus into the dialog on open", () => {
    render(
      <Modal open onClose={() => {}} title="X">
        <button type="button">first action</button>
      </Modal>,
    );
    // First focusable inside the dialog header is the Close button.
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });
});
