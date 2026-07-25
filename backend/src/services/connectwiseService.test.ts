jest.mock("connectwise-rest", () => ({
  ManageAPI: jest.fn(),
}));

import { ManageAPI } from "connectwise-rest";
import { createCwm, safeConnectWiseLogger } from "./connectwiseService";

const mockedManageApi = jest.mocked(ManageAPI);

describe("ConnectWise client safety", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("never passes dependency error metadata or echoed credentials to stdout", () => {
    const error = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    safeConnectWiseLogger(
      "error",
      'get /service/tickets 10ms params={"conditions":"board/name = Customer Secret"}',
      { data: { authorization: "Basic ECHOED_SECRET" } },
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain("ECHOED_SECRET");
    expect(JSON.stringify(error.mock.calls)).not.toContain("authorization");
    expect(JSON.stringify(error.mock.calls)).not.toContain("Customer Secret");
  });

  it("builds a new client from the supplied immutable credential snapshot", () => {
    const firstClient = { ServiceAPI: {} };
    const secondClient = { ServiceAPI: {} };
    mockedManageApi
      .mockImplementationOnce(() => firstClient as never)
      .mockImplementationOnce(() => secondClient as never);

    const first = createCwm({
      server: " cw.example.com/ ",
      company: " tenant ",
      publicKey: " public ",
      privateKey: " private ",
      clientId: " client ",
    });
    const second = createCwm({
      server: "cw.example.com",
      company: "tenant",
      publicKey: "rotated-public",
      privateKey: "rotated-private",
      clientId: "client",
    });

    expect(first).toBe(firstClient);
    expect(second).toBe(secondClient);
    expect(mockedManageApi).toHaveBeenCalledTimes(2);
    expect(mockedManageApi).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        companyId: "tenant",
        companyUrl: "cw.example.com",
        publicKey: "public",
        privateKey: "private",
        clientId: "client",
        logger: safeConnectWiseLogger,
        debug: false,
      }),
    );
    expect(mockedManageApi).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        publicKey: "rotated-public",
        privateKey: "rotated-private",
      }),
    );
  });

  it("fails closed when any required credential is absent", () => {
    expect(() =>
      createCwm({
        server: "cw.example.com",
        company: "tenant",
        publicKey: "public",
        privateKey: "",
        clientId: "client",
      }),
    ).toThrow("credentials are not configured");
    expect(mockedManageApi).not.toHaveBeenCalled();
  });
});
