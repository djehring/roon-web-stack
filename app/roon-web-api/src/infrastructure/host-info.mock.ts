import { HostInfo } from "@model";

const hostInfo = {};

export const hostInfoMock: HostInfo = hostInfo as HostInfo;

jest.mock("./host-info", () => ({
  hostInfo: hostInfoMock,
}));
