// src/controllers/ticketController.ts
import { cwm } from '../services/connectwiseService';

// Fetch a specific ticket by ID
export async function getTicketById(ticketId: number) {
  try {
    const ticket = await cwm.ServiceAPI.getServiceTicketsById(ticketId);
    return ticket;
  } catch (error) {
    throw new Error(`Unable to fetch ticket: ${(error as Error).message}`);
  }
}

// Fetch open tickets based on predefined conditions
export async function getOpenTickets() {
  const conditions = "board/name='SMB Services - SMB Team 1 Support' AND status/name!='Closed' AND status/name!='Admin Closed' AND status/name!='Complete' AND status/name!='Canceled' AND status/name!='Closed/No Response' AND (resources='NULL' OR resources='') AND parentTicketId=NULL";
  
  try {
    const tickets = await cwm.ServiceAPI.getServiceTickets({
      conditions,
      page: 1,
      pageSize: 1000,
    });
    return tickets;
  } catch (error) {
    throw new Error(`Unable to fetch ticket: ${(error as Error).message}`);
  }
}

// Fetch tickets assigned to a specific resource
export async function getTicketsByResource(resource: string) {
  const conditions = `resources='${resource}' AND status/name NOT LIKE '%Closed%' AND status/name!='Complete' AND status/name!='Canceled' AND board/name='SMB Services - SMB Team 1 Support'`;
  
  try {
    const tickets = await cwm.ServiceAPI.getServiceTickets({
      conditions,
      page: 1,
      pageSize: 1000,
    });
    return tickets;
  } catch (error) {
    throw new Error(`Unable to fetch tickets for resource ${resource}: ${(error as Error).message}`);
  }
}

// Fetch ticket notes by ticket ID
export async function getTicketNotes(ticketId: number) {
  try {
    const notes = await cwm.ServiceAPI.getServiceTicketsByParentIdNotes(ticketId);
    return notes;
  } catch (error) {
    throw new Error(`Unable to fetch notes for ticket ${ticketId}: ${(error as Error).message}`);
  }
}
