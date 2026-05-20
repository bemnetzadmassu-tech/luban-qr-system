const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

// Database for Vercel (uses /tmp)
const db = new sqlite3.Database('/tmp/luban_codes.db');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS codes (
            id TEXT PRIMARY KEY,
            product_name TEXT,
            product_type TEXT,
            price DECIMAL(10,2),
            qr_destination TEXT,
            qr_scan_count INTEGER DEFAULT 0,
            barcode_scan_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

function generateUniqueId() {
    return 'COF' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/codes/create', async (req, res) => {
    try {
        const { id, productName, productType, price, qrDestination } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }
        
        db.get('SELECT * FROM codes WHERE id = ?', [id], async (err, row) => {
            if (row) {
                return res.status(400).json({ error: 'ID already exists' });
            }
            
            db.run(
                `INSERT INTO codes (id, product_name, product_type, price, qr_destination) VALUES (?, ?, ?, ?, ?)`,
                [id, productName, productType, price, qrDestination],
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true, id: id });
                }
            );
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/generate/qr', async (req, res) => {
    try {
        const { id, qrDarkColor = '#4A2C1A', qrLightColor = '#F5E6D3' } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }
        
        const qrBuffer = await QRCode.toBuffer(id, {
            type: 'png',
            width: 500,
            margin: 2,
            color: { dark: qrDarkColor, light: qrLightColor },
            errorCorrectionLevel: 'H'
        });
        
        const qrBase64 = qrBuffer.toString('base64');
        
        res.json({
            success: true,
            id: id,
            image: `data:image/png;base64,${qrBase64}`,
            qrContent: id
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/generate/barcode', async (req, res) => {
    try {
        const { id, barcodeType = 'code128', barColor = '#000000' } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }
        
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
        
        res.json({
            success: true,
            id: id,
            image: `data:image/png;base64,${barcodeBase64}`,
            value: id
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/r/:id', (req, res) => {
    const { id } = req.params;
    
    db.get('SELECT * FROM codes WHERE id = ?', [id], (err, row) => {
        if (err || !row || !row.qr_destination) {
            return res.status(404).send(`Code "${id}" not found`);
        }
        
        db.run('UPDATE codes SET qr_scan_count = qr_scan_count + 1 WHERE id = ?', [id]);
        res.redirect(row.qr_destination);
    });
});

app.get('/api/codes/list', (req, res) => {
    db.all('SELECT * FROM codes ORDER BY created_at DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, codes: rows });
    });
});

app.put('/api/codes/update/:id', (req, res) => {
    const { id } = req.params;
    const { qrDestination } = req.body;
    
    db.run('UPDATE codes SET qr_destination = ? WHERE id = ?', [qrDestination, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: `Updated ${id}` });
    });
});

app.delete('/api/codes/delete/:id', (req, res) => {
    const { id } = req.params;
    
    db.run('DELETE FROM codes WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/stats', (req, res) => {
    db.get(`SELECT COUNT(*) as total_codes, SUM(qr_scan_count) as total_qr_scans FROM codes`, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, stats: row });
    });
});

module.exports = app;
