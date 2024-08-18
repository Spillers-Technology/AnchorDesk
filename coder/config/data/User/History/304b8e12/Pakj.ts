export interface Company {
    TitleID: number;
    CompanyName: string;
    Acronym: string;
    PrimaryEngagementMgr: string;
    SecondaryEngagementMgr: string;
    MSTAssigned: string;
    HelpDeskNumber: string;
    Agreement: string;
    ContactFirstName: string;
    ContactLastName: string | null;
    ContactEmail: string;
  }
  
  export interface Technician {
    TechnicianID: number;
    Username: string;
    FirstName: string;
    LastName: string;
  }
  
  export interface TimeEntry {
    TimeEntryID: number;
    TicketID: number;
    TimeStart: Date;
    TimeStop: Date;
    TimeNote: Buffer;
    Technician: Technician;
  }
  
  export interface Ticket {
    ticketnumber: number;
    ticketSummary: string;
    priority: string;
    company: Company;
    technicians: Technician[];
    timeEntries: TimeEntry[];
  }
  