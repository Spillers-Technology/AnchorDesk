import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import mysql from 'mysql2/promise';
import TicketFactory from './TicketFactory';

const connection = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'Joseph1356',
  database: 'Resultant',
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)












async function main() {


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
