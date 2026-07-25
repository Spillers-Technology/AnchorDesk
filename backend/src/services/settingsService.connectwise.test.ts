jest.mock("../db/prisma", () => ({
  prisma: {
    setting: { findUnique: jest.fn() },
  },
}));

import { prisma } from "../db/prisma";
import { getConnectwise, resetCache } from "./settingsService";

const findUnique = (
  prisma as unknown as {
    setting: { findUnique: jest.Mock };
  }
).setting.findUnique;

describe("ConnectWise settings snapshots", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetCache();
  });

  it("reads Postgres on every operation instead of retaining replica-local credentials", async () => {
    findUnique
      .mockResolvedValueOnce({
        value: {
          server: "cw.example.com",
          company: "tenant",
          publicKey: "old-public",
          privateKey: "old-private",
          clientId: "client",
        },
      })
      .mockResolvedValueOnce({
        value: {
          server: "cw.example.com",
          company: "tenant",
          publicKey: "new-public",
          privateKey: "new-private",
          clientId: "client",
        },
      });

    const first = await getConnectwise();
    const second = await getConnectwise();

    expect(first.publicKey).toBe("old-public");
    expect(second.publicKey).toBe("new-public");
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
