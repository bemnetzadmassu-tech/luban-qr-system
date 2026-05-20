const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./luban_codes.db');

db.serialize(() => {
    // Main table - ONE ID for BOTH QR and Barcode!
    db.run(`
        CREATE TABLE IF NOT EXISTS codes (
            id TEXT PRIMARY KEY,
            product_name TEXT,
            product_type TEXT,
            price DECIMAL(10,2),
            qr_destination TEXT,
            qr_scan_count INTEGER DEFAULT 0,
            barcode_scan_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_qr_scanned DATETIME,
            last_barcode_scanned DATETIME
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS scan_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            scan_type TEXT CHECK(scan_type IN ('qr', 'barcode')),
            scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT,
            user_agent TEXT
        )
    `);
    
    console.log('✅ Database initialized');
});

const dbHelpers = {
    createCode: (id, productName, productType, price, qrDestination) => {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO codes (id, product_name, product_type, price, qr_destination) VALUES (?, ?, ?, ?, ?)`,
                [id, productName, productType, price, qrDestination],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    },
    
    getCode: (id) => {
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM codes WHERE id = ?`, [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },
    
    getAllCodes: () => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM codes ORDER BY created_at DESC`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },
    
    updateQRDestination: (id, destination) => {
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE codes SET qr_destination = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [destination, id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    },
    
    incrementQRScan: (id) => {
        db.run(
            `UPDATE codes SET qr_scan_count = qr_scan_count + 1, last_qr_scanned = CURRENT_TIMESTAMP WHERE id = ?`,
            [id]
        );
    },
    
    incrementBarcodeScan: (id) => {
        db.run(
            `UPDATE codes SET barcode_scan_count = barcode_scan_count + 1, last_barcode_scanned = CURRENT_TIMESTAMP WHERE id = ?`,
            [id]
        );
    },
    
    logScan: (code, scanType, ip, userAgent) => {
        db.run(
            `INSERT INTO scan_logs (code, scan_type, ip_address, user_agent) VALUES (?, ?, ?, ?)`,
            [code, scanType, ip, userAgent]
        );
    },
    
    getStats: () => {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT 
                    COUNT(*) as total_codes,
                    SUM(qr_scan_count) as total_qr_scans,
                    SUM(barcode_scan_count) as total_barcode_scans
                FROM codes`,
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    },
    
    deleteCode: (id) => {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM codes WHERE id = ?`, [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
};

module.exports = dbHelpers;