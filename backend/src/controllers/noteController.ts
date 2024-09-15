// src/controllers/notesController.ts
import { cwm } from '../services/connectwiseService';

// Fetch notes for a specific ticket by ticket ID
export async function getTicketNotes(ticketId: number) {
  try {
    const notes = await cwm.ServiceAPI.getServiceTicketsByParentIdNotes(ticketId);
    return notes;
  } catch (error) {
    throw new Error(`Unable to fetch notes for ticket ${ticketId}: ${(error as Error).message}`);
  }
}
