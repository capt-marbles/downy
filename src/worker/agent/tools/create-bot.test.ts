import { expect, it, vi } from "vitest";
vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
import { createBot, isNamedBotCreationRequest } from "./create-bot";
import { testDb } from "../../../test/d1";
import { getAgent } from "../../db/profile";
import { voiceReadTools, voiceToolSet } from "../../voice/policy";
import { tool } from "ai";
import { z } from "zod";

it("creates a named bot with its requested purpose and a chat link", async () => {
  const db = testDb(["0001_init.sql"]);
  const initialize = vi.fn();
  const result = await createBot(
    db,
    { name: "Gameye Sales", purpose: "Review sales opportunities" },
    initialize,
  );
  expect(result).toMatchObject({
    state: "ready",
    slug: "bot-gameye-sales",
    url: "/agent/bot-gameye-sales",
  });
  expect(await getAgent(db, "bot-gameye-sales")).toMatchObject({
    displayName: "Gameye Sales",
  });
  expect(initialize).toHaveBeenCalledWith(
    "bot-gameye-sales",
    "Gameye Sales",
    "Review sales opportunities",
  );
});
it("simultaneous repeated requests converge on one bot", async () => {
  const db = testDb(["0001_init.sql"]);
  const results = await Promise.all([
    createBot(db, { name: "Sales" }, vi.fn()),
    createBot(db, { name: "Sales" }, vi.fn()),
  ]);
  expect(results.every((result) => result.state === "ready")).toBe(true);
  expect((await db.prepare("SELECT * FROM agents").all()).results).toHaveLength(
    1,
  );
});
it("does not overwrite a colliding or archived bot", async () => {
  const db = testDb(["0001_init.sql"]);
  await createBot(db, { name: "Gameye Sales" }, vi.fn());
  const initialize = vi.fn();
  expect(
    await createBot(db, { name: "Gameye-Sales" }, initialize),
  ).toMatchObject({ state: "name_conflict" });
  await db.prepare("UPDATE agents SET archived_at = 1").run();
  expect(
    await createBot(db, { name: "Gameye Sales" }, initialize),
  ).toMatchObject({ state: "name_conflict" });
  expect(initialize).not.toHaveBeenCalled();
});
it("does not report success if initialization failed, and permits a safe retry", async () => {
  const db = testDb(["0001_init.sql"]);
  await expect(
    createBot(db, { name: "Sales" }, async () => {
      throw new Error("unavailable");
    }),
  ).rejects.toThrow("unavailable");
  expect(await createBot(db, { name: "Sales" }, vi.fn())).toMatchObject({
    state: "ready",
  });
  expect((await db.prepare("SELECT * FROM agents").all()).results).toHaveLength(
    1,
  );
});
it("allows empty bot creation in voice without enabling other write tools", async () => {
  const execute = vi.fn().mockResolvedValue({ state: "ready" });
  const definition = tool({ inputSchema: z.object({}), execute });
  expect(
    voiceReadTools([
      "create_bot",
      "schedule_task",
      "connect_mcp_server",
      "send_email",
    ]),
  ).toEqual(["create_bot"]);
  const definitions = voiceToolSet({
    create_bot: definition,
    send_email: definition,
  });
  const options = { toolCallId: "test", messages: [] };
  await definitions.create_bot.execute?.({}, options);
  await expect(definitions.send_email.execute?.({}, options)).rejects.toThrow(
    "Voice only permits",
  );
  expect(execute).toHaveBeenCalledTimes(1);
});

it("forces an action only for a direct named-bot request", () => {
  expect(
    isNamedBotCreationRequest(
      "Create a bot named Sales. Its purpose is email review.",
    ),
  ).toBe(true);
  expect(
    isNamedBotCreationRequest(
      "Could you please create a new bot called Sales?",
    ),
  ).toBe(true);
  for (const text of [
    "How do I create a bot called Sales?",
    "Do not create a bot named Sales",
    "Would a bot called Sales help?",
    "Create a bot",
  ])
    expect(isNamedBotCreationRequest(text)).toBe(false);
});

it("uses only the latest caller request when routing voice bot creation", () => {
  expect(
    isNamedBotCreationRequest(
      "Voice lookup — answer latest\nYou: Create a bot called Sales\nDowny: Checking",
    ),
  ).toBe(true);
  expect(
    isNamedBotCreationRequest(
      "Voice lookup — answer latest\nYou: Create a bot called Sales\nDowny: Checking\nYou: Actually, never mind",
    ),
  ).toBe(false);
});
