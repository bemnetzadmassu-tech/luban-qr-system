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

// ============================================
// CREATE QR CODE
// ============================================
app.post('/api/qr/create', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID is required' });
    
    try {
        await pool.query(
            'INSERT INTO qr_codes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
            [id]
        );
        console.log(`✅ QR code saved: ${id}`);
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

// ============================================
// LIST ALL QR CODES
// ============================================
app.get('/api/qr/list', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, destination_url, scan_count, created_at 
            FROM qr_codes 
            ORDER BY created_at DESC
        `);
        res.json({ success: true, codes: result.rows });
    } catch (error) {
        res.json({ success: true, codes: [] });
    }
});

// ============================================
// UPDATE DESTINATION (Regular Redirect)
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
        res.json({ success: true, message: `Updated ${id} → ${destinationUrl}` });
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
        res.json({ success: true, message: `Deleted ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// UPDATE PRODUCT PAGE
// ============================================
app.put('/api/qr/update-product/:id', async (req, res) => {
    const { id } = req.params;
    const { productName, productPrice, productDescription } = req.body;
    
    try {
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_name TEXT`);
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_price DECIMAL(10,2)`);
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_description TEXT`);
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'redirect'`);
        
        await pool.query(`
            UPDATE qr_codes 
            SET page_type = 'product', 
                product_name = $1, 
                product_price = $2, 
                product_description = $3,
                destination_url = NULL
            WHERE id = $4
        `, [productName, productPrice, productDescription, id]);
        
        res.json({ success: true, message: `Product page updated for ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET PRODUCT INFO
// ============================================
app.get('/api/qr/product/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT product_name, product_price, product_description, page_type
            FROM qr_codes WHERE id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        res.json({ success: true, product: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// MAIN REDIRECT ENDPOINT (ONLY ONE!)
// Handles BOTH regular redirects AND product pages
// ============================================
app.get('/api/r/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Ensure columns exist
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'redirect'`);
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_name TEXT`);
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_price DECIMAL(10,2)`);
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_description TEXT`);
        
        const result = await pool.query(`
            SELECT page_type, destination_url, product_name, product_price, product_description 
            FROM qr_codes WHERE id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).send(`Code "${id}" not found. Generate it first.`);
        }
        
        const qrData = result.rows[0];
        
        // Increment scan count
        await pool.query('UPDATE qr_codes SET scan_count = scan_count + 1 WHERE id = $1', [id]);
        
        // Check if it's a product page
        if (qrData.page_type === 'product' && qrData.product_name) {
            const productPage = `/product.html?id=${id}&name=${encodeURIComponent(qrData.product_name)}&price=${qrData.product_price}&desc=${encodeURIComponent(qrData.product_description || '')}`;
            console.log(`📦 Product: ${id} → ${qrData.product_name}`);
            return res.redirect(productPage);
        }
        
        // Regular redirect to URL
        if (!qrData.destination_url) {
            return res.status(404).send(`Code "${id}" has no destination set.`);
        }
        
        console.log(`📱 QR SCAN: ${id} → ${qrData.destination_url}`);
        res.redirect(qrData.destination_url);
        
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
        
        await pool.query('INSERT INTO qr_codes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        
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