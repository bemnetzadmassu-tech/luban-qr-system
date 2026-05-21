const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory storage (temporary, works on Vercel)
let qrCodes = [];

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Generate QR code
app.post('/api/qr/generate', async (req, res) => {
    try {
        const { content, darkColor = '#D4AF37', lightColor = '#FFFFFF', format = 'png' } = req.body;
        
        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }
        
        // Validate hex colors
        const hexPattern = /^#[0-9A-Fa-f]{6}$/;
        if (!hexPattern.test(darkColor)) {
            return res.status(400).json({ error: `Invalid dark color: ${darkColor}. Use hex like #D4AF37` });
        }
        if (!hexPattern.test(lightColor)) {
            return res.status(400).json({ error: `Invalid light color: ${lightColor}. Use hex like #FFFFFF` });
        }
        
        if (format === 'svg') {
            const svgString = await QRCode.toString(content, {
                type: 'svg',
                width: 500,
                margin: 2,
                color: { dark: darkColor, light: lightColor },
                errorCorrectionLevel: 'H'
            });
            
            res.json({
                success: true,
                svgContent: svgString,
                content: content,
                format: 'svg'
            });
        } else {
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
                content: content,
                format: 'png'
            });
        }
        
    } catch (error) {
        console.error('QR error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create QR code entry
app.post('/api/qr/create', (req, res) => {
    const { id } = req.body;
    
    if (!id) {
        return res.status(400).json({ error: 'ID is required' });
    }
    
    if (!qrCodes.find(c => c.id === id)) {
        qrCodes.push({ id: id, destination: null, scans: 0 });
    }
    
    res.json({ success: true, id: id });
});

// List all QR codes
app.get('/api/qr/list', (req, res) => {
    const codes = qrCodes.map(c => ({
        id: c.id,
        destination_url: c.destination,
        scan_count: c.scans || 0,
        created_at: new Date().toISOString()
    }));
    res.json({ success: true, codes: codes });
});

// Update destination
app.put('/api/qr/update/:id', (req, res) => {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    
    const code = qrCodes.find(c => c.id === id);
    if (code) {
        code.destination = destinationUrl;
    } else {
        qrCodes.push({ id: id, destination: destinationUrl, scans: 0 });
    }
    
    res.json({ success: true, message: `Updated ${id} → ${destinationUrl}` });
});

// Delete QR code
app.delete('/api/qr/delete/:id', (req, res) => {
    const { id } = req.params;
    const index = qrCodes.findIndex(c => c.id === id);
    
    if (index !== -1) {
        qrCodes.splice(index, 1);
    }
    
    res.json({ success: true, message: `Deleted ${id}` });
});

// Redirect endpoint
app.get('/api/r/:id', (req, res) => {
    const { id } = req.params;
    const code = qrCodes.find(c => c.id === id);
    
    if (code && code.destination) {
        code.scans = (code.scans || 0) + 1;
        console.log(`📱 QR SCAN: ${id} → ${code.destination}`);
        res.redirect(code.destination);
    } else {
        res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head><title>QR Code Not Found</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1>❌ Code Not Found</h1>
                <p>The code "${id}" has not been configured yet.</p>
                <p>Please check your code or contact support.</p>
            </body>
            </html>
        `);
    }
});

// Generate Barcode
app.post('/api/barcode/generate', async (req, res) => {
    try {
        const { id, barcodeType = 'code128', barColor = '#D4AF37' } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }
        
        // Validate hex color
        const hexPattern = /^#[0-9A-Fa-f]{6}$/;
        const finalColor = hexPattern.test(barColor) ? barColor : '#D4AF37';
        
        const barcodeBuffer = await new Promise((resolve, reject) => {
            bwipjs.toBuffer({
                bcid: barcodeType,
                text: id,
                scale: 3,
                height: 12,
                includetext: true,
                textxalign: 'center',
                barcolor: finalColor.replace('#', '')
            }, (err, png) => {
                if (err) reject(err);
                else resolve(png);
            });
        });
        
        const barcodeBase64 = barcodeBuffer.toString('base64');
        
        // Save to database if not exists
        if (!qrCodes.find(c => c.id === id)) {
            qrCodes.push({ id: id, destination: null, scans: 0 });
        }
        
        res.json({
            success: true,
            image: `data:image/png;base64,${barcodeBase64}`,
            id: id,
            value: id
        });
        
    } catch (error) {
        console.error('Barcode error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Batch Barcodes
app.post('/api/barcode/batch', async (req, res) => {
    try {
        const { prefix, startNumber, endNumber, barcodeType = 'code128', barColor = '#D4AF37' } = req.body;
        
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
            
            results.push({
                id: id,
                image: `data:image/png;base64,${barcodeBuffer.toString('base64')}`
            });
            
            // Save to database
            if (!qrCodes.find(c => c.id === id)) {
                qrCodes.push({ id: id, destination: null, scans: 0 });
            }
        }
        
        res.json({
            success: true,
            total: results.length,
            barcodes: results
        });
        
    } catch (error) {
        console.error('Batch error:', error);
        res.status(500).json({ error: error.message });
    }
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

// Generate QR Code with SVG support
app.post('/api/qr/generate', async (req, res) => {
    try {
        const { content, darkColor = '#4A2C1A', lightColor = '#F5E6D3', format = 'png' } = req.body;
        
        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }
        
        if (format === 'svg') {
            // Generate SVG
            const svgString = await QRCode.toString(content, {
                type: 'svg',
                width: 500,
                margin: 2,
                color: { dark: darkColor, light: lightColor === 'transparent' ? 'transparent' : lightColor },
                errorCorrectionLevel: 'H'
            });
            
            res.json({
                success: true,
                svgContent: svgString,
                content: content,
                format: 'svg'
            });
        } else {
            // Generate PNG (default)
            const qrBuffer = await QRCode.toBuffer(content, {
                type: 'png',
                width: 500,
                margin: 2,
                color: { dark: darkColor, light: lightColor === 'transparent' ? 'transparent' : lightColor },
                errorCorrectionLevel: 'H'
            });
            
            const qrBase64 = qrBuffer.toString('base64');
            
            res.json({
                success: true,
                image: `data:image/png;base64,${qrBase64}`,
                content: content,
                format: 'png'
            });
        }
        
    } catch (error) {
        console.error('QR error:', error);
        res.status(500).json({ error: error.message });
    }
});
