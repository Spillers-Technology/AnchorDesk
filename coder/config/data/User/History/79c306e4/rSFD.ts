import mysql from 'mysql2/promise';

async function connectAndQuery() {
  // Create a connection pool for better management in larger apps
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Joseph1356',
    database: 'Resultant',
  });

  try {
    const [rows] = await connection.query('SELECT 1 + 1 AS solution');
    console.log('The solution is:', rows[0]?.solution);
  } catch (error) {
    console.error('Error during query:', error);
  } finally {
    // Always ensure the connection is closed
    await connection.end();
  }
}

connectAndQuery().catch((error) => {
  console.error('Unexpected error:', error);
});
