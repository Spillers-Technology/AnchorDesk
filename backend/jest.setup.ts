// Give Prisma a URL so importing DB-coupled modules doesn't throw during unit
// tests. No connection is made — these suites never run a query.
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.AUTH_SESSION_SECRET ||= 'test-secret';
