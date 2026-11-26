const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    options: {
        encrypt: false,
        trustServerCertificate: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let poolPromise = null;
let hasLoggedConnection = false;

async function connectDB() {
    if (poolPromise) {
        try {
            const existingPool = await poolPromise;
            if (existingPool && existingPool.connected) {
                return existingPool;
            }
        } catch (_) {
            poolPromise = null;
            hasLoggedConnection = false;
        }
    }

    poolPromise = (async () => {
        try {
            const pool = new sql.ConnectionPool(dbConfig);
            pool.on('error', (err) => {
                console.error('SQL Server pool error:', err.message || err);
                hasLoggedConnection = false;
            });

            await pool.connect();

            if (!hasLoggedConnection) {
                console.log('Connected to SQL Server successfully!');
                hasLoggedConnection = true;
            }

            return pool;
        } catch (error) {
            poolPromise = null;
            hasLoggedConnection = false;
            console.error('Database connection failed:', error.message || error);
            throw error;
        }
    })();

    return poolPromise;
}

module.exports = {
    sql,
    connectDB,
    dbConfig
};
