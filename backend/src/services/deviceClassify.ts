// Ported from netviz internal/scanner/classify.go and ports.go.
//
// MIT License
// Copyright (c) 2026 Spillers-Technology
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the conditions in the source repository's
// LICENSE. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

export const PORT_SERVICES = new Map<number, string>([
  [21, 'ftp'], [22, 'ssh'], [23, 'telnet'], [53, 'dns'], [80, 'http'],
  [135, 'msrpc'], [139, 'netbios'], [443, 'https'], [445, 'smb'],
  [515, 'lpd'], [554, 'rtsp'], [631, 'ipp'], [1883, 'mqtt'],
  [32400, 'plex'], [9100, 'jetdirect'], [3389, 'rdp'], [5900, 'vnc'],
  [8000, 'http-alt'], [8080, 'http-alt'], [8123, 'home-assistant'],
  [8443, 'https-alt'], [8888, 'http-alt'],
]);

export function serviceName(port: number): string {
  return PORT_SERVICES.get(port) ?? `tcp/${port}`;
}

export function classifyDevice(openPorts: number[]): string {
  const ports = new Set(openPorts);
  const hasAny = (...candidates: number[]) => candidates.some((port) => ports.has(port));
  if (hasAny(9100, 631)) return 'printer';
  if (hasAny(445)) return 'windows_or_smb';
  if (hasAny(3389)) return 'windows_rdp';
  if (hasAny(22)) return 'ssh_device';
  if (hasAny(80, 443, 8000, 8080, 8123, 8443, 8888)) return 'web_device';
  if (hasAny(32400)) return 'plex';
  if (hasAny(554)) return 'camera_or_rtsp';
  if (hasAny(1883)) return 'iot_device';
  return 'unknown';
}

export function classifyHost(host: { vendor?: string | null; hostname?: string | null; openPorts?: number[] }): string {
  const fromPorts = classifyDevice(host.openPorts ?? []);
  if (fromPorts !== 'unknown') return fromPorts;

  const vendor = (host.vendor ?? '').toLowerCase();
  const hostname = (host.hostname ?? '').toLowerCase();
  if (['brother', 'canon', 'epson', 'hewlett packard', 'hp inc', 'lexmark', 'kyocera'].some((v) => vendor.includes(v)) || hostname.includes('printer')) return 'printer';
  if (['ubiquiti', 'tp-link', 'netgear', 'cisco', 'd-link', 'zyxel', 'mikrotik', 'juniper', 'aruba', 'fortinet'].some((v) => vendor.includes(v)) || hostname.includes('gateway') || hostname.includes('router')) return 'network_device';
  if (vendor.includes('raspberry pi')) return 'linux_or_iot';
  if (vendor.includes('apple')) return 'apple_device';
  if (vendor.includes('microsoft')) return 'windows_or_smb';
  if (['sonos', 'nest', 'amazon', 'espressif'].some((v) => vendor.includes(v))) return 'iot_device';
  return 'unknown';
}
