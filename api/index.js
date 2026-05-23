const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const db = require('../database');
const { validateAdminPassword } = require('./middleware/auth');
// Add these to your main index.js after existing routes
const barcodeRoutes = require('./routes/barcodeRoutes');
const posRoutes = require('./routes/posRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');

app.use('/api/barcode', barcodeRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/inventory', inventoryRoutes);
const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// AUTHENTICATION
// ============================================
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (validateAdminPassword(password)) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// STATISTICS
// ============================================
app.get('/api/stats', async (req, res) => {
    try {
        const result = await db.query('SELECT COUNT(*) as total, SUM(scan_count) as scans FROM qr_codes');
        res.json({ success: true, stats: result.rows[0] });
    } catch (error) {
        res.json({ success: true, stats: { total: 0, scans: 0 } });
    }
});

// ============================================
// QR CODE ENDPOINTS
// ============================================
app.post('/api/qr/create', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });
    
    try {
        await db.query('INSERT INTO qr_codes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/qr/generate', async (req, res) => {
    try {
        const { content, darkColor = '#D4AF37', lightColor = '#FFFFFF', format = 'png' } = req.body;
        if (!content) return res.status(400).json({ error: 'Content required' });
        
        if (format === 'svg') {
            const svgString = await QRCode.toString(content, {
                type: 'svg', width: 500, margin: 2,
                color: { dark: darkColor, light: lightColor },
                errorCorrectionLevel: 'H'
            });
            res.json({ success: true, svgContent: svgString, format: 'svg' });
        } else {
            const qrBuffer = await QRCode.toBuffer(content, {
                type: 'png', width: 500, margin: 2,
                color: { dark: darkColor, light: lightColor },
                errorCorrectionLevel: 'H'
            });
            res.json({ success: true, image: `data:image/png;base64,${qrBuffer.toString('base64')}` });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/qr/list', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT id, destination_url, scan_count, created_at,
                   page_type, product_name, product_price, product_description
            FROM qr_codes ORDER BY created_at DESC
        `);
        res.json({ success: true, codes: result.rows });
    } catch (error) {
        res.json({ success: true, codes: [] });
    }
});

app.put('/api/qr/update/:id', async (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    
    try {
        await db.query('UPDATE qr_codes SET destination_url = $1 WHERE id = $2', [destinationUrl, id]);
        res.json({ success: true, message: `Updated ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/qr/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM qr_codes WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/qr/update-product/:id', async (req, res) => {
    const { id } = req.params;
    const { productName, productPrice, productDescription } = req.body;
    
    try {
        await db.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_name TEXT`);
        await db.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_price DECIMAL(10,2)`);
        await db.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_description TEXT`);
        await db.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'redirect'`);
        
        await db.query(`
            UPDATE qr_codes 
            SET page_type = 'product', product_name = $1, product_price = $2, product_description = $3, destination_url = NULL
            WHERE id = $4
        `, [productName, productPrice, productDescription, id]);
        
        res.json({ success: true, message: `Product page saved for ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/qr/product/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query(`
            SELECT page_type, product_name, product_price, product_description, destination_url
            FROM qr_codes WHERE id = $1
        `, [id]);
        res.json({ success: true, product: result.rows[0] || {} });
    } catch (error) {
        res.json({ success: true, product: {} });
    }
});

// ============================================
// REDIRECT ENDPOINT
// ============================================
app.get('/api/r/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query(`
            SELECT page_type, destination_url, product_name, product_price, product_description 
            FROM qr_codes WHERE id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).send('QR code not found');
        }
        
        const qrData = result.rows[0];
        await db.query('UPDATE qr_codes SET scan_count = scan_count + 1 WHERE id = $1', [id]);
        
        if (qrData.page_type === 'product' && qrData.product_name) {
            const productPage = `/product.html?id=${id}&name=${encodeURIComponent(qrData.product_name)}&price=${qrData.product_price}&desc=${encodeURIComponent(qrData.product_description || '')}`;
            return res.redirect(productPage);
        }
        
        res.redirect(qrData.destination_url || '/');
    } catch (error) {
        res.redirect('/');
    }
});

// ============================================
// BARCODE ENDPOINTS
// ============================================
app.post('/api/barcode/generate', async (req, res) => {
    try {
        const { id, barColor = '#D4AF37' } = req.body;
        if (!id) return res.status(400).json({ error: 'ID required' });
        
        const barcodeBuffer = await new Promise((resolve, reject) => {
            bwipjs.toBuffer({
                bcid: 'code128', text: id, scale: 3, height: 12,
                includetext: true, textxalign: 'center',
                barcolor: barColor.replace('#', '')
            }, (err, png) => err ? reject(err) : resolve(png));
        });
        
        res.json({ success: true, image: `data:image/png;base64,${barcodeBuffer.toString('base64')}`, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/barcode/batch', async (req, res) => {
    try {
        const { prefix, startNumber, endNumber, barColor = '#D4AF37' } = req.body;
        const results = [];
        const padLength = String(endNumber).length;
        
        for (let i = startNumber; i <= endNumber; i++) {
            const id = `${prefix}${String(i).padStart(padLength, '0')}`;
            const barcodeBuffer = await new Promise((resolve, reject) => {
                bwipjs.toBuffer({
                    bcid: 'code128', text: id, scale: 3, height: 12,
                    includetext: true, textxalign: 'center',
                    barcolor: barColor.replace('#', '')
                }, (err, png) => err ? reject(err) : resolve(png));
            });
            results.push({ id, image: barcodeBuffer.toString('base64') });
        }
        res.json({ success: true, total: results.length, barcodes: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PRODUCTS ENDPOINT
// ============================================
app.get('/api/products', async (req, res) => {
    const products = [
        { id: 'YIRG001', name: 'Yirgacheffe Coffee', price: 24.99, stock: 500, origin: 'Ethiopia', roast: 'Light' },
        { id: 'SIDM001', name: 'Sidama Coffee', price: 22.99, stock: 350, origin: 'Ethiopia', roast: 'Medium' },
        { id: 'GUJI001', name: 'Guji Coffee', price: 26.99, stock: 200, origin: 'Ethiopia', roast: 'Medium-Dark' }
    ];
    res.json({ success: true, products });
});

// ============================================
// SERVE STATIC FILES
// ============================================
app.use(express.static('public'));

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    }
});

module.exports = app;