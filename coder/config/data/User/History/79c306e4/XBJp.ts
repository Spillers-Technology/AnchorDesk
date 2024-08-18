

const connection = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Joseph1356',
  database: 'Resultant',
});


import { Database } from './Database';
import TicketFactory from './TicketFactory';

async function main() {
  // Create a new Database object
  const db = new Database('localhost', 'root', 'password', 'your_database_name');

  // Connect to the database
  await db.connect();

  // Create the factory using the Database object
  const ticketFactory = new TicketFactory(db);

  try {
    const tickets = await ticketFactory.getAllTickets();
    console.log(JSON.stringify(tickets, null, 2));
  } catch (err) {
    console.error('Error fetching tickets:', err);
  } finally {
    // Close the database connection
    await db.close();
  }
}

main();
