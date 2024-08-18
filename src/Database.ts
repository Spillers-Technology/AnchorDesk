import mysql, { Connection } from 'mysql2/promise';

export class Database {
  private connection: Connection | null = null;

  constructor(
    private host: string,
    private user: string,
    private password: string,
    private database: string
  ) {}

  // Create a connection to the database
  public async connect(): Promise<void> {
    if (!this.connection) {
      this.connection = await mysql.createConnection({
        host: this.host,
        user: this.user,
        password: this.password,
        database: this.database,
      });
    }
  }

  // Execute queries
  public async query(sql: string, params?: any[]): Promise<[any, any]> {
    if (!this.connection) {
      throw new Error('Database connection is not established.');
    }

    return this.connection.query(sql, params);
  }

  // Close the connection
  public async close(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
    }
  }
}
