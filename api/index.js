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
        
        if (!id) {
            return res.status(400).json({ error: 'ID required' });
        }
        
        // Set a timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), 8000);
        });
        
        const barcodePromise = new Promise((resolve, reject) => {
            bwipjs.toBuffer({
                bcid: 'code128',
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
        
        const barcodeBuffer = await Promise.race([barcodePromise, timeoutPromise]);
        
        res.json({ 
            success: true, 
            image: 'data:image/png;base64,' + barcodeBuffer.toString('base64'), 
            id: id 
        });
        
    } catch (error) {
        console.error('Barcode generate error:', error);
        // Return a fallback text-based barcode
        res.json({ 
            success: true, 
            image: null,
            text: id,
            fallback: true,
            message: 'Barcode image generation failed, but text is available'
        });
    }
});
// ============================================
// BARCODE VERIFICATION ENDPOINT
// ============================================
app.get('/api/barcode/verify/:barcode', async (req, res) => {
    const { barcode } = req.params;
    
    try {
        // Validate barcode format
        const pattern = /^LBN-(\d{3})-([A-Z]{2})-([A-Z0-9]{7})$/;
        const isValidFormat = pattern.test(barcode);
        
        if (!isValidFormat) {
            return res.json({
                success: true,
                valid: false,
                isAuthentic: false,
                message: '❌ Invalid barcode format. Please check the code.',
                verifiedAt: new Date().toISOString()
            });
        }
        
        // Check in serialized_barcodes table first
        let result = await db.query(
            'SELECT * FROM serialized_barcodes WHERE barcode_value = $1',
            [barcode]
        );
        
        // If not found, check in qr_codes or codes table
        if (result.rows.length === 0) {
            const qrResult = await db.query(
                'SELECT id, destination_url FROM qr_codes WHERE id = $1',
                [barcode]
            );
            if (qrResult.rows.length > 0) {
                return res.json({
                    success: true,
                    valid: true,
                    isAuthentic: true,
                    message: '✅ QR code found in system',
                    type: 'qr_code',
                    verifiedAt: new Date().toISOString()
                });
            }
            
            return res.json({
                success: true,
                valid: false,
                isAuthentic: false,
                exists: false,
                message: '❌ Barcode not found in our system. This product may be counterfeit.',
                verifiedAt: new Date().toISOString()
            });
        }
        
        const barcodeData = result.rows[0];
        
        // Check if revoked or returned
        if (barcodeData.is_revoked) {
            return res.json({
                success: true,
                valid: false,
                isAuthentic: false,
                status: 'revoked',
                message: '⚠️ This product has been reported and revoked.',
                verifiedAt: new Date().toISOString()
            });
        }
        
        // Prepare response
        const response = {
            success: true,
            valid: true,
            isAuthentic: true,
            barcode: barcode,
            productName: barcodeData.product_name,
            weight: barcodeData.weight_grams,
            roast: barcodeData.roast_level,
            batchNumber: barcodeData.batch_number,
            status: barcodeData.is_sold ? 'sold' : (barcodeData.is_activated ? 'active' : 'pending'),
            verificationCount: barcodeData.verification_count + 1,
            verifiedAt: new Date().toISOString(),
            message: '✅ GENUINE PRODUCT - Verified in Luban Coffee system'
        };
        
        // Add loyalty points message
        if (!barcodeData.is_sold) {
            response.loyaltyPoints = 10;
            response.message += ' | ⭐ +10 loyalty points awarded!';
        }
        
        // Update verification count
        await db.query(
            'UPDATE serialized_barcodes SET verification_count = verification_count + 1, last_verified = CURRENT_TIMESTAMP WHERE barcode_value = $1',
            [barcode]
        );
        
        res.json(response);
        
    } catch (error) {
        console.error('Barcode verification error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Verification service unavailable. Please try again later.',
            message: error.message 
        });
    }
});
// ============================================
// SAVE BARCODE TO DATABASE
// ============================================
app.post('/api/barcode/save', async (req, res) => {
    try {
        const { barcode, weight, roast } = req.body;
        
        // Save barcode as a QR code entry (using existing table)
        await db.query(
            'INSERT INTO qr_codes (id, destination_url, scan_count, product_name) VALUES ($1, $2, 0, $3) ON CONFLICT (id) DO NOTHING',
            [barcode, null, 'Barcode Product - ' + weight + 'g ' + roast]
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Save error:', error.message);
        res.json({ success: true });
    }
});
// ============================================
// POS MACHINE ENDPOINTS - FOR ACTUAL SCANNER
// ============================================

// POS Scan Endpoint - Called when cashier scans barcode
app.post('/api/pos/scan', async (req, res) => {
    const { barcode, posTerminalId, cashierName } = req.body;
    
    try {
        console.log('🔍 POS Scan request:', barcode);
        
        // Check if barcode exists in qr_codes table
        const result = await db.query(
            'SELECT id, product_name, product_price, scan_count FROM qr_codes WHERE id = $1',
            [barcode]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Barcode not found',
                message: 'Product not found in inventory'
            });
        }
        
        const product = result.rows[0];
        
        // Check if already sold (optional - prevent double sale)
        const isSold = product.scan_count > 0; // Simple check
        
        res.json({
            success: true,
            product: {
                barcode: product.id,
                name: product.product_name || 'Luban Coffee Product',
                price: parseFloat(product.product_price) || 24.99,
                isSold: isSold
            },
            message: 'Product found'
        });
        
    } catch (error) {
        console.error('POS scan error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POS Add to Cart / Checkout
app.post('/api/pos/checkout', async (req, res) => {
    const { items, total, paymentMethod, cashierName, posTerminalId } = req.body;
    const transactionId = 'TXN-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    
    try {
        // Create transaction record
        await db.query(`
            CREATE TABLE IF NOT EXISTS pos_transactions (
                id SERIAL PRIMARY KEY,
                transaction_id TEXT UNIQUE,
                items JSONB,
                total_amount DECIMAL(10,2),
                payment_method TEXT,
                cashier_name TEXT,
                pos_terminal_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Save transaction
        await db.query(
            `INSERT INTO pos_transactions (transaction_id, items, total_amount, payment_method, cashier_name, pos_terminal_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [transactionId, JSON.stringify(items), total, paymentMethod, cashierName, posTerminalId]
        );
        
        // Update scan counts for each sold item
        for (var i = 0; i < items.length; i++) {
            await db.query(
                'UPDATE qr_codes SET scan_count = scan_count + 1, last_barcode_scanned = CURRENT_TIMESTAMP WHERE id = $1',
                [items[i].barcode]
            );
        }
        
        res.json({
            success: true,
            transactionId: transactionId,
            message: 'Checkout completed successfully',
            receipt: {
                transactionId: transactionId,
                items: items.length,
                total: total,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get today's sales for POS
app.get('/api/pos/sales/today', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                COUNT(*) as transaction_count,
                COALESCE(SUM(total_amount), 0) as total_sales,
                COUNT(DISTINCT cashier_name) as cashier_count
            FROM pos_transactions 
            WHERE DATE(created_at) = CURRENT_DATE
        `);
        
        res.json({
            success: true,
            sales: result.rows[0] || { transaction_count: 0, total_sales: 0, cashier_count: 0 }
        });
    } catch (error) {
        res.json({ success: true, sales: { transaction_count: 0, total_sales: 0, cashier_count: 0 } });
    }
});
// ============================================
// GET ALL SAVED BARCODES
// ============================================
app.get('/api/barcode/list', async (req, res) => {
    try {
        // Get barcodes from qr_codes (they start with LBN-)
        const result = await db.query(
            'SELECT id as barcode_value, product_name, created_at FROM qr_codes WHERE id LIKE \'LBN-%\' ORDER BY created_at DESC LIMIT 100'
        );
        res.json({ success: true, barcodes: result.rows });
    } catch (error) {
        res.json({ success: true, barcodes: [] });
    }
});
// ============================================
// SIMPLE BARCODE TEST ENDPOINT (no DB required)
// ============================================
app.get('/api/barcode/test/:barcode', (req, res) => {
    const { barcode } = req.params;
    const pattern = /^LBN-(\d{3})-([A-Z]{2})-([A-Z0-9]{7})$/;
    const isValid = pattern.test(barcode);
    
    res.json({
        success: true,
        barcode: barcode,
        isValidFormat: isValid,
        message: isValid ? 'Valid barcode format' : 'Invalid barcode format',
        format: isValid ? {
            prefix: 'LBN',
            weight: barcode.split('-')[1],
            roast: barcode.split('-')[2],
            serial: barcode.split('-')[3]
        } : null
    });
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
// BACKUP ENDPOINT
// ============================================
app.get('/api/admin/backup', async (req, res) => {
    try {
        const tables = ['qr_codes', 'codes', 'products', 'inventory', 'serialized_barcodes'];
        const backup = {};
        
        for (const table of tables) {
            try {
                const result = await db.query(`SELECT * FROM ${table}`);
                backup[table] = result.rows;
            } catch (err) {
                backup[table] = { error: `Table ${table} may not exist` };
            }
        }
        
        res.json({ 
            success: true, 
            backup, 
            timestamp: new Date().toISOString(),
            totalRecords: Object.values(backup).reduce((sum, t) => sum + (t.length || 0), 0)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ============================================
// SERVE STATIC FILES
// ============================================
app.use(express.static('public'));

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '../public/index1.html'));
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;