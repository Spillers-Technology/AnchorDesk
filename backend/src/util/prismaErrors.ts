/** Read a Prisma error code without coupling route validation to one client instance. */
export function hasPrismaCode(error: unknown, ...codes: string[]): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return codes.includes(String((error as { code?: unknown }).code));
}
