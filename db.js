const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: 'nemochat',
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = pool;