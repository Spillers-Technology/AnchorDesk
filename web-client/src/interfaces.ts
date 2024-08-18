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
  ticketnumber: number;
  ticketSummary: string;
  priority: string;
  company: Company;
  technicians: Technician[];
  timeEntries: TimeEntry[];
}
