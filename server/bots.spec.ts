import { describe, expect, it } from "vitest";
import { BOT_ROSTER, chooseBotCards, ensureBotsForSelectingGame } from "./bots";

describe("production bot roster", () => {
  it("contains the supplied roster in order", () => {
    expect(BOT_ROSTER).toHaveLength(207);
    expect(BOT_ROSTER.slice(0, 5)).toEqual(["Abel", "Nati_21", "Yoni", "Dagi_99", "Elias_7"]);
    expect(BOT_ROSTER[BOT_ROSTER.length - 1]).toBe("Sintayehu");
    expect(new Set(BOT_ROSTER).size).toBeLessThan(BOT_ROSTER.length);
  });

  it("chooses one or two distinct available cards", () => {
    const available = Array.from({ length: 20 }, (_, index) => index + 1);
    const selected = chooseBotCards(available);
    expect(selected.length).toBeGreaterThanOrEqual(1);
    expect(selected.length).toBeLessThanOrEqual(2);
    expect(new Set(selected).size).toBe(selected.length);
    expect(selected.every((card) => available.includes(card))).toBe(true);
  });

  it("does not require a database when live bot coordination is unavailable", async () => {
    await expect(ensureBotsForSelectingGame("game-without-database")).resolves.toBe(0);
  });
});
