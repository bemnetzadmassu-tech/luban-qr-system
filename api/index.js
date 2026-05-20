const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Health check - MUST return JSON
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Generate QR endpoint
app.post('/api/qr/generate', async (req, res) => {
    try {
        const QRCode = require('qrcode');
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

// List QR codes
app.get('/api/qr/list', (req, res) => {
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = process.env.VERCEL ? '/tmp/luban_codes.db' : './luban_codes.db';
    const db = new sqlite3.Database(dbPath);
    
    db.all('SELECT * FROM qr_codes ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            return res.json({ success: true, codes: [] });
        }
        res.json({ success: true, codes: rows || [] });
    });
});

// Update destination
app.put('/api/qr/update/:id', (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = process.env.VERCEL ? '/tmp/luban_codes.db' : './luban_codes.db';
    const db = new sqlite3.Database(dbPath);
    
    db.run('UPDATE qr_codes SET destination_url = ? WHERE id = ?', [destinationUrl, id], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: `Updated ${id}` });
    });
});

// Delete code
app.delete('/api/qr/delete/:id', (req, res) => {
    const { id } = req.params;
    
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = process.env.VERCEL ? '/tmp/luban_codes.db' : './luban_codes.db';
    const db = new sqlite3.Database(dbPath);
    
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
    
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = process.env.VERCEL ? '/tmp/luban_codes.db' : './luban_codes.db';
    const db = new sqlite3.Database(dbPath);
    
    db.get('SELECT destination_url FROM qr_codes WHERE id = ?', [id], (err, row) => {
        if (err || !row || !row.destination_url) {
            return res.status(404).send(`Code "${id}" not found`);
        }
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
