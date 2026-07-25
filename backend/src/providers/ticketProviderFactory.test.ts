jest.mock("../repositories/connectionRepository", () => ({
  getById: jest.fn(),
  list: jest.fn(),
}));

jest.mock("../services/settingsService", () => ({
  getConnectwise: jest.fn(),
}));

jest.mock("../config/config", () => ({
  config: {
    jira: {
      baseUrl: "https://legacy.atlassian.net",
      email: "legacy@example.com",
      apiToken: "legacy",
    },
    cwm: { server: "https://connectwise.example.com", company: "example" },
  },
}));

import * as connectionRepo from "../repositories/connectionRepository";
import { getConnectwise } from "../services/settingsService";
import {
  createTicketProvider,
  resolveCredentials,
} from "./ticketProviderFactory";

const mockedConnectionRepo = jest.mocked(connectionRepo);
const mockedGetConnectwise = jest.mocked(getConnectwise);

describe("resolveCredentials tenant binding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetConnectwise.mockResolvedValue({
      server: "connectwise.example.com",
      company: "example",
      publicKey: "public",
      privateKey: "private",
      clientId: "client",
    });
  });

  it("uses the explicitly linked enabled connection", async () => {
    mockedConnectionRepo.getById.mockResolvedValue({
      id: 8,
      name: "Customer Jira",
      type: "jira",
      enabled: true,
      configRevision: 1,
      config: {
        baseUrl: "https://customer.atlassian.net",
        email: "agent@example.com",
        apiToken: "secret",
      },
      lastTestAt: null,
      lastTestOk: null,
      lastTestMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(resolveCredentials("jira", 8)).resolves.toMatchObject({
      connectionId: 8,
      credentials: { baseUrl: "https://customer.atlassian.net" },
    });
  });

  it("fails closed for an unlinked Jira job even when legacy credentials exist", async () => {
    await expect(resolveCredentials("jira", null)).rejects.toThrow(
      "no connection selected",
    );
    expect(mockedConnectionRepo.list).not.toHaveBeenCalled();
  });

  it("fails closed when a stored connection belongs to another provider type", async () => {
    mockedConnectionRepo.getById.mockResolvedValue({
      id: 8,
      name: "Wrong provider",
      type: "connectwise",
      enabled: true,
      configRevision: 1,
      config: {},
      lastTestAt: null,
      lastTestOk: null,
      lastTestMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(resolveCredentials("jira", 8)).rejects.toThrow(
      "is a connectwise account, not jira",
    );
  });

  it("keeps ConnectWise on its explicit legacy-global credential path", async () => {
    await expect(resolveCredentials("connectwise", null)).resolves.toEqual({
      connectionId: null,
      credentials: {
        server: "connectwise.example.com",
        company: "example",
        publicKey: "public",
        privateKey: "private",
        clientId: "client",
      },
    });
  });

  it("loads a fresh ConnectWise snapshot for every account-locked operation", async () => {
    mockedGetConnectwise
      .mockResolvedValueOnce({
        server: "connectwise.example.com",
        company: "example",
        publicKey: "old-public",
        privateKey: "old-private",
        clientId: "client",
      })
      .mockResolvedValueOnce({
        server: "connectwise.example.com",
        company: "example",
        publicKey: "new-public",
        privateKey: "new-private",
        clientId: "client",
      });

    const first = await resolveCredentials("connectwise", null);
    const second = await resolveCredentials("connectwise", null);

    expect(first.credentials).toMatchObject({ publicKey: "old-public" });
    expect(second.credentials).toMatchObject({ publicKey: "new-public" });
    expect(mockedGetConnectwise).toHaveBeenCalledTimes(2);
  });
});

describe("createTicketProvider ConnectWise scope", () => {
  it.each([{}, { board: null }, { board: "" }, { board: "   " }])(
    "fails closed without an explicit nonblank board: %p",
    (config) => {
      expect(() => createTicketProvider("connectwise", config)).toThrow(
        "requires an explicit nonblank board name",
      );
    },
  );
});
