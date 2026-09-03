import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

const responseFor = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { response.statusCode = code; return response; },
    json(body: unknown) { response.body = body; return response; },
  };
  return response;
};

function adminToken() {
  const secret = "test-admin-secret";
  process.env.ADMIN_PASSWORD = secret;
  const expiresAt = String(Date.now() + 60_000);
  const nonce = "nonce";
  const signature = createHmac("sha256", secret).update(`${expiresAt}.${nonce}`).digest("hex");
  return `${expiresAt}.${nonce}.${signature}`;
}

describe("bot settings admin boundary", () => {
  it("rejects unauthenticated requests", async () => {
    const { handleAdminBotSettingsUpdate } = await import("./routes/admin");
    const response = responseFor();
    await handleAdminBotSettingsUpdate({ body: { enabled: true, botCount: 1 }, header: () => undefined } as never, response as never, () => undefined);
    expect(response.statusCode).toBe(403);
  });

  it("rejects counts outside the fixed roster limit", async () => {
    const { handleAdminBotSettingsUpdate } = await import("./routes/admin");
    const token = adminToken();
    const response = responseFor();
    await handleAdminBotSettingsUpdate({ body: { enabled: true, botCount: 51 }, header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
    expect(response.statusCode).toBe(400);
  });

  it("rejects invalid bot wallet funding amounts", async () => {
    const { handleAdminBotFunding } = await import("./routes/admin");
    const token = adminToken();
    const response = responseFor();
    await handleAdminBotFunding({ params: { botId: "1" }, body: { amount: 0 }, header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
    expect(response.statusCode).toBe(400);
  });

  it("rejects invalid bulk bot wallet funding amounts", async () => {
    const { handleAdminBotBulkFunding } = await import("./routes/admin");
    const token = adminToken();
    const response = responseFor();
    await handleAdminBotBulkFunding({ body: { amount: 1_000_001 }, header: (name: string) => name === "x-admin-token" ? token : undefined } as never, response as never, () => undefined);
    expect(response.statusCode).toBe(400);
  });
});
