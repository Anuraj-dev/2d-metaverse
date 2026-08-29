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
  AuthError: class AuthError extends Error {
    readonly field: "username" | "password" | undefined;
    constructor(message: string, field?: "username" | "password") {
      super(message);
      this.field = field;
    }
  },
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
    fireEvent.change(passField(), { target: { value: "wrongpass" } });
    fireEvent.click(submitBtn());
    expect((await screen.findByRole("alert")).textContent).toContain("Invalid credentials");
    expect(onEntered).not.toHaveBeenCalled();
  });

  it("announces retry guidance and restores the submit control", async () => {
    auth.signIn.mockRejectedValueOnce(new Error("Too many attempts. Try again in 37 seconds."));
    render(<Landing onEntered={() => {}} />);
    fireEvent.change(userField(), { target: { value: "ada" } });
    fireEvent.change(passField(), { target: { value: "wrongpass" } });
    fireEvent.click(submitBtn());

    expect((await screen.findByRole("alert")).textContent).toContain("37 seconds");
    expect(submitBtn().disabled).toBe(false);
  });

  it("requires username and password", () => {
    render(<Landing onEntered={() => {}} />);
    fireEvent.click(submitBtn());
    expect(screen.getByText("Username is required.")).toBeTruthy();
    expect(screen.getByText("Password is required.")).toBeTruthy();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only password as required", () => {
    render(<Landing onEntered={() => {}} />);
    fireEvent.change(userField(), { target: { value: "alice" } });
    fireEvent.change(passField(), { target: { value: "        " } });
    fireEvent.click(submitBtn());

    expect(screen.getByRole("alert").textContent).toBe("Password is required.");
    expect(document.activeElement).toBe(passField());
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("shows precise local signup constraints without making a request", () => {
    render(<Landing onEntered={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    fireEvent.change(userField(), { target: { value: "bad name" } });
    fireEvent.change(passField(), { target: { value: "short" } });
    const form = submitBtn().closest("form");
    if (!form) throw new Error("no auth form rendered");
    fireEvent.submit(form);
    expect(screen.getByText(/only letters, numbers/i)).toBeTruthy();
    expect(screen.getByText(/password must be at least 8/i)).toBeTruthy();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("announces and focuses the exact short-username error without making a request", () => {
    render(<Landing onEntered={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    fireEvent.change(userField(), { target: { value: "ab" } });
    fireEvent.change(passField(), { target: { value: "password1" } });
    fireEvent.click(submitBtn());

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Username must be at least 3 characters.");
    expect(userField().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(userField());
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("places a duplicate-username response beside the username", async () => {
    auth.signUp.mockRejectedValueOnce(new auth.AuthError("That username is taken.", "username"));
    render(<Landing onEntered={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    fireEvent.change(userField(), { target: { value: "Taken_Name" } });
    fireEvent.change(passField(), { target: { value: "password1" } });
    submitBtn().focus();
    expect(document.activeElement).toBe(submitBtn());
    fireEvent.click(submitBtn());
    expect((await screen.findByRole("alert")).textContent).toBe("That username is taken.");
    expect(userField().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(userField());
  });

  it("locks auth state until an in-flight signup settles", async () => {
    let rejectSignup: ((reason?: unknown) => void) | undefined;
    auth.signUp.mockReturnValueOnce(new Promise<void>((_resolve, reject) => {
      rejectSignup = reject;
    }));
    render(<Landing onEntered={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    fireEvent.change(userField(), { target: { value: "taken-name" } });
    fireEvent.change(passField(), { target: { value: "password1" } });
    fireEvent.click(submitBtn());

    await waitFor(() => expect(submitBtn().disabled).toBe(true));
    expect(userField().hasAttribute("disabled")).toBe(true);
    expect(passField().hasAttribute("disabled")).toBe(true);
    const signInTab = screen.getByRole("button", { name: "Sign in" });
    expect(signInTab.hasAttribute("disabled")).toBe(true);
    fireEvent.click(signInTab);
    expect(screen.getByRole("heading", { name: "Join the campus" })).toBeTruthy();

    if (!rejectSignup) throw new Error("signup rejection callback was not captured");
    rejectSignup(new auth.AuthError("That username is taken.", "username"));
    expect((await screen.findByRole("alert")).textContent).toBe("That username is taken.");
    expect(userField()).toHaveProperty("value", "taken-name");
    expect(userField().hasAttribute("disabled")).toBe(false);
  });

  it("uses and stores the canonical normalised username", async () => {
    const onEntered = vi.fn();
    render(<Landing onEntered={onEntered} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    fireEvent.change(userField(), { target: { value: "  Ada_Lovelace  " } });
    fireEvent.change(passField(), { target: { value: "password1" } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(onEntered).toHaveBeenCalled());
    expect(auth.signUp).toHaveBeenCalledWith("ada_lovelace", "password1");
    expect(localStorage.getItem("displayName")).toBe("ada_lovelace");
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
