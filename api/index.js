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
// SMART SCHEMA DETECTION - Runs once
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
        // Get all tables
        const tables = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('qr_codes', 'codes', 'qrcodes', 'qr_code')
            ORDER BY table_name
        `);
        
        for (const table of tables.rows) {
            const tableName = table.table_name;
            
            // Get columns for this table
            const columns = await db.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [tableName]);
            
            const columnNames = columns.rows.map(c => c.column_name);
            
            // Detect URL column
            let urlCol = columnNames.find(c => 
                c.includes('destination') || 
                c.includes('url') || 
                c === 'qr_destination'
            );
            
            // Detect scan count column
            let scanCol = columnNames.find(c => 
                c.includes('scan_count') || 
                c.includes('scans') || 
                c === 'qr_scan_count'
            );
            
            // Detect page type column
            let pageTypeCol = columnNames.find(c => 
                c === 'page_type' || 
                c.includes('type')
            );
            
            // Detect product columns
            let productNameCol = columnNames.find(c => 
                c === 'product_name' || 
                c === 'name'
            );
            let productPriceCol = columnNames.find(c => 
                c === 'product_price' || 
                c === 'price'
            );
            let productDescCol = columnNames.find(c => 
                c === 'product_description' || 
                c === 'description'
            );
            
            // Detect date column
            let dateCol = columnNames.find(c => 
                c.includes('created_at') || 
                c.includes('date')
            );
            
            if (urlCol || scanCol) {
                schema.qrTable = tableName;
                schema.urlColumn = urlCol || 'destination_url';
                schema.scanColumn = scanCol || 'scan_count';
                schema.pageTypeColumn = pageTypeCol || null;
                schema.productNameColumn = productNameCol || null;
                schema.productPriceColumn = productPriceCol || null;
                schema.productDescColumn = productDescCol || null;
                schema.dateColumn = dateCol || 'created_at';
                schema.columns = columnNames;
                
                console.log(`✅ Detected table: ${tableName}`);
                console.log(`   URL column: ${schema.urlColumn}`);
                console.log(`   Scan column: ${schema.scanColumn}`);
                break;
            }
        }
        
        // If no table found, create one
        if (!schema.qrTable) {
            console.log('📦 No QR table found, creating one...');
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
        // Fallback defaults
        schema.qrTable = 'qr_codes';
        schema.urlColumn = 'destination_url';
        schema.scanColumn = 'scan_count';
        return schema;
    }
}

// ============================================
// SMART QUERY BUILDER
// ============================================
async function smartQuery(sql, params = []) {
    try {
        return await db.query(sql, params);
    } catch (error) {
        console.error('Query error:', error.message);
        throw error;
    }
}

// ============================================
// AUTO-DETECT ENDPOINTS
// ============================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Authentication
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (validateAdminPassword(password)) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// SMART LIST - Auto-detects schema
// ============================================
// QR CODE LIST - FIXED for your database.js structure
// ============================================
// ============================================
// SMART LIST - Auto-detects schema (FIXED for your db)
// ============================================
app.get('/api/qr/list', async (req, res) => {
    try {
        console.log('🔍 Auto-detecting database schema...');
        
        let allCodes = [];
        
        // Get pool from your db export
        const pool = db.pool;
        
        if (!pool) {
            console.error('No database pool found');
            return res.json({ success: true, codes: [] });
        }
        
        // Find all tables that might contain QR codes
        const tablesResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('qr_codes', 'codes', 'qrcodes', 'qr_code')
        `);
        
        for (const table of tablesResult.rows) {
            const tableName = table.table_name;
            console.log(`📋 Checking table: ${tableName}`);
            
            // Get columns for this table
            const columnsResult = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = $1
            `, [tableName]);
            
            const columns = columnsResult.rows.map(c => c.column_name);
            
            // Detect column names
            let idCol = columns.includes('id') ? 'id' : columns[0];
            let urlCol = columns.find(c => c.includes('destination') || c.includes('url') || c === 'qr_destination') || 'destination_url';
            let scanCol = columns.find(c => c.includes('scan_count') || c.includes('scans') || c === 'qr_scan_count') || 'scan_count';
            let dateCol = columns.find(c => c.includes('created_at') || c.includes('date')) || 'created_at';
            
            // Build query
            const query = `
                SELECT 
                    ${idCol} as id,
                    ${urlCol} as destination_url,
                    ${scanCol} as scan_count,
                    ${dateCol} as created_at
                FROM ${tableName}
                ORDER BY ${dateCol} DESC
            `;
            
            const result = await pool.query(query);
            console.log(`   Found ${result.rows.length} codes in ${tableName}`);
            
            // Add to collection (avoid duplicates)
            for (const code of result.rows) {
                if (!allCodes.find(c => c.id === code.id)) {
                    allCodes.push(code);
                }
            }
        }
        
        // Sort by created_at
        allCodes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        console.log(`✅ Total unique codes: ${allCodes.length}`);
        res.json({ success: true, codes: allCodes });
        
    } catch (error) {
        console.error('Auto-detect error:', error);
        res.json({ success: true, codes: [] });
    }
});
// ============================================
// DIAGNOSE - See what tables and columns exist
// ============================================
app.get('/api/diagnose', async (req, res) => {
    try {
        const pool = db.pool;
        if (!pool) {
            return res.json({ error: 'No database pool' });
        }
        
        // Get all tables
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        const result = {};
        
        for (const table of tables.rows) {
            const tableName = table.table_name;
            
            // Get columns
            const columns = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [tableName]);
            
            // Get count
            const count = await pool.query(`SELECT COUNT(*) FROM ${tableName}`);
            
            // Get sample
            const sample = await pool.query(`SELECT * FROM ${tableName} LIMIT 2`);
            
            result[tableName] = {
                columns: columns.rows,
                count: parseInt(count.rows[0].count),
                sample: sample.rows
            };
        }
        
        res.json({ success: true, tables: result });
    } catch (error) {
        res.json({ error: error.message });
    }
});
// SMART CREATE - Auto-adapts to schema
app.post('/api/qr/create', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });
    
    try {
        const schema = await detectSchema();
        const table = schema.qrTable;
        
        // Build insert query dynamically
        const columns = [schema.idColumn];
        const values = [id];
        const placeholders = ['$1'];
        
        if (schema.scanColumn) {
            columns.push(schema.scanColumn);
            values.push(0);
            placeholders.push('$2');
        }
        
        if (schema.pageTypeColumn) {
            columns.push(schema.pageTypeColumn);
            values.push('redirect');
            placeholders.push(`$${values.length}`);
        }
        
        const query = `
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${placeholders.join(', ')})
            ON CONFLICT (${schema.idColumn}) DO NOTHING
        `;
        
        await smartQuery(query, values);
        console.log(`✅ Created: ${id} in ${table}`);
        res.json({ success: true, id });
    } catch (error) {
        console.error('Create error:', error);
        res.status(500).json({ error: error.message });
    }
});

// SMART UPDATE - Auto-detects column names
app.put('/api/qr/update/:id', async (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    
    try {
        const schema = await detectSchema();
        const table = schema.qrTable;
        
        // Try to update with detected column name
        const query = `
            UPDATE ${table} 
            SET ${schema.urlColumn} = $1 
            WHERE ${schema.idColumn} = $2
            RETURNING ${schema.idColumn}
        `;
        
        const result = await smartQuery(query, [destinationUrl, id]);
        
        if (result.rowCount === 0) {
            // Create if doesn't exist
            await smartQuery(`
                INSERT INTO ${table} (${schema.idColumn}, ${schema.urlColumn})
                VALUES ($1, $2)
                ON CONFLICT (${schema.idColumn}) 
                DO UPDATE SET ${schema.urlColumn} = $2
            `, [id, destinationUrl]);
        }
        
        console.log(`✅ Updated: ${id} -> ${destinationUrl}`);
        res.json({ success: true, message: `Updated ${id}` });
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ error: error.message });
    }
});

// SMART DELETE
app.delete('/api/qr/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const schema = await detectSchema();
        await smartQuery(`DELETE FROM ${schema.qrTable} WHERE ${schema.idColumn} = $1`, [id]);
        console.log(`✅ Deleted: ${id}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

// SMART PRODUCT UPDATE
app.put('/api/qr/update-product/:id', async (req, res) => {
    const { id } = req.params;
    const { productName, productPrice, productDescription } = req.body;
    
    try {
        const schema = await detectSchema();
        const table = schema.qrTable;
        
        const updates = [];
        const values = [];
        let paramCount = 1;
        
        if (schema.pageTypeColumn) {
            updates.push(`${schema.pageTypeColumn} = $${paramCount++}`);
            values.push('product');
        }
        if (schema.productNameColumn && productName) {
            updates.push(`${schema.productNameColumn} = $${paramCount++}`);
            values.push(productName);
        }
        if (schema.productPriceColumn && productPrice) {
            updates.push(`${schema.productPriceColumn} = $${paramCount++}`);
            values.push(productPrice);
        }
        if (schema.productDescColumn && productDescription) {
            updates.push(`${schema.productDescColumn} = $${paramCount++}`);
            values.push(productDescription);
        }
        if (schema.urlColumn) {
            updates.push(`${schema.urlColumn} = $${paramCount++}`);
            values.push(null);
        }
        
        values.push(id);
        
        const query = `
            UPDATE ${table} 
            SET ${updates.join(', ')}
            WHERE ${schema.idColumn} = $${paramCount}
        `;
        
        await smartQuery(query, values);
        console.log(`✅ Product page saved: ${id}`);
        res.json({ success: true, message: `Product page saved for ${id}` });
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ error: error.message });
    }
});

// SMART GET PRODUCT
app.get('/api/qr/product/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const schema = await detectSchema();
        const table = schema.qrTable;
        
        const selectFields = [];
        if (schema.pageTypeColumn) selectFields.push(schema.pageTypeColumn);
        if (schema.productNameColumn) selectFields.push(schema.productNameColumn);
        if (schema.productPriceColumn) selectFields.push(schema.productPriceColumn);
        if (schema.productDescColumn) selectFields.push(schema.productDescColumn);
        if (schema.urlColumn) selectFields.push(`${schema.urlColumn} as destination_url`);
        
        const query = `
            SELECT ${selectFields.join(', ')}
            FROM ${table}
            WHERE ${schema.idColumn} = $1
        `;
        
        const result = await smartQuery(query, [id]);
        res.json({ success: true, product: result.rows[0] || {} });
    } catch (error) {
        console.error('Get product error:', error);
        res.json({ success: true, product: {} });
    }
});

// SMART REDIRECT
app.get('/api/r/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const schema = await detectSchema();
        const table = schema.qrTable;
        
        const result = await smartQuery(`
            SELECT ${schema.urlColumn} as destination_url, 
                   ${schema.pageTypeColumn || 'NULL'} as page_type,
                   ${schema.productNameColumn || 'NULL'} as product_name,
                   ${schema.productPriceColumn || 'NULL'} as product_price,
                   ${schema.productDescColumn || 'NULL'} as product_description
            FROM ${table}
            WHERE ${schema.idColumn} = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).send('QR code not found');
        }
        
        const qrData = result.rows[0];
        
        // Increment scan count
        if (schema.scanColumn) {
            await smartQuery(`
                UPDATE ${table} 
                SET ${schema.scanColumn} = ${schema.scanColumn} + 1 
                WHERE ${schema.idColumn} = $1
            `, [id]);
        }
        
        if (qrData.page_type === 'product' && qrData.product_name) {
            const productPage = `/landing.html?id=${id}&name=${encodeURIComponent(qrData.product_name)}&price=${qrData.product_price}&desc=${encodeURIComponent(qrData.product_description || '')}`;
            return res.redirect(productPage);
        }
        
        res.redirect(qrData.destination_url || '/');
    } catch (error) {
        console.error('Redirect error:', error);
        res.redirect('/');
    }
});

// ============================================
// STATISTICS - Auto-detects schema and reads from all tables
// ============================================
app.get('/api/stats', async (req, res) => {
    try {
        let totalCodes = 0;
        let totalScans = 0;
        
        // Try to get from all possible QR tables
        const possibleTables = ['qr_codes', 'codes', 'qrcodes'];
        
        for (const tableName of possibleTables) {
            try {
                // Check if table exists
                const tableCheck = await db.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_name = $1
                    )
                `, [tableName]);
                
                if (tableCheck.rows[0].exists) {
                    // Get column names for this table
                    const columns = await db.query(`
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_name = $1
                    `, [tableName]);
                    
                    const colNames = columns.rows.map(c => c.column_name);
                    
                    // Find scan count column
                    let scanCol = colNames.find(c => 
                        c.includes('scan_count') || 
                        c.includes('scans') || 
                        c === 'qr_scan_count'
                    ) || 'scan_count';
                    
                    // Query the table
                    const result = await db.query(`
                        SELECT 
                            COUNT(*) as total,
                            COALESCE(SUM(${scanCol}), 0) as scans
                        FROM ${tableName}
                    `);
                    
                    totalCodes += parseInt(result.rows[0]?.total || 0);
                    totalScans += parseInt(result.rows[0]?.scans || 0);
                    
                    console.log(`📊 ${tableName}: ${result.rows[0]?.total} codes, ${result.rows[0]?.scans} scans`);
                }
            } catch (err) {
                console.log(`Error reading ${tableName}:`, err.message);
            }
        }
        
        res.json({ 
            success: true, 
            stats: { 
                total: totalCodes, 
                scans: totalScans 
            } 
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.json({ success: true, stats: { total: 0, scans: 0 } });
    }
});
// ============================================
// DEBUG - Check what tables and data exist
// ============================================
app.get('/api/debug/database', async (req, res) => {
    try {
        const debug = {};
        
        // Check all possible tables
        const tables = ['qr_codes', 'codes', 'qrcodes', 'products', 'inventory'];
        
        for (const tableName of tables) {
            try {
                const exists = await db.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_name = $1
                    )
                `, [tableName]);
                
                if (exists.rows[0].exists) {
                    const count = await db.query(`SELECT COUNT(*) FROM ${tableName}`);
                    const sample = await db.query(`SELECT * FROM ${tableName} LIMIT 3`);
                    
                    debug[tableName] = {
                        exists: true,
                        count: parseInt(count.rows[0].count),
                        sample: sample.rows,
                        columns: sample.rows.length > 0 ? Object.keys(sample.rows[0]) : []
                    };
                } else {
                    debug[tableName] = { exists: false };
                }
            } catch (err) {
                debug[tableName] = { exists: false, error: err.message };
            }
        }
        
        res.json({ success: true, debug });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Products endpoint
app.get('/api/products', async (req, res) => {
    const products = [
        { id: 'YIRG001', name: 'Yirgacheffe Coffee', price: 24.99, stock: 500, origin: 'Ethiopia', roast: 'Light' },
        { id: 'SIDM001', name: 'Sidama Coffee', price: 22.99, stock: 350, origin: 'Ethiopia', roast: 'Medium' },
        { id: 'GUJI001', name: 'Guji Coffee', price: 26.99, stock: 200, origin: 'Ethiopia', roast: 'Medium-Dark' }
    ];
    res.json({ success: true, products });
});

// Barcode endpoints (keep existing)
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
// Debug endpoint - shows what schema was detected
app.get('/api/debug/schema', async (req, res) => {
    const schema = await detectSchema();
    res.json({ 
        success: true, 
        schema: schema,
        message: `Using table: ${schema.qrTable}` 
    });
});
// Serve static files
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