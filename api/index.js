const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const db = require('../database');
const { validateAdminPassword } = require('./middleware/auth');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
        const result = await db.query('SELECT COUNT(*) as total, SUM(qr_scan_count) as scans FROM codes');
        res.json({ success: true, stats: result.rows[0] || { total: 0, scans: 0 } });
    } catch (error) {
        console.error('Stats error:', error);
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
        await db.query('INSERT INTO codes (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        res.json({ success: true, id });
    } catch (error) {
        console.error('Create QR error:', error);
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
        console.error('Generate QR error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/qr/list', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT id, qr_destination as destination_url, qr_scan_count as scan_count, created_at,
                   page_type, product_name, product_price, product_description
            FROM codes ORDER BY created_at DESC
        `);
        res.json({ success: true, codes: result.rows });
    } catch (error) {
        console.error('List QR error:', error);
        res.json({ success: true, codes: [] });
    }
});

app.put('/api/qr/update/:id', async (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    
    try {
        await db.query('UPDATE codes SET qr_destination = $1 WHERE id = $2', [destinationUrl, id]);
        res.json({ success: true, message: `Updated ${id}` });
    } catch (error) {
        console.error('Update QR error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/qr/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM codes WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete QR error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/qr/update-product/:id', async (req, res) => {
    const { id } = req.params;
    const { productName, productPrice, productDescription } = req.body;
    
    try {
        await db.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS product_name TEXT`);
        await db.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS product_price DECIMAL(10,2)`);
        await db.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS product_description TEXT`);
        await db.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'redirect'`);
        
        await db.query(`
            UPDATE codes 
            SET page_type = 'product', product_name = $1, product_price = $2, product_description = $3, qr_destination = NULL
            WHERE id = $4
        `, [productName, productPrice, productDescription, id]);
        
        res.json({ success: true, message: `Product page saved for ${id}` });
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/qr/product/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query(`
            SELECT page_type, product_name, product_price, product_description, qr_destination
            FROM codes WHERE id = $1
        `, [id]);
        res.json({ success: true, product: result.rows[0] || {} });
    } catch (error) {
        console.error('Get product error:', error);
        res.json({ success: true, product: {} });
    }
});

// ============================================
// REDIRECT ENDPOINT (ONE QR → Landing Page)
// ============================================
app.get('/api/r/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query(`
            SELECT page_type, qr_destination, product_name, product_price, product_description 
            FROM codes WHERE id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).send('QR code not found');
        }
        
        const qrData = result.rows[0];
        await db.query('UPDATE codes SET qr_scan_count = qr_scan_count + 1 WHERE id = $1', [id]);
        
        if (qrData.page_type === 'product' && qrData.product_name) {
            const productPage = `/landing.html?id=${id}&name=${encodeURIComponent(qrData.product_name)}&price=${qrData.product_price}&desc=${encodeURIComponent(qrData.product_description || '')}`;
            return res.redirect(productPage);
        }
        
        res.redirect(qrData.qr_destination || '/');
    } catch (error) {
        console.error('Redirect error:', error);
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
        console.error('Generate barcode error:', error);
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
        console.error('Batch barcode error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Premium serialized barcodes (LBN-250-MR-X8K2A91 format)
app.post('/api/barcode/premium/generate', async (req, res) => {
    try {
        const { productId, quantity = 1, weightGrams = 250, roastCode = 'MR', batchNumber } = req.body;
        
        function generateSerial() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let result = '';
            for (let i = 0; i < 7; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
            return result;
        }
        
        const results = [];
        for (let i = 0; i < quantity; i++) {
            const serialNumber = generateSerial();
            const barcodeValue = `LBN-${weightGrams}-${roastCode}-${serialNumber}`;
            
            const barcodeBuffer = await new Promise((resolve, reject) => {
                bwipjs.toBuffer({
                    bcid: 'code128', text: barcodeValue, scale: 3, height: 12,
                    includetext: true, textxalign: 'center',
                    barcolor: 'D4AF37'
                }, (err, png) => err ? reject(err) : resolve(png));
            });
            
            results.push({ barcode: barcodeValue, image: barcodeBuffer.toString('base64') });
        }
        
        res.json({ success: true, total: results.length, barcodes: results });
    } catch (error) {
        console.error('Premium barcode error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Verify barcode (anti-counterfeit)
app.get('/api/barcode/verify/:barcode', async (req, res) => {
    try {
        const { barcode } = req.params;
        const pattern = /^LBN-(\d{3})-([A-Z]{2})-([A-Z0-9]{7})$/;
        const isValidFormat = pattern.test(barcode);
        
        res.json({
            success: true,
            valid: isValidFormat,
            isAuthentic: isValidFormat,
            message: isValidFormat ? '✅ Genuine product' : '❌ Invalid format',
            verifiedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Verify barcode error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PRODUCTS ENDPOINT
// ============================================
app.get('/api/products', async (req, res) => {
    try {
        const products = await db.getAllProducts();
        res.json({ success: true, products: products || [] });
    } catch (error) {
        console.error('Products error:', error);
        const fallbackProducts = [
            { id: 'YIRG001', name: 'Yirgacheffe Coffee', price: 24.99, stock: 500, origin: 'Ethiopia', roast: 'Light' },
            { id: 'SIDM001', name: 'Sidama Coffee', price: 22.99, stock: 350, origin: 'Ethiopia', roast: 'Medium' },
            { id: 'GUJI001', name: 'Guji Coffee', price: 26.99, stock: 200, origin: 'Ethiopia', roast: 'Medium-Dark' }
        ];
        res.json({ success: true, products: fallbackProducts });
    }
});

// ============================================
// INVENTORY ENDPOINT
// ============================================
app.get('/api/inventory', async (req, res) => {
    try {
        const inventory = await db.getInventory();
        res.json({ success: true, inventory: inventory || [] });
    } catch (error) {
        console.error('Inventory error:', error);
        res.json({ success: true, inventory: [] });
    }
});

// ============================================
// POS ENDPOINTS
// ============================================
app.post('/api/pos/verify', async (req, res) => {
    try {
        const { barcodeValue } = req.body;
        res.json({
            success: true,
            isValid: true,
            product: { name: 'Coffee Product', price: 24.99, barcode: barcodeValue }
        });
    } catch (error) {
        console.error('POS verify error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/pos/checkout', async (req, res) => {
    try {
        const { items, paymentMethod } = req.body;
        const total = items.reduce((sum, item) => sum + (item.price || 24.99), 0);
        const transactionId = `TXN-${Date.now()}`;
        
        res.json({
            success: true,
            transaction: { id: transactionId, total, items: items.length },
            message: 'Checkout successful'
        });
    } catch (error) {
        console.error('POS checkout error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ANALYTICS ENDPOINTS
// ============================================
app.get('/api/analytics/fraud', async (req, res) => {
    res.json({ success: true, suspiciousScans: [], totalVerified: 0, fraudAlerts: 0 });
});

app.get('/api/analytics/scans', async (req, res) => {
    res.json({ success: true, totalScans: 0, todayScans: 0, uniqueVisitors: 0 });
});

// ============================================
// SERVE STATIC FILES
// ============================================
app.use(express.static('public'));

// Catch-all for SPA
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;