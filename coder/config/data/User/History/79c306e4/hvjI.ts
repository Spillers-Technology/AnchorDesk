import mysql from 'mysql2/promise';
import TicketFactory from './TicketFactory';

async function main() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Joseph1356',
    database: 'Resultant',
  });

  const ticketFactory = new TicketFactory(connection);

  try {
    const tickets = await ticketFactory.getAllTickets();
    console.log(JSON.stringify(tickets, null, 2));
  } catch (err) {
    console.error('Error fetching tickets:', err);
  } finally {
    await connection.end();
  }
}

main();
