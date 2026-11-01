// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { SupportWorkspace } from "../src/service/support.js";
import { SUPPORT_CLOSE_CONFIRMATION } from "../shared/support.js";
import type { SupportCaseDetail } from "../shared/contracts.js";

const org = { id: "org-a", name: "Synthetic employer", role: "driver" as const },
  root = "/service/api/v1/organizations/org-a/support";
const saved: SupportCaseDetail = {
  case: {
    id: "case-a",
    subject: "September amount <img>",
    topic: "statement-amount",
    status: "resolved",
    revision: 2,
    reporter: { id: "driver-a", name: "Synthetic employee" },
    assignee: { id: "finance-a", name: "Synthetic finance", available: true },
    statement: { id: "statement-a", snapshotSha256: "a".repeat(64) },
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:01:00.000Z",
  },
  events: [
    {
      id: "event-a",
      revision: 1,
      action: "created",
      actor: { id: "driver-a", name: "Synthetic employee", role: "driver" },
      message: "Please check <script>alert(1)</script>\nand the missing session.",
      assigneeId: "finance-a",
      resolution: null,
      createdAt: "2026-11-01T12:00:00.000Z",
    },
    {
      id: "event-b",
      revision: 2,
      action: "resolve",
      actor: { id: "finance-a", name: "Synthetic finance", role: "finance" },
      message: "The source and policy were checked.",
      assigneeId: null,
      resolution: "record-reviewed",
      createdAt: "2026-11-01T12:01:00.000Z",
    },
  ],
  olderBefore: null,
};
const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("retains exact uncertain updates in memory, escapes replies and never automatically calls AI or owner APIs", async () => {
  const writes: { path: string; body: unknown }[] = [];
  let first = true;
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.body) {
      writes.push({ path, body: JSON.parse(init.body as string) });
      if (first) {
        first = false;
        throw new Error("Connection lost after save");
      }
      return reply(saved, 201);
    }
    return reply({ cases: [], assignees: [], nextBefore: null });
  });
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <SupportWorkspace
      organization={org}
      actorId="driver-a"
      initialStatementId="statement-a"
      onOpenStatement={() => {}}
      onSessionExpired={() => {}}
    />,
  );
  await screen.findByRole("button", { name: "Save case" });
  fireEvent.input(screen.getByLabelText("What needs checking?"), {
    target: { value: "Check my own September statement" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Save case" }).closest("form")!);
  await screen.findByRole("button", { name: "Retry same update" });
  expect((screen.getByLabelText("What needs checking?") as HTMLTextAreaElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry same update" }));
  await screen.findByText("Case update saved. No payment or charger setting was changed.");
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0]!.body).toMatchObject({
    statementId: "statement-a",
    message: "Check my own September statement",
  });
  expect(view.container.querySelector("script,img")).toBeNull();
  expect(screen.getByText(/Please check <script>/)).toBeTruthy();
  expect(fetcher.mock.calls.every(([path]) => path.startsWith(root))).toBe(true);
  expect(localStorage.length + sessionStorage.length).toBe(0);
});
it("requires reporter confirmation of the displayed revision and keeps the original statement link", async () => {
  const writes: unknown[] = [];
  const onOpen = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.body) {
        writes.push(JSON.parse(init.body as string));
        return reply({ ...saved, case: { ...saved.case, status: "closed", revision: 3 } });
      }
      return path === root
        ? reply({ cases: [saved.case], assignees: [], nextBefore: null })
        : reply(saved);
    }),
  );
  render(
    <SupportWorkspace
      organization={org}
      actorId="driver-a"
      initialStatementId={null}
      onOpenStatement={onOpen}
      onSessionExpired={() => {}}
    />,
  );
  const open = await screen.findByRole("button", { name: /September amount/ });
  fireEvent.click(open);
  await screen.findByRole("button", { name: "Open linked statement" });
  fireEvent.click(screen.getByRole("button", { name: "Open linked statement" }));
  expect(onOpen).toHaveBeenCalledWith("statement-a");
  fireEvent.change(screen.getByLabelText("Action"), { target: { value: "close" } });
  const confirm = screen.getByRole("checkbox", { name: SUPPORT_CLOSE_CONFIRMATION });
  expect((confirm as HTMLInputElement).required).toBe(true);
  fireEvent.click(confirm);
  fireEvent.submit(screen.getByRole("button", { name: "Save update" }).closest("form")!);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({
    expectedRevision: 2,
    confirmation: SUPPORT_CLOSE_CONFIRMATION,
  });
  await waitFor(() =>
    expect((screen.getByLabelText("Action") as HTMLSelectElement).value).toBe("reopen"),
  );
});
it("clears company case text when access expires", async () => {
  const expired = vi.fn();
  let readCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ++readCount === 1
        ? reply({ cases: [saved.case], assignees: [], nextBefore: null })
        : reply({ error: "Sign in to continue" }, 401),
    ),
  );
  render(
    <SupportWorkspace
      organization={org}
      actorId="driver-a"
      initialStatementId={null}
      onOpenStatement={() => {}}
      onSessionExpired={expired}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /September amount/ }));
  await waitFor(() => expect(expired).toHaveBeenCalledOnce());
  expect(screen.queryByText("September amount <img>")).toBeNull();
  expect(screen.getByRole("alert").textContent).toBe("Sign in to continue");
});

it("does not authorize closure of an unseen concurrent resolution when loading earlier history", async () => {
  const current = {
    ...saved,
    case: { ...saved.case, status: "open", revision: 51 },
    olderBefore: 3,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path === root
        ? reply({ cases: [current.case], assignees: [], nextBefore: null })
        : path.includes("eventsBefore")
          ? reply({
              ...saved,
              case: { ...saved.case, status: "resolved", revision: 52 },
              events: [{ ...saved.events[0]!, id: "older", revision: 1 }],
              olderBefore: null,
            })
          : reply(current),
    ),
  );
  render(
    <SupportWorkspace
      organization={org}
      actorId="driver-a"
      initialStatementId={null}
      onOpenStatement={() => {}}
      onSessionExpired={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /September amount/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Load earlier replies" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Load earlier replies" })).toBeNull(),
  );
  expect(screen.queryByRole("option", { name: "Confirm the resolution and close" })).toBeNull();
  expect(screen.queryByText("Resolution ready to check")).toBeNull();
});

it("clears the original statement context when starting a general case", async () => {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.body) {
        writes.push(JSON.parse(init.body as string));
        return reply(saved, 201);
      }
      return reply({ cases: [], assignees: [], nextBefore: null });
    }),
  );
  render(
    <SupportWorkspace
      organization={org}
      actorId="driver-a"
      initialStatementId="statement-a"
      onOpenStatement={() => {}}
      onSessionExpired={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Open a case" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Open a case" }));
  expect(screen.queryByText(/selected statement’s original snapshot/)).toBeNull();
  fireEvent.input(screen.getByLabelText("Subject"), {
    target: { value: "General account question" },
  });
  fireEvent.input(screen.getByLabelText("What needs checking?"), {
    target: { value: "Where do I find my account settings?" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Save case" }).closest("form")!);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.statementId).toBeNull();
});

it("shows closed staff cases as reporter-controlled history without an unusable mutation form", async () => {
  const closed = { ...saved, case: { ...saved.case, status: "closed", revision: 3 } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path === root
        ? reply({
            cases: [closed.case],
            assignees: [{ id: "finance-a", name: "Synthetic finance" }],
            nextBefore: null,
          })
        : reply(closed),
    ),
  );
  render(
    <SupportWorkspace
      organization={{ ...org, role: "finance" }}
      actorId="finance-a"
      initialStatementId={null}
      onOpenStatement={() => {}}
      onSessionExpired={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /September amount/ }));
  await screen.findByText("The reporter confirmed closure. Only they can reopen this case.");
  expect(screen.queryByRole("button", { name: "Save update" })).toBeNull();
});
