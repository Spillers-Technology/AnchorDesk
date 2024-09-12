export interface TimeEntry {
  TimeEntryID: number;
  TimeStart: string;
  TimeStop: string;
  TimeNote: string;
  Technician: Technician | null;
}

export interface Technician {
  TechnicianID: number;
  FirstName: string;
  LastName: string;
  Username: string;
}

export interface Company {
  CompanyName: string;
  Acronym: string;
  PrimaryEngagementMgr: string;
}

export interface Ticket {
  status: any;
  ticketnumber: number;
  company: Company;
  ticketSummary: string;
  ticketTitle: string;  // New field for ticket title
  technician: Technician | null;
  priority: string;
  timeEntries: TimeEntry[];
}
