const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
});

// Initialize tables
async function initDB() {
    try {
        // Main table - ONE ID for BOTH QR and Barcode!
        await pool.query(`
            CREATE TABLE IF NOT EXISTS codes (
                id TEXT PRIMARY KEY,
                product_name TEXT,
                product_type TEXT,
                price DECIMAL(10,2),
                qr_destination TEXT,
                qr_scan_count INTEGER DEFAULT 0,
                barcode_scan_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_qr_scanned TIMESTAMP,
                last_barcode_scanned TIMESTAMP
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS scan_logs (
                id SERIAL PRIMARY KEY,
                code TEXT NOT NULL,
                scan_type TEXT CHECK(scan_type IN ('qr', 'barcode')),
                scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ip_address TEXT,
                user_agent TEXT
            )
        `);
        
        console.log('✅ PostgreSQL Database initialized');
    } catch (error) {
        console.error('DB init error:', error);
    }
}

initDB();

const dbHelpers = {
    createCode: async (id, productName, productType, price, qrDestination) => {
        await pool.query(
            `INSERT INTO codes (id, product_name, product_type, price, qr_destination) 
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [id, productName, productType, price, qrDestination]
        );
    },
    
    getCode: async (id) => {
        const result = await pool.query(`SELECT * FROM codes WHERE id = $1`, [id]);
        return result.rows[0];
    },
    
    getAllCodes: async () => {
        const result = await pool.query(`SELECT * FROM codes ORDER BY created_at DESC`);
        return result.rows;
    },
    
    updateQRDestination: async (id, destination) => {
        await pool.query(
            `UPDATE codes SET qr_destination = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [destination, id]
        );
    },
    
    incrementQRScan: async (id) => {
        await pool.query(
            `UPDATE codes SET qr_scan_count = qr_scan_count + 1, last_qr_scanned = CURRENT_TIMESTAMP WHERE id = $1`,
            [id]
        );
    },
    
    incrementBarcodeScan: async (id) => {
        await pool.query(
            `UPDATE codes SET barcode_scan_count = barcode_scan_count + 1, last_barcode_scanned = CURRENT_TIMESTAMP WHERE id = $1`,
            [id]
        );
    },
    
    logScan: async (code, scanType, ip, userAgent) => {
        await pool.query(
            `INSERT INTO scan_logs (code, scan_type, ip_address, user_agent) VALUES ($1, $2, $3, $4)`,
            [code, scanType, ip, userAgent]
        );
    },
    
    getStats: async () => {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_codes,
                COALESCE(SUM(qr_scan_count), 0) as total_qr_scans,
                COALESCE(SUM(barcode_scan_count), 0) as total_barcode_scans
            FROM codes
        `);
        return result.rows[0];
    },
    
    deleteCode: async (id) => {
        await pool.query(`DELETE FROM codes WHERE id = $1`, [id]);
    }
};

module.exports = dbHelpers;
