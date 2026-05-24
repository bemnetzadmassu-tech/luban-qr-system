const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const db = require('../database');
const { validateAdminPassword } = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================
// SMART SCHEMA DETECTION
// ============================================
let schemaCache = null;

async function detectSchema() {
    if (schemaCache) return schemaCache;
    
    console.log('🔍 Auto-detecting database schema...');
    
    const schema = {
        qrTable: null,
        idColumn: 'id',
        urlColumn: null,
        scanColumn: null,
        pageTypeColumn: null,
        productNameColumn: null,
        productPriceColumn: null,
        productDescColumn: null,
        dateColumn: null
    };
    
    try {
        const tables = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('qr_codes', 'codes', 'qrcodes')
            ORDER BY table_name
        `);
        
        for (const table of tables.rows) {
            const tableName = table.table_name;
            const columns = await db.query(`
                SELECT column_name FROM information_schema.columns WHERE table_name = $1
            `, [tableName]);
            
            const columnNames = columns.rows.map(c => c.column_name);
            
            let urlCol = columnNames.find(c => c.includes('destination') || c.includes('url') || c === 'qr_destination');
            let scanCol = columnNames.find(c => c.includes('scan_count') || c.includes('scans') || c === 'qr_scan_count');
            
            if (urlCol || scanCol) {
                schema.qrTable = tableName;
                schema.urlColumn = urlCol || 'destination_url';
                schema.scanColumn = scanCol || 'scan_count';
                schema.pageTypeColumn = columnNames.find(c => c === 'page_type') || null;
                schema.productNameColumn = columnNames.find(c => c === 'product_name') || null;
                schema.productPriceColumn = columnNames.find(c => c === 'product_price') || null;
                schema.productDescColumn = columnNames.find(c => c === 'product_description') || null;
                schema.dateColumn = columnNames.find(c => c.includes('created_at')) || 'created_at';
                console.log(`✅ Detected table: ${tableName}`);
                break;
            }
        }
        
        if (!schema.qrTable) {
            await db.query(`
                CREATE TABLE IF NOT EXISTS qr_codes (
                    id TEXT PRIMARY KEY,
                    destination_url TEXT,
                    scan_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    page_type TEXT DEFAULT 'redirect',
                    product_name TEXT,
                    product_price DECIMAL(10,2),
                    product_description TEXT
                )
            `);
            schema.qrTable = 'qr_codes';
            schema.urlColumn = 'destination_url';
            schema.scanColumn = 'scan_count';
            schema.pageTypeColumn = 'page_type';
            schema.productNameColumn = 'product_name';
            schema.productPriceColumn = 'product_price';
            schema.productDescColumn = 'product_description';
            schema.dateColumn = 'created_at';
        }
        
        schemaCache = schema;
        return schema;
    } catch (error) {
        console.error('Schema detection error:', error);
        schema.qrTable = 'qr_codes';
        schema.urlColumn = 'destination_url';
        schema.scanColumn = 'scan_count';
        return schema;
    }
}

async function smartQuery(sql, params = []) {
    try {
        return await db.query(sql, params);
    } catch (error) {
        console.error('Query error:', error.message);
        throw error;
    }
}

// ============================================
// HEALTH & AUTH
// ============================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (validateAdminPassword(password)) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// ============================================
// QR CODE ENDPOINTS
// ============================================
app.get('/api/qr/list', async (req, res) => {
    try {
        let allCodes = [];
        const pool = db.pool;
        if (!pool) return res.json({ success: true, codes: [] });
        
        const tablesResult = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('qr_codes', 'codes')
        `);
        
        for (const table of tablesResult.rows) {
            const tableName = table.table_name;
            const columnsResult = await pool.query(`
                SELECT column_name FROM information_schema.columns WHERE table_name = $1
            `, [tableName]);
            const columns = columnsResult.rows.map(c => c.column_name);
            
            let idCol = columns.includes('id') ? 'id' : columns[0];
            let urlCol = columns.find(c => c.includes('destination') || c.includes('url')) || 'destination_url';
            let scanCol = columns.find(c => c.includes('scan_count')) || 'scan_count';
            let dateCol = columns.find(c => c.includes('created_at')) || 'created_at';
            
            const result = await pool.query(`
                SELECT ${idCol} as id, ${urlCol} as destination_url, ${scanCol} as scan_count, ${dateCol} as created_at
                FROM ${tableName} ORDER BY ${dateCol} DESC
            `);
            for (const code of result.rows) {
                if (!allCodes.find(c => c.id === code.id)) allCodes.push(code);
            }
        }
        
        allCodes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        res.json({ success: true, codes: allCodes });
    } catch (error) {
        console.error('List error:', error);
        res.json({ success: true, codes: [] });
    }
});

app.post('/api/qr/create', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });
    try {
        const schema = await detectSchema();
        await smartQuery(`INSERT INTO ${schema.qrTable} (${schema.idColumn}) VALUES ($1) ON CONFLICT (${schema.idColumn}) DO NOTHING`, [id]);
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

app.put('/api/qr/update/:id', async (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    try {
        const schema = await detectSchema();
        await smartQuery(`UPDATE ${schema.qrTable} SET ${schema.urlColumn} = $1 WHERE ${schema.idColumn} = $2`, [destinationUrl, id]);
        res.json({ success: true, message: `Updated ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/qr/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const schema = await detectSchema();
        await smartQuery(`DELETE FROM ${schema.qrTable} WHERE ${schema.idColumn} = $1`, [id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/qr/update-product/:id', async (req, res) => {
    const { id } = req.params;
    const { productName, productPrice, productDescription } = req.body;
    try {
        const schema = await detectSchema();
        await smartQuery(`
            UPDATE ${schema.qrTable} 
            SET page_type = 'product', product_name = $1, product_price = $2, product_description = $3, ${schema.urlColumn} = NULL
            WHERE ${schema.idColumn} = $4
        `, [productName, productPrice, productDescription, id]);
        res.json({ success: true, message: `Product page saved for ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/qr/product/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const schema = await detectSchema();
        const result = await smartQuery(`
            SELECT page_type, product_name, product_price, product_description, ${schema.urlColumn} as destination_url
            FROM ${schema.qrTable} WHERE ${schema.idColumn} = $1
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
        const schema = await detectSchema();
        const result = await smartQuery(`
            SELECT ${schema.urlColumn} as destination_url, page_type, product_name, product_price, product_description
            FROM ${schema.qrTable} WHERE ${schema.idColumn} = $1
        `, [id]);
        
        if (result.rows.length === 0) return res.status(404).send('QR code not found');
        
        const qrData = result.rows[0];
        await smartQuery(`UPDATE ${schema.qrTable} SET ${schema.scanColumn} = ${schema.scanColumn} + 1 WHERE ${schema.idColumn} = $1`, [id]);
        
        if (qrData.page_type === 'product' && qrData.product_name) {
            return res.redirect(`/landing.html?id=${id}&name=${encodeURIComponent(qrData.product_name)}&price=${qrData.product_price}&desc=${encodeURIComponent(qrData.product_description || '')}`);
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

// ============================================
// PRODUCTS & STATS
// ============================================
app.get('/api/products', async (req, res) => {
    const products = [
        { id: 'YIRG001', name: 'Yirgacheffe Coffee', price: 24.99, stock: 500, origin: 'Ethiopia', roast: 'Light' },
        { id: 'SIDM001', name: 'Sidama Coffee', price: 22.99, stock: 350, origin: 'Ethiopia', roast: 'Medium' },
        { id: 'GUJI001', name: 'Guji Coffee', price: 26.99, stock: 200, origin: 'Ethiopia', roast: 'Medium-Dark' }
    ];
    res.json({ success: true, products });
});

app.get('/api/stats', async (req, res) => {
    try {
        const result = await db.query(`SELECT COUNT(*) as total, COALESCE(SUM(scan_count), 0) as scans FROM qr_codes`);
        res.json({ success: true, stats: result.rows[0] || { total: 0, scans: 0 } });
    } catch (error) {
        res.json({ success: true, stats: { total: 0, scans: 0 } });
    }
});

// ============================================
// DEBUG ENDPOINTS
// ============================================
app.get('/api/diagnose', async (req, res) => {
    try {
        const pool = db.pool;
        if (!pool) return res.json({ error: 'No database pool' });
        const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
        const result = {};
        for (const table of tables.rows) {
            const tableName = table.table_name;
            const count = await pool.query(`SELECT COUNT(*) FROM ${tableName}`);
            result[tableName] = { count: parseInt(count.rows[0].count) };
        }
        res.json({ success: true, tables: result });
    } catch (error) {
        res.json({ error: error.message });
    }
});

app.get('/api/debug/schema', async (req, res) => {
    const schema = await detectSchema();
    res.json({ success: true, schema, message: `Using table: ${schema.qrTable}` });
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

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;