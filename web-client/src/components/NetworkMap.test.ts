import { describe, expect, it } from "vitest";
import { categoryFor, deviceIconFor, type NetworkMapDevice } from "./NetworkMap";

function device(overrides: Partial<NetworkMapDevice> = {}): NetworkMapDevice {
  return {
    ip: "192.0.2.10",
    alive: true,
    open_ports: [],
    device_type: "unknown",
    first_seen: "2026-01-01T00:00:00.000Z",
    last_updated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("NetworkMap device indicators", () => {
  it("gives coarse RMM device types distinct, useful icons", () => {
    expect(deviceIconFor(device({ device_type: "server" }))).toBe("🗄️");
    expect(deviceIconFor(device({ device_type: "workstation" }))).toBe("🖥️");
    expect(deviceIconFor(device({ device_type: "laptop" }))).toBe("💻");
    expect(deviceIconFor(device({ device_type: "storage" }))).toBe("💾");
    expect(deviceIconFor(device({ device_type: "kiosk" }))).toBe("🖥️");
  });

  it("recognizes scanner-specific printer, camera, and IoT types", () => {
    expect(deviceIconFor(device({ device_type: "printer" }))).toBe("🖨️");
    expect(deviceIconFor(device({ device_type: "camera_or_rtsp" }))).toBe("📹");
    expect(deviceIconFor(device({ device_type: "iot_device" }))).toBe("🔌");
  });

  it("falls back to service-based classification when type is unknown", () => {
    const dnsDevice = device({ open_ports: [{ port: 53, service: "dns" }] });
    expect(categoryFor(dnsDevice)).toBe("firewall/network");
    expect(deviceIconFor(dnsDevice)).toBe("📡");
  });
});
