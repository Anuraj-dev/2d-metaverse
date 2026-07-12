import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ModerationReport } from "@metaverse/shared";

/**
 * Moderator dashboard panel test (spec 26). The REST client is stubbed; we assert
 * the rendered rows and the exact request each button fires, that the list
 * re-fetches on success, and that a typed error is surfaced on failure.
 */
const net = vi.hoisted(() => ({
  fetchReports: vi.fn(),
  dismissReport: vi.fn(),
  warnUser: vi.fn(),
  suspendUser: vi.fn(),
  unsuspendUser: vi.fn(),
}));
vi.mock("../../net/moderation", () => net);

import ModPanel from "./ModPanel";

const report = (over: Partial<ModerationReport> = {}): ModerationReport => ({
  id: "r1",
  reporterId: "rep-1",
  targetId: "tgt-1",
  messageId: "m1",
  messageText: "bad words",
  scope: "space:1",
  category: "harassment",
  note: null,
  status: "open",
  createdAt: new Date().toISOString(),
  ...over,
});

const button = (name: string): HTMLElement => screen.getByRole("button", { name });

beforeEach(() => {
  for (const fn of Object.values(net)) fn.mockReset();
  net.fetchReports.mockResolvedValue({ ok: true, reports: [report()] });
  net.dismissReport.mockResolvedValue({ ok: true });
  net.warnUser.mockResolvedValue({ ok: true });
  net.suspendUser.mockResolvedValue({ ok: true });
  net.unsuspendUser.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

it("renders the report queue", async () => {
  render(<ModPanel onClose={() => {}} />);
  expect(await screen.findByText("“bad words”")).toBeTruthy();
  expect(screen.getByText(/rep-1/)).toBeTruthy();
  expect(screen.getByText(/tgt-1/)).toBeTruthy();
});

it("shows the empty state with no reports", async () => {
  net.fetchReports.mockResolvedValue({ ok: true, reports: [] });
  render(<ModPanel onClose={() => {}} />);
  expect(await screen.findByText("No open reports.")).toBeTruthy();
});

it("dismiss fires dismissReport with the report id and re-fetches", async () => {
  render(<ModPanel onClose={() => {}} />);
  await screen.findByText("“bad words”");
  fireEvent.click(button("Dismiss"));
  expect(net.dismissReport).toHaveBeenCalledWith("r1");
  await waitFor(() => expect(net.fetchReports).toHaveBeenCalledTimes(2));
});

it("warn opens an editor and fires warnUser with the target and reason", async () => {
  render(<ModPanel onClose={() => {}} />);
  await screen.findByText("“bad words”");
  fireEvent.click(button("Warn…"));
  fireEvent.change(screen.getByPlaceholderText("Optional"), { target: { value: "be nice" } });
  fireEvent.click(button("Record warning"));
  await waitFor(() => expect(net.warnUser).toHaveBeenCalledWith("tgt-1", "be nice"));
});

it("warn with no reason omits the reason field", async () => {
  render(<ModPanel onClose={() => {}} />);
  await screen.findByText("“bad words”");
  fireEvent.click(button("Warn…"));
  fireEvent.click(button("Record warning"));
  await waitFor(() => expect(net.warnUser).toHaveBeenCalledWith("tgt-1", undefined));
});

it("suspend fires suspendUser with a future until derived from the preset", async () => {
  render(<ModPanel onClose={() => {}} />);
  await screen.findByText("“bad words”");
  fireEvent.click(button("Suspend…"));
  const before = Date.now();
  fireEvent.click(button("Suspend user"));
  await waitFor(() => expect(net.suspendUser).toHaveBeenCalledTimes(1));
  const call = net.suspendUser.mock.calls.at(0);
  if (!call) throw new Error("expected a suspendUser call");
  const [target, until, reason] = call;
  expect(target).toBe("tgt-1");
  expect(until).toBeGreaterThan(before);
  expect(reason).toBeUndefined();
});

it("unsuspend fires unsuspendUser with the target id", async () => {
  render(<ModPanel onClose={() => {}} />);
  await screen.findByText("“bad words”");
  fireEvent.click(button("Unsuspend"));
  await waitFor(() => expect(net.unsuspendUser).toHaveBeenCalledWith("tgt-1"));
});

it("surfaces a typed error when an action fails", async () => {
  net.dismissReport.mockResolvedValue({ ok: false, code: "rate-limited" });
  render(<ModPanel onClose={() => {}} />);
  await screen.findByText("“bad words”");
  fireEvent.click(button("Dismiss"));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText(/Too many moderation actions/)).toBeTruthy();
});

it("surfaces the load error when the fetch fails", async () => {
  net.fetchReports.mockResolvedValue({ ok: false, code: "unauthorized" });
  render(<ModPanel onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
});

describe("refresh + scoping", () => {
  it("re-fetches the queue on demand", async () => {
    render(<ModPanel onClose={() => {}} />);
    await screen.findByText("“bad words”");
    fireEvent.click(button("Refresh"));
    await waitFor(() => expect(net.fetchReports).toHaveBeenCalledTimes(2));
  });

  it("scopes actions to their own report row", async () => {
    net.fetchReports.mockResolvedValue({
      ok: true,
      reports: [report({ id: "a", targetId: "ta" }), report({ id: "b", targetId: "tb" })],
    });
    render(<ModPanel onClose={() => {}} />);
    const snapshots = await screen.findAllByText("“bad words”");
    const second = snapshots.at(1);
    if (!second) throw new Error("expected two report rows");
    const secondRow = second.closest(".mod-report");
    if (!(secondRow instanceof HTMLElement)) throw new Error("expected a report row element");
    fireEvent.click(within(secondRow).getByRole("button", { name: "Unsuspend" }));
    await waitFor(() => expect(net.unsuspendUser).toHaveBeenCalledWith("tb"));
  });
});
