// Ported from netviz internal/scanner/ports.go (MIT, Copyright 2026 Spillers-Technology).
const SERVICES = new Map<number, string>([
  [21, "ftp"], [22, "ssh"], [23, "telnet"], [53, "dns"], [80, "http"],
  [135, "msrpc"], [139, "netbios"], [443, "https"], [445, "smb"],
  [515, "lpd"], [554, "rtsp"], [631, "ipp"], [1883, "mqtt"],
  [32400, "plex"], [9100, "jetdirect"], [3389, "rdp"], [5900, "vnc"],
  [8000, "http-alt"], [8080, "http-alt"], [8123, "home-assistant"],
  [8443, "https-alt"], [8888, "http-alt"],
]);

export function serviceName(port: number): string {
  return SERVICES.get(port) ?? `tcp/${port}`;
}
