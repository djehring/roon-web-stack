import { hostInfoMock } from "./host-info.mock";

import Bonjour from "bonjour-service";
import { mdnsAdvertiser } from "./mdns-advertiser";

jest.mock("bonjour-service", () => {
  const publish = jest.fn();
  const unpublishAll = jest.fn();
  const destroy = jest.fn();
  const ctor = jest.fn().mockImplementation(() => ({
    publish,
    unpublishAll,
    destroy,
  }));
  return Object.assign(ctor, { publish, unpublishAll, destroy });
});

const BonjourMock = Bonjour as unknown as jest.Mock & {
  publish: jest.Mock;
  unpublishAll: jest.Mock;
  destroy: jest.Mock;
};

describe("mdns-advertiser.ts test suite", () => {
  beforeEach(() => {
    hostInfoMock.hostname = "nas.local";
    mdnsAdvertiser.stop();
    BonjourMock.mockClear();
    BonjourMock.publish.mockClear();
    BonjourMock.unpublishAll.mockClear();
    BonjourMock.destroy.mockClear();
    BonjourMock.unpublishAll.mockImplementation((cb?: () => void) => {
      if (cb) {
        cb();
      }
    });
  });

  afterEach(() => {
    mdnsAdvertiser.stop();
  });

  it("start should advertise _roon-web-stack._tcp on the HTTP port", () => {
    mdnsAdvertiser.start({ httpPort: 3000, httpsPort: 3443 });
    expect(BonjourMock).toHaveBeenCalledTimes(1);
    expect(BonjourMock.publish).toHaveBeenCalledTimes(1);
    expect(BonjourMock.publish).toHaveBeenCalledWith({
      name: "nas.local",
      type: "roon-web-stack",
      protocol: "tcp",
      port: 3000,
      txt: {
        ver: process.env.npm_package_version ?? "0.0.0",
        httpsPort: "3443",
      },
    });
  });

  it("start should be ignored if already advertising", () => {
    mdnsAdvertiser.start({ httpPort: 3000, httpsPort: 3443 });
    mdnsAdvertiser.start({ httpPort: 3000, httpsPort: 3443 });
    expect(BonjourMock).toHaveBeenCalledTimes(1);
    expect(BonjourMock.publish).toHaveBeenCalledTimes(1);
  });

  it("stop should unpublish and destroy the mDNS session", () => {
    mdnsAdvertiser.start({ httpPort: 3000, httpsPort: 3443 });
    mdnsAdvertiser.stop();
    expect(BonjourMock.unpublishAll).toHaveBeenCalledTimes(1);
    expect(BonjourMock.destroy).toHaveBeenCalledTimes(1);
  });

  it("stop should be ignored if not advertising", () => {
    expect(BonjourMock.unpublishAll).not.toHaveBeenCalled();
    expect(BonjourMock.destroy).not.toHaveBeenCalled();
  });
});
