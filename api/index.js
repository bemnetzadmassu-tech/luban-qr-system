const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

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

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Catch-all for frontend
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '../public/index.html'));
    }
});

module.exports = app;
