const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

// Database setup
const dbPath = process.env.VERCEL ? '/tmp/luban_codes.db' : './luban_codes.db';
const db = new sqlite3.Database(dbPath);

// Create table if not exists
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS qr_codes (
            id TEXT PRIMARY KEY,
            destination_url TEXT,
            scan_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Database initialized at:', dbPath);
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// CREATE QR code in database (called before generation)
app.post('/api/qr/create', (req, res) => {
    const { id } = req.body;
    
    console.log('📝 Creating QR code:', id);
    
    if (!id) {
        return res.status(400).json({ error: 'ID is required' });
    }
    
    db.run(
        'INSERT OR IGNORE INTO qr_codes (id) VALUES (?)',
        [id],
        function(err) {
            if (err) {
                console.error('DB error:', err);
                return res.status(500).json({ error: err.message });
            }
            console.log('✅ QR code saved:', id);
            res.json({ success: true, id: id });
        }
    );
});

// Generate QR Code image
app.post('/api/qr/generate', async (req, res) => {
    try {
        const { content, darkColor = '#4A2C1A', lightColor = '#F5E6D3' } = req.body;
        
        console.log('🎨 Generating QR for:', content);
        
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

// List all QR codes
app.get('/api/qr/list', (req, res) => {
    db.all('SELECT * FROM qr_codes ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            console.error('List error:', err);
            return res.json({ success: true, codes: [] });
        }
        console.log('📋 Listing codes, count:', rows?.length || 0);
        res.json({ success: true, codes: rows || [] });
    });
});

// Update destination
app.put('/api/qr/update/:id', (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    
    console.log('✏️ Updating:', id, '→', destinationUrl);
    
    db.run(
        'UPDATE qr_codes SET destination_url = ? WHERE id = ?',
        [destinationUrl, id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, message: `Updated ${id} → ${destinationUrl}` });
        }
    );
});

// Delete QR code
app.delete('/api/qr/delete/:id', (req, res) => {
    const { id } = req.params;
    
    db.run('DELETE FROM qr_codes WHERE id = ?', [id], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: `Deleted ${id}` });
    });
});

// Redirect endpoint
app.get('/api/r/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT destination_url FROM qr_codes WHERE id = ?', [id], (err, row) => {
        if (err || !row || !row.destination_url) {
            return res.status(404).send(`Code "${id}" not found or not configured`);
        }
        
        db.run('UPDATE qr_codes SET scan_count = scan_count + 1 WHERE id = ?', [id]);
        
        console.log(`📱 Redirecting ${id} → ${row.destination_url}`);
        res.redirect(row.destination_url);
    });
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Catch-all for frontend
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    }
});

module.exports = app;

// Generate BARCODE with same ID
app.post('/api/barcode/generate', async (req, res) => {
    try {
        const bwipjs = require('bwip-js');
        const { id, barcodeType = 'code128', barColor = '#000000' } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }
        
        // Generate barcode image
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
        
        // Also save to database (same table, different type)
        db.run(
            'INSERT OR IGNORE INTO qr_codes (id) VALUES (?)',
            [id],
            (err) => {
                if (err) console.error('DB insert error:', err);
            }
        );
        
        res.json({
            success: true,
            image: `data:image/png;base64,${barcodeBase64}`,
            id: id,
            value: id,
            type: barcodeType
        });
        
    } catch (error) {
        console.error('Barcode error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Batch generate barcodes
app.post('/api/barcode/batch', async (req, res) => {
    try {
        const bwipjs = require('bwip-js');
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
            db.run('INSERT OR IGNORE INTO qr_codes (id) VALUES (?)', [id]);
            
            results.push({
                id: id,
                image: `data:image/png;base64,${barcodeBase64}`
            });
        }
        
        res.json({
            success: true,
            total: results.length,
            barcodes: results
        });
        
    } catch (error) {
        console.error('Batch barcode error:', error);
        res.status(500).json({ error: error.message });
    }
});
