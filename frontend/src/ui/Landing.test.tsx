import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

/**
 * Landing smoke test (PRD 19 re-theme): asserts the auth *contract* the re-theme
 * must preserve — sign-in vs sign-up modes, credential submission, surfaced
 * errors, avatar selection, and the nav-CTA focus treatment — not pixels. The
 * auth network layer is mocked so we assert which calls fire; the diorama
 * backdrop renders as inert DOM. All queries go through accessible names
 * (role/label), never placeholder copy, so wording tweaks don't churn selectors.
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

/** Accessible-name queries against the labelled fields (never placeholder text). */
const userField = () => screen.getByRole("textbox", { name: "Username" });
// password inputs expose no ARIA role, so the wrapping <label> is the query
const passField = () => screen.getByLabelText("Password");

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
    expect(userField()).toBeTruthy();
    expect(passField()).toBeTruthy();
    expect(submitBtn().textContent).toContain("Sign in");
    // both auth tabs present
    expect(screen.getByRole("button", { name: "Sign up" })).toBeTruthy();
    // avatar picker present, first char selected by default
    expect(screen.getByRole("button", { name: "Choose char1" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("signs in an existing user: signIn only, then onEntered", async () => {
    const onEntered = vi.fn();
    render(<Landing onEntered={onEntered} />);
    fireEvent.change(userField(), { target: { value: "ada" } });
    fireEvent.change(passField(), { target: { value: "pw123456" } });
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
    fireEvent.change(userField(), { target: { value: "grace" } });
    fireEvent.change(passField(), { target: { value: "hopper99" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(onEntered).toHaveBeenCalled());
    expect(auth.signUp).toHaveBeenCalledWith("grace", "hopper99");
    expect(auth.signIn).toHaveBeenCalledWith("grace", "hopper99");
  });

  it("surfaces a server error and does not enter", async () => {
    auth.signIn.mockRejectedValueOnce(new Error("Invalid credentials"));
    const onEntered = vi.fn();
    render(<Landing onEntered={onEntered} />);
    fireEvent.change(userField(), { target: { value: "ada" } });
    fireEvent.change(passField(), { target: { value: "wrongpw" } });
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

  it("selects a different avatar and persists it on submit", async () => {
    const onEntered = vi.fn();
    render(<Landing onEntered={onEntered} />);
    const char3 = screen.getByRole("button", { name: "Choose char3" });
    fireEvent.click(char3);
    expect(char3.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Choose char1" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.change(userField(), { target: { value: "ada" } });
    fireEvent.change(passField(), { target: { value: "pw123456" } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onEntered).toHaveBeenCalled());
    expect(localStorage.getItem("avatar")).toBe("char3");
  });

  it("focuses the username field from the nav 'Enter campus' CTA", () => {
    render(<Landing onEntered={() => {}} />);
    const user = userField();
    user.blur(); // autoFocus grabs it on mount; release so the CTA has work to do
    expect(document.activeElement).not.toBe(user);
    fireEvent.click(screen.getByRole("button", { name: /enter campus/i }));
    expect(document.activeElement).toBe(user);
  });

  it("shows a parent-supplied notice", () => {
    render(<Landing onEntered={() => {}} notice="Session expired" />);
    expect(screen.getByRole("alert").textContent).toContain("Session expired");
  });
});
