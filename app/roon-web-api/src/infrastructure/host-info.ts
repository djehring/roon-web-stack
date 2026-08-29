import * as os from "node:os";
import process from "process";
import { HostInfo } from "@model";

const SKIP_IFACE = /^(lo|bridge|vmenet|utun|awdl|llw|ap|gif|stf|anpi)/i;

const isLanV4 = (addr: os.NetworkInterfaceInfo, ifaceName: string): boolean => {
  if (addr.family !== "IPv4" || addr.internal) {
    return false;
  }
  if (SKIP_IFACE.test(ifaceName)) {
    return false;
  }
  if (addr.mac.startsWith("02:42") || addr.mac === "00:00:00:00:00:00") {
    return false;
  }
  return !addr.address.startsWith("169.254.");
};

export const hostInfo: HostInfo = (() => {
  const { HOST = "0.0.0.0", PORT = "3000", HTTP_PORT } = process.env;
  const port = parseInt(HTTP_PORT || PORT, 10);
  const hostname = os.hostname();
  const ifaces = os.networkInterfaces();
  const candidates: string[] = [];

  if (HOST !== "localhost" || process.env.NODE_ENV === "production") {
    for (const ifaceName in ifaces) {
      const iface = ifaces[ifaceName];
      if (!iface) {
        continue;
      }
      for (const addr of iface) {
        if (isLanV4(addr, ifaceName)) {
          candidates.push(addr.address);
        }
      }
    }
  }

  const ipV4 = candidates.find((ip) => ip.startsWith("192.168.")) ?? candidates.at(0);

  return {
    host: HOST,
    port,
    ipV4: ipV4 ?? HOST,
    hostname,
  };
})();
