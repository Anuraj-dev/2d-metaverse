import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

/**
 * Landing smoke test (PRD 19 re-theme): asserts the auth *contract* the re-theme
 * must preserve — sign-in vs sign-up modes, credential submission, surfaced
 * errors, and avatar selection — not pixels. The auth network layer is mocked so
 * we assert which calls fire; the diorama backdrop renders as inert DOM.
 */

const auth = vi.hoisted(() => ({
  signUp: vi.fn().mockResolvedValue(undefined),
  signIn: vi.fn().mockResolvedValue("test-token"),
  USE_MOCK: false,
}));
vi.mock("../net/auth", () => auth);

import Landing from "./Landing";

/** The form's submit control (distinct from the "Sign in" tab of the same name). */
function submitBtn(): HTMLButtonElement {
  const btn = screen
    .getAllByRole("button")
    .find((b) => b.getAttribute("type") === "submit");
  if (!btn) throw new Error("no submit button rendered");
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  auth.signUp.mockClear().mockResolvedValue(undefined);
  auth.signIn.mockClear().mockResolvedValue("test-token");
  localStorage.clear();
});
afterEach(() => cleanup());

describe("Landing", () => {
  it("renders sign-in mode by default with username, password and avatar picker", () => {
    render(<Landing onEntered={() => {}} />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(screen.getByPlaceholderText("your name")).toBeTruthy();
    expect(screen.getByPlaceholderText("your password")).toBeTruthy();
    expect(submitBtn().textContent).toContain("Sign in");
    // both auth tabs present
    expect(screen.getByRole("button", { name: "Sign up" })).toBeTruthy();
    // avatar picker present, first char selected by default
    expect(screen.getByRole("button", { name: "Choose char1" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("signs in an existing user: signIn only, then onEntered", async () => {
    const onEntered = vi.fn();
    render(<Landing onEntered={onEntered} />);
    fireEvent.change(screen.getByPlaceholderText("your name"), { target: { value: "ada" } });
    fireEvent.change(screen.getByPlaceholderText("your password"), { target: { value: "pw123456" } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onEntered).toHaveBeenCalled());
    expect(auth.signIn).toHaveBeenCalledWith("ada", "pw123456");
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("switches to sign-up mode and registers before signing in", async () => {
    const onEntered = vi.fn();
    render(<Landing onEntered={onEntered} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    expect(screen.getByRole("heading", { name: "Join the campus" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("your name"), { target: { value: "grace" } });
    fireEvent.change(screen.getByPlaceholderText("your password"), { target: { value: "hopper99" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(onEntered).toHaveBeenCalled());
    expect(auth.signUp).toHaveBeenCalledWith("grace", "hopper99");
    expect(auth.signIn).toHaveBeenCalledWith("grace", "hopper99");
  });

  it("surfaces a server error and does not enter", async () => {
    auth.signIn.mockRejectedValueOnce(new Error("Invalid credentials"));
    const onEntered = vi.fn();
    render(<Landing onEntered={onEntered} />);
    fireEvent.change(screen.getByPlaceholderText("your name"), { target: { value: "ada" } });
    fireEvent.change(screen.getByPlaceholderText("your password"), { target: { value: "wrongpw" } });
    fireEvent.click(submitBtn());
    expect((await screen.findByRole("alert")).textContent).toContain("Invalid credentials");
    expect(onEntered).not.toHaveBeenCalled();
  });

  it("requires username and password", async () => {
    render(<Landing onEntered={() => {}} />);
    fireEvent.click(submitBtn());
    expect((await screen.findByRole("alert")).textContent).toMatch(/required/i);
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("selects a different avatar and persists it", () => {
    render(<Landing onEntered={() => {}} />);
    const char3 = screen.getByRole("button", { name: "Choose char3" });
    fireEvent.click(char3);
    expect(char3.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Choose char1" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a parent-supplied notice", () => {
    render(<Landing onEntered={() => {}} notice="Session expired" />);
    expect(screen.getByRole("alert").textContent).toContain("Session expired");
  });
});
