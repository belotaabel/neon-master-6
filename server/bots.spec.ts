import { describe, expect, it } from "vitest";
import { BOT_ROSTER, chooseBotCards, ensureBotsForSelectingGame, planBotAssignments } from "./bots";

describe("production bot roster", () => {
  it("contains the supplied roster in order", () => {
    expect(BOT_ROSTER).toHaveLength(207);
    expect(BOT_ROSTER.slice(0, 5)).toEqual(["Abel", "Nati_21", "Yoni", "Dagi_99", "Elias_7"]);
    expect(BOT_ROSTER[BOT_ROSTER.length - 1]).toBe("Sintayehu");
    expect(new Set(BOT_ROSTER).size).toBeLessThan(BOT_ROSTER.length);
  });

  it("chooses exactly one available card", () => {
    const available = Array.from({ length: 20 }, (_, index) => index + 1);
    const selected = chooseBotCards(available);
    expect(selected).toHaveLength(1);
    expect(selected.every((card) => available.includes(card))).toBe(true);
  });

  it("plans one distinct card for each missing bot in a batch", () => {
    const assignments = planBotAssignments(["global-bot:1"], [7, 12, 31], 4);
    expect(assignments).toEqual([
      { index: 0, name: "Abel", cardNumber: 7 },
      { index: 2, name: "Yoni", cardNumber: 12 },
      { index: 3, name: "Dagi_99", cardNumber: 31 },
    ]);
  });

  it("caps a batch at the configured target and available cards", () => {
    const assignments = planBotAssignments([], Array.from({ length: 400 }, (_, index) => index + 1), 200);
    expect(assignments).toHaveLength(200);
    expect(new Set(assignments.map(({ cardNumber }) => cardNumber)).size).toBe(200);
    expect(assignments[199].index).toBe(199);
  });

  it("stops cleanly when the card catalog is exhausted", () => {
    expect(planBotAssignments([], [], 200)).toEqual([]);
    expect(planBotAssignments([], [42, 43], 200)).toHaveLength(2);
  });

  it("does not require a database when live bot coordination is unavailable", async () => {
    await expect(ensureBotsForSelectingGame("game-without-database")).resolves.toBe(0);
  });
});
