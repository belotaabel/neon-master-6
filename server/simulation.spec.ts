import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("staging simulation isolation", () => {
  it("rejects simulation mode in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.SIMULATION_ENABLED = "true";
    process.env.SIMULATION_DATABASE_URL = "postgres://staging.invalid/db";
    process.env.SIMULATION_SOCKET_URL = "https://staging.invalid";
    const { simulationEnabled } = await import("./simulation");
    expect(simulationEnabled()).toBe(false);
  });

  it("requires all staging-only configuration", async () => {
    process.env.NODE_ENV = "test";
    process.env.SIMULATION_ENABLED = "true";
    process.env.SIMULATION_DATABASE_URL = "postgres://staging.invalid/db";
    const { simulationEnabled } = await import("./simulation");
    expect(simulationEnabled()).toBe(false);
    process.env.SIMULATION_SOCKET_URL = "https://staging.invalid";
    process.env.SIMULATION_AUTH_TOKEN = "token";
    vi.resetModules();
    const reloaded = await import("./simulation");
    expect(reloaded.simulationEnabled()).toBe(true);
  });

  it("accepts only the configured simulation token when enabled", async () => {
    process.env.NODE_ENV = "test";
    process.env.SIMULATION_ENABLED = "true";
    process.env.SIMULATION_DATABASE_URL = "postgres://staging.invalid/db";
    process.env.SIMULATION_SOCKET_URL = "https://staging.invalid";
    process.env.SIMULATION_AUTH_TOKEN = "staging-token";
    const { verifySimulationToken, simulationAuthEnabled } = await import("./simulation");
    expect(simulationAuthEnabled()).toBe(true);
    expect(verifySimulationToken("staging-token")).toBe(true);
    expect(verifySimulationToken("wrong-token")).toBe(false);
    expect(verifySimulationToken(undefined)).toBe(false);
  });
});

vi.mock("pg", () => ({ Pool: class { } }));
