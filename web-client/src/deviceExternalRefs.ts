import type { DeviceExternalRef } from "./api/client";

export type ExternalReference = Pick<DeviceExternalRef, "provider" | "externalId">;

export interface DeviceReferenceCarrier {
  externalId?: string | null;
  externalProvider?: string | null;
  externalRefs?: ExternalReference[];
}

/** Prefer multi-provider identities while keeping records from older installs,
 * which may only carry the legacy primary identity, readable. */
export function externalReferencesForDevice(device: DeviceReferenceCarrier): ExternalReference[] {
  const refs = Array.isArray(device.externalRefs)
    ? device.externalRefs.filter((ref) => !!ref.provider && !!ref.externalId)
    : [];
  if (refs.length > 0) return refs;
  return device.externalProvider && device.externalId
    ? [{ provider: device.externalProvider, externalId: device.externalId }]
    : [];
}
