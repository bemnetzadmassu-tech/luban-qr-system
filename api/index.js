const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// DATABASE CONNECTION (Neon Postgres)
// ============================================
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
});

// Initialize database tables
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
        
        // Scan logs table
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
        
        console.log('✅ PostgreSQL database initialized');
    } catch (error) {
        console.error('DB init error:', error);
    }
}

initDB();

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// CREATE QR CODE (Save to Database)
// ============================================
app.post('/api/qr/create', async (req, res) => {
    const { id } = req.body;
    
    if (!id) {
        return res.status(400).json({ error: 'ID is required' });
    }
    
    try {
        await pool.query(
            `INSERT INTO codes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
            [id]
        );
        console.log(`✅ QR code created: ${id}`);
        res.json({ success: true, id: id });
    } catch (error) {
        console.error('Create error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GENERATE QR CODE IMAGE
// ============================================
app.post('/api/qr/generate', async (req, res) => {
    try {
        const { content, darkColor = '#4A2C1A', lightColor = '#F5E6D3' } = req.body;
        
        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }
        
        const qrBuffer = await QRCode.toBuffer(content, {
            type: 'png',
            width: 500,
            margin: 2,
            color: { dark: darkColor, light: lightColor },
            errorCorrectionLevel: 'H'
        });
        
        const qrBase64 = qrBuffer.toString('base64');
        
        res.json({
            success: true,
            image: `data:image/png;base64,${qrBase64}`,
            content: content
        });
        
    } catch (error) {
        console.error('QR error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// LIST ALL QR CODES
// ============================================
app.get('/api/qr/list', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, qr_destination as destination_url, qr_scan_count as scan_count, created_at 
            FROM codes 
            ORDER BY created_at DESC
        `);
        res.json({ success: true, codes: result.rows });
    } catch (error) {
        console.error('List error:', error);
        res.json({ success: true, codes: [] });
    }
});

// ============================================
// UPDATE QR DESTINATION
// ============================================
app.put('/api/qr/update/:id', async (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    
    try {
        await pool.query(
            `UPDATE codes SET qr_destination = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [destinationUrl, id]
        );
        console.log(`✏️ Updated ${id} → ${destinationUrl}`);
        res.json({ success: true, message: `Updated ${id} → ${destinationUrl}` });
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// DELETE QR CODE
// ============================================
app.delete('/api/qr/delete/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        await pool.query(`DELETE FROM codes WHERE id = $1`, [id]);
        console.log(`🗑️ Deleted ${id}`);
        res.json({ success: true, message: `Deleted ${id}` });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// REDIRECT ENDPOINT (For QR Code Scanning)
// ============================================
app.get('/api/r/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT qr_destination FROM codes WHERE id = $1`,
            [id]
        );
        
        if (!result.rows[0] || !result.rows[0].qr_destination) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head><title>QR Code Not Found</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>❌ Code Not Found</h1>
                    <p>The code "${id}" has not been configured yet.</p>
                </body>
                </html>
            `);
        }
        
        // Increment scan count
        await pool.query(
            `UPDATE codes SET qr_scan_count = qr_scan_count + 1, last_qr_scanned = CURRENT_TIMESTAMP WHERE id = $1`,
            [id]
        );
        
        console.log(`📱 QR SCAN: ${id} → ${result.rows[0].qr_destination}`);
        
        res.redirect(result.rows[0].qr_destination);
        
    } catch (error) {
        console.error('Redirect error:', error);
        res.status(500).send('Server error');
    }
});

// ============================================
// GENERATE SINGLE BARCODE
// ============================================
app.post('/api/barcode/generate', async (req, res) => {
    try {
        const { id, barcodeType = 'code128', barColor = '#000000' } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }
        
        const barcodeBuffer = await new Promise((resolve, reject) => {
            bwipjs.toBuffer({
                bcid: barcodeType,
                text: id,
                scale: 3,
                height: 12,
                includetext: true,
                textxalign: 'center',
                barcolor: barColor.replace('#', '')
            }, (err, png) => {
                if (err) reject(err);
                else resolve(png);
            });
        });
        
        const barcodeBase64 = barcodeBuffer.toString('base64');
        
        // Also save to database if not exists
        await pool.query(
            `INSERT INTO codes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
            [id]
        );
        
        res.json({
            success: true,
            image: `data:image/png;base64,${barcodeBase64}`,
            id: id,
            value: id
        });
        
    } catch (error) {
        console.error('Barcode error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// BATCH BARCODE GENERATION
// ============================================
app.post('/api/barcode/batch', async (req, res) => {
    try {
        const { prefix, startNumber, endNumber, barcodeType = 'code128', barColor = '#000000' } = req.body;
        
        if (!prefix || !startNumber || !endNumber) {
            return res.status(400).json({ error: 'Prefix, startNumber, endNumber required' });
        }
        
        const total = endNumber - startNumber + 1;
        if (total > 1000) {
            return res.status(400).json({ error: 'Maximum 1000 barcodes per batch' });
        }
        
        const results = [];
        const padLength = String(endNumber).length;
        
        for (let i = startNumber; i <= endNumber; i++) {
            const paddedNumber = String(i).padStart(padLength, '0');
            const id = `${prefix}${paddedNumber}`;
            
            const barcodeBuffer = await new Promise((resolve, reject) => {
                bwipjs.toBuffer({
                    bcid: barcodeType,
                    text: id,
                    scale: 3,
                    height: 12,
                    includetext: true,
                    textxalign: 'center',
                    barcolor: barColor.replace('#', '')
                }, (err, png) => {
                    if (err) reject(err);
                    else resolve(png);
                });
            });
            
            const barcodeBase64 = barcodeBuffer.toString('base64');
            
            // Save to database
            await pool.query(
                `INSERT INTO codes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
                [id]
            );
            
            results.push({
                id: id,
                image: `data:image/png;base64,${barcodeBase64}`
            });
        }
        
        console.log(`📦 Generated ${results.length} barcodes`);
        
        res.json({
            success: true,
            total: results.length,
            barcodes: results
        });
        
    } catch (error) {
        console.error('Batch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// SERVE STATIC FILES
// ============================================
app.use(express.static(path.join(__dirname, '../public')));

// Catch-all for frontend
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    }
});

module.exports = app;
