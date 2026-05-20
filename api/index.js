const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

// Database setup (uses /tmp on Vercel)
const dbPath = process.env.VERCEL ? '/tmp/luban_codes.db' : './luban_codes.db';
const db = new sqlite3.Database(dbPath);

// Initialize database
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS qr_codes (
            id TEXT PRIMARY KEY,
            destination_url TEXT,
            scan_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Database initialized');
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Generate QR Code
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
        
        // Save to database if not exists
        db.run(
            'INSERT OR IGNORE INTO qr_codes (id) VALUES (?)',
            [content]
        );
        
        res.json({
            success: true,
            image: `data:image/png;base64,${qrBase64}`,
            content: content,
            message: `QR code generated for ${content}. You can now set its destination.`
        });
        
    } catch (error) {
        console.error('QR error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Set destination for a QR code
app.post('/api/qr/set-destination/:id', (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    
    if (!destinationUrl) {
        return res.status(400).json({ error: 'Destination URL is required' });
    }
    
    db.run(
        'UPDATE qr_codes SET destination_url = ? WHERE id = ?',
        [destinationUrl, id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({
                success: true,
                message: `QR code ${id} will now redirect to ${destinationUrl}`
            });
        }
    );
});

// Get destination for a QR code
app.get('/api/qr/get-destination/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT destination_url FROM qr_codes WHERE id = ?', [id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({
            success: true,
            id: id,
            destinationUrl: row?.destination_url || null
        });
    });
});

// List all QR codes
app.get('/api/qr/list', (req, res) => {
    db.all('SELECT * FROM qr_codes ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, codes: rows });
    });
});

// Update destination
app.put('/api/qr/update/:id', (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    
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

// REDIRECT ENDPOINT - This is what the QR code calls!
app.get('/api/r/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT destination_url, scan_count FROM qr_codes WHERE id = ?', [id], (err, row) => {
        if (err || !row) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head><title>QR Code Not Found</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>❌ QR Code Not Found</h1>
                    <p>The code "${id}" has not been configured yet.</p>
                </body>
                </html>
            `);
        }
        
        if (!row.destination_url) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head><title>No Destination Set</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>⚠️ No Destination Set</h1>
                    <p>QR code "${id}" has not been assigned a destination yet.</p>
                </body>
                </html>
            `);
        }
        
        // Increment scan count
        db.run('UPDATE qr_codes SET scan_count = scan_count + 1 WHERE id = ?', [id]);
        
        console.log(`📱 QR SCAN: ${id} → ${row.destination_url}`);
        
        // Redirect to destination
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
