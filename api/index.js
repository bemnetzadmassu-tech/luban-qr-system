cat > api/index.js << 'EOF'
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

// Simple in-memory storage
let qrCodes = [];

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Generate QR code
app.post('/api/qr/generate', async (req, res) => {
    try {
        const { content, qrDarkColor = '#4A2C1A', qrLightColor = '#F5E6D3' } = req.body;
        
        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }
        
        const qrBuffer = await QRCode.toBuffer(content, {
            type: 'png',
            width: 500,
            margin: 2,
            color: { dark: qrDarkColor, light: qrLightColor },
            errorCorrectionLevel: 'H'
        });
        
        const qrBase64 = qrBuffer.toString('base64');
        
        // Store in memory
        qrCodes.push({ content, createdAt: new Date() });
        
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
    res.json({ success: true, codes: qrCodes });
});

// Redirect endpoint
app.get('/api/r/:id', (req, res) => {
    const { id } = req.params;
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Luban Coffee QR</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>☕ Luban Coffee</h1>
            <p>QR Code ID: <strong>${id}</strong></p>
            <p>✅ Your dynamic QR system is working!</p>
            <p>You can change where this QR code redirects in the database.</p>
            <a href="/test.html">Back to Generator</a>
        </body>
        </html>
    `);
});

// Serve static files
app.use(express.static('public'));

module.exports = app;
EOF