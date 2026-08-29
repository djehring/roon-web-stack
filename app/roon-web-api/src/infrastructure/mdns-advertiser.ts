import Bonjour from "bonjour-service";
import { hostInfo } from "./host-info";
import { logger } from "./logger";
import { extension_version } from "./roon-extension";

export interface MdnsPorts {
  httpPort: number;
  httpsPort: number;
}

class InternalMdnsAdvertiser {
  private bonjour?: Bonjour;

  start = (ports: MdnsPorts): void => {
    if (this.bonjour !== undefined) {
      return;
    }
    const bonjour = new Bonjour();
    this.bonjour = bonjour;
    bonjour.publish({
      name: hostInfo.hostname,
      type: "roon-web-stack",
      protocol: "tcp",
      port: ports.httpPort,
      txt: {
        ver: extension_version,
        httpsPort: String(ports.httpsPort),
      },
    });
    logger.info("advertising _roon-web-stack._tcp on HTTP port %s", ports.httpPort);
  };

  stop = (): void => {
    if (this.bonjour === undefined) {
      return;
    }
    const bonjour = this.bonjour;
    this.bonjour = undefined;
    bonjour.unpublishAll(() => {
      bonjour.destroy();
    });
  };
}

export const mdnsAdvertiser = new InternalMdnsAdvertiser();
