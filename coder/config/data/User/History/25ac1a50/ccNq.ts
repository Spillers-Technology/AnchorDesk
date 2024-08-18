import { Company, Technician, Ticket, TimeEntry } from './interfaces'; // Ensure you import the interfaces
import mysql from 'mysql2/promise';

class TicketFactory {
  private connection: mysql.Connection;

  constructor(connection: mysql.Connection) {
    this.connection = connection;
  }

  // Fetch all companies
  private async getCompanyById(TitleID: number): Promise<Company> {
    const [rows] = await this.connection.query(
      'SELECT * FROM Team1ClientList WHERE TitleID = ?',
      [TitleID]
    );
    return rows[0] as Company;
  }

  // Fetch all technicians assigned to a ticket
  private async getTechniciansByTicket(ticketNumber: number): Promise<Technician[]> {
    const [rows] = await this.connection.query(
      `SELECT t.* FROM Technicians t 
      JOIN Tickets tk ON tk.technician = t.TechnicianID
      WHERE tk.ticketnumber = ?`,
      [ticketNumber]
    );
    return rows as Technician[];
  }

  // Fetch all time entries assigned to a ticket
  private async getTimeEntriesByTicket(ticketNumber: number): Promise<TimeEntry[]> {
    const [rows] = await this.connection.query(
      'SELECT * FROM TimeEntries WHERE TicketID = ?',
      [ticketNumber]
    );
    
    const timeEntries: TimeEntry[] = [];
    
    for (const row of rows) {
      const technician = await this.getTechnicianById(row.Technician);
      const timeEntry: TimeEntry = {
        TimeEntryID: row.TimeEntryID,
        TicketID: row.TicketID,
        TimeStart: row.TimeStart,
        TimeStop: row.TimeStop,
        TimeNote: row.TimeNote,
        Technician: technician,
      };
      timeEntries.push(timeEntry);
    }
    
    return timeEntries;
  }

  // Get a technician by ID
  private async getTechnicianById(TechnicianID: number): Promise<Technician> {
    const [rows] = await this.connection.query(
      'SELECT * FROM Technicians WHERE TechnicianID = ?',
      [TechnicianID]
    );
    return rows[0] as Technician;
  }

  // Fetch all tickets with their relationships
  public async getAllTickets(): Promise<Ticket[]> {
    const [rows] = await this.connection.query('SELECT * FROM Tickets');
    const tickets: Ticket[] = [];

    for (const row of rows) {
      const company = await this.getCompanyById(row.company);
      const technicians = await this.getTechniciansByTicket(row.ticketnumber);
      const timeEntries = await this.getTimeEntriesByTicket(row.ticketnumber);

      const ticket: Ticket = {
        ticketnumber: row.ticketnumber,
        ticketSummary: row.ticketSummary,
        priority: row.priority,
        company: company,
        technicians: technicians,
        timeEntries: timeEntries,
      };

      tickets.push(ticket);
    }

    return tickets;
  }
}

export default TicketFactory;
