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
// NEON POSTGRES (Using POSTGRES_URL from Vercel)
// ============================================
const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

// Initialize tables
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
        console.log('✅ Neon Postgres connected');
    } catch (error) {
        console.error('DB error:', error.message);
    }
}
initDB();

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create QR code
app.post('/api/qr/create', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID is required' });
    
    try {
        await pool.query('INSERT INTO qr_codes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        res.json({ success: true, id: id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate QR code image
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

// List all QR codes (FROM NEON)
app.get('/api/qr/list', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, destination_url, scan_count, created_at FROM qr_codes ORDER BY created_at DESC');
        res.json({ success: true, codes: result.rows });
    } catch (error) {
        res.json({ success: true, codes: [] });
    }
});

// Update destination
app.put('/api/qr/update/:id', async (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    try {
        await pool.query('UPDATE qr_codes SET destination_url = $1 WHERE id = $2', [destinationUrl, id]);
        res.json({ success: true, message: `Updated ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete QR code
app.delete('/api/qr/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM qr_codes WHERE id = $1', [id]);
        res.json({ success: true, message: `Deleted ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Redirect endpoint
app.get('/api/r/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT destination_url FROM qr_codes WHERE id = $1', [id]);
        if (!result.rows[0]?.destination_url) {
            return res.status(404).send(`Code "${id}" not found`);
        }
        await pool.query('UPDATE qr_codes SET scan_count = scan_count + 1 WHERE id = $1', [id]);
        res.redirect(result.rows[0].destination_url);
    } catch (error) {
        res.status(500).send('Server error');
    }
});

// Barcode endpoints
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
        
        await pool.query('INSERT INTO qr_codes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        res.json({ success: true, image: `data:image/png;base64,${barcodeBuffer.toString('base64')}`, id: id, value: id });
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
