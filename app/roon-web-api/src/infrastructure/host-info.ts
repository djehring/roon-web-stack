import * as os from "node:os";
import process from "process";
import { HostInfo } from "@model";

export const hostInfo: HostInfo = (() => {
  const { HOST = "0.0.0.0", PORT = "3000" } = process.env;
  const port = parseInt(PORT, 10);
  const hostname = os.hostname();
  const ifaces = os.networkInterfaces();

  let ipV4: string | undefined;
  if (HOST !== "localhost" || process.env.NODE_ENV === "production") {
    for (const ifaceName in ifaces) {
      const iface = ifaces[ifaceName];
      if (iface) {
        for (const addr of iface) {
          if (
            addr.family === "IPv4" &&
            !addr.internal &&
            // exclude docker default bridge
            !addr.mac.startsWith("02:42") &&
            // exclude obviously VPN addresses
            addr.mac !== "00:00:00:00:00:00"
          ) {
            ipV4 = addr.address;
            break;
          }
        }
      }
    }
  }

  return {
    host: HOST,
    port,
    ipV4: ipV4 ?? HOST,
    hostname,
  };
})();
