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
// NEON POSTGRES - PERMANENT STORAGE
// ============================================
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

// Create table if not exists
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS qr_codes (
                id TEXT PRIMARY KEY,
                destination_url TEXT,
                scan_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Neon Postgres connected - Data will persist forever!');
    } catch (error) {
        console.error('DB error:', error.message);
    }
}
initDB();

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// CREATE QR CODE (SAVES TO NEON)
// ============================================
app.post('/api/qr/create', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID is required' });
    
    try {
        await pool.query(
            'INSERT INTO qr_codes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
            [id]
        );
        console.log(`✅ QR code saved to Neon: ${id}`);
        res.json({ success: true, id: id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GENERATE QR CODE IMAGE
// ============================================
app.post('/api/qr/generate', async (req, res) => {
    try {
        const { content, darkColor = '#D4AF37', lightColor = '#FFFFFF', format = 'png' } = req.body;
        if (!content) return res.status(400).json({ error: 'Content is required' });
        
        if (format === 'svg') {
            const svgString = await QRCode.toString(content, {
                type: 'svg', width: 500, margin: 2,
                color: { dark: darkColor, light: lightColor },
                errorCorrectionLevel: 'H'
            });
            res.json({ success: true, svgContent: svgString, content: content, format: 'svg' });
        } else {
            const qrBuffer = await QRCode.toBuffer(content, {
                type: 'png', width: 500, margin: 2,
                color: { dark: darkColor, light: lightColor },
                errorCorrectionLevel: 'H'
            });
            res.json({ success: true, image: `data:image/png;base64,${qrBuffer.toString('base64')}`, content: content });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// In api/index.js - Add this to the redirect endpoint
app.get('/api/r/:id', async (req, res) => {
    const { id } = req.params;
    
    // Check if this is a product QR code (COF prefix)
    if (id.startsWith('COF') || id.startsWith('YIRG') || id.startsWith('SIDM') || id.startsWith('GUJI')) {
        // Redirect to product landing page (not payment directly)
        const landingUrl = `/product.html?id=${id}`;
        return res.redirect(landingUrl);
    }
    
    // For other QR codes (TEST001, etc.), use normal redirect
    const qrData = await db.getQRCode(id);
    if (qrData?.destination_url) {
        res.redirect(qrData.destination_url);
    } else {
        res.status(404).send('QR code not found');
    }
});
// ============================================
// LIST ALL QR CODES (FROM NEON - PERMANENT)
// ============================================
app.get('/api/qr/list', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, destination_url, scan_count, created_at 
            FROM qr_codes 
            ORDER BY created_at DESC
        `);
        console.log(`📋 Retrieved ${result.rows.length} QR codes from Neon`);
        res.json({ success: true, codes: result.rows });
    } catch (error) {
        console.error('List error:', error);
        res.json({ success: true, codes: [] });
    }
});

// ============================================
// UPDATE DESTINATION
// ============================================
app.put('/api/qr/update/:id', async (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    
    try {
        await pool.query(
            'UPDATE qr_codes SET destination_url = $1 WHERE id = $2',
            [destinationUrl, id]
        );
        console.log(`✏️ Updated ${id} → ${destinationUrl}`);
        res.json({ success: true, message: `Updated ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// DELETE QR CODE
// ============================================
app.delete('/api/qr/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM qr_codes WHERE id = $1', [id]);
        console.log(`🗑️ Deleted ${id}`);
        res.json({ success: true, message: `Deleted ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// REDIRECT ENDPOINT
// ============================================
app.get('/api/r/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'SELECT destination_url FROM qr_codes WHERE id = $1',
            [id]
        );
        
        if (!result.rows[0]?.destination_url) {
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
        
        await pool.query(
            'UPDATE qr_codes SET scan_count = scan_count + 1 WHERE id = $1',
            [id]
        );
        
        console.log(`📱 QR SCAN: ${id} → ${result.rows[0].destination_url}`);
        res.redirect(result.rows[0].destination_url);
        
    } catch (error) {
        console.error('Redirect error:', error);
        res.status(500).send('Server error');
    }
});

// ============================================
// BARCODE ENDPOINTS
// ============================================
app.post('/api/barcode/generate', async (req, res) => {
    try {
        const { id, barcodeType = 'code128', barColor = '#D4AF37' } = req.body;
        if (!id) return res.status(400).json({ error: 'ID is required' });
        
        const barcodeBuffer = await new Promise((resolve, reject) => {
            bwipjs.toBuffer({
                bcid: barcodeType, text: id, scale: 3, height: 12,
                includetext: true, textxalign: 'center',
                barcolor: barColor.replace('#', '')
            }, (err, png) => err ? reject(err) : resolve(png));
        });
        
        // Also save to Neon
        await pool.query(
            'INSERT INTO qr_codes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
            [id]
        );
        
        res.json({
            success: true,
            image: `data:image/png;base64,${barcodeBuffer.toString('base64')}`,
            id: id,
            value: id
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/barcode/batch', async (req, res) => {
    try {
        const { prefix, startNumber, endNumber, barcodeType = 'code128', barColor = '#D4AF37' } = req.body;
        const results = [];
        const padLength = String(endNumber).length;
        
        for (let i = startNumber; i <= endNumber; i++) {
            const id = `${prefix}${String(i).padStart(padLength, '0')}`;
            const barcodeBuffer = await new Promise((resolve, reject) => {
                bwipjs.toBuffer({
                    bcid: barcodeType, text: id, scale: 3, height: 12,
                    includetext: true, textxalign: 'center',
                    barcolor: barColor.replace('#', '')
                }, (err, png) => err ? reject(err) : resolve(png));
            });
            results.push({ id: id, image: `data:image/png;base64,${barcodeBuffer.toString('base64')}` });
        }
        res.json({ success: true, total: results.length, barcodes: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    }
});

module.exports = app;
