const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const qrDir = path.join(__dirname, 'qr-codes');
const barcodeDir = path.join(__dirname, 'barcodes');
if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });
if (!fs.existsSync(barcodeDir)) fs.mkdirSync(barcodeDir, { recursive: true });

app.use('/qr-codes', express.static(qrDir));
app.use('/barcodes', express.static(barcodeDir));

// ============================================
// AUTO-DETECT SERVER IP
// ============================================
app.get('/api/server-info', (req, res) => {
    const networkInterfaces = os.networkInterfaces();
    const ips = [];
    
    for (const interfaceName in networkInterfaces) {
        const interfaces = networkInterfaces[interfaceName];
        for (const iface of interfaces) {
            if (!iface.internal && iface.family === 'IPv4') {
                ips.push(iface.address);
            }
        }
    }
    
    res.json({
        success: true,
        ip: ips[0] || '127.0.0.1',
        allIps: ips,
        port: PORT,
        baseUrl: `http://${ips[0] || 'localhost'}:${PORT}`
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// CREATE CODE
// ============================================
app.post('/api/codes/create', async (req, res) => {
    try {
        const { id, productName, productType, price, qrDestination } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }
        
        const existing = await db.getCode(id);
        if (existing) {
            return res.status(400).json({ error: 'ID already exists' });
        }
        
        await db.createCode(id, productName, productType, price, qrDestination);
        
        res.json({
            success: true,
            id: id,
            message: `Code ${id} created!`
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GENERATE QR CODE (Stores ONLY the ID in QR)
// ============================================
app.post('/api/generate/qr', async (req, res) => {
    try {
        const { id, qrDarkColor = '#4A2C1A', qrLightColor = '#F5E6D3' } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID is required' });
        }
        
        // QR contains ONLY the ID (dynamic!)
        const qrContent = id;
        
        const qrBuffer = await QRCode.toBuffer(qrContent, {
            type: 'png',
            width: 500,
            margin: 2,
            color: { dark: qrDarkColor, light: qrLightColor },
            errorCorrectionLevel: 'H'
        });
        
        const qrBase64 = qrBuffer.toString('base64');
        const qrPath = path.join(qrDir, `${id}.png`);
        fs.writeFileSync(qrPath, qrBuffer);
        
        res.json({
            success: true,
            type: 'qr',
            id: id,
            qrContent: qrContent,
            image: `data:image/png;base64,${qrBase64}`,
            imageUrl: `/qr-codes/${id}.png`
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GENERATE BARCODE (Just the ID)
// ============================================
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
        const barcodePath = path.join(barcodeDir, `${id}.png`);
        fs.writeFileSync(barcodePath, barcodeBuffer);
        
        res.json({
            success: true,
            type: 'barcode',
            id: id,
            value: id,
            image: `data:image/png;base64,${barcodeBase64}`,
            imageUrl: `/barcodes/${id}.png`
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// REDIRECT ENDPOINT (Dynamic!)
// ============================================
app.get('/api/r/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`📱 QR SCAN: ${id} at ${new Date().toISOString()}`);
        
        const codeData = await db.getCode(id);
        
        if (!codeData || !codeData.qr_destination) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Code Not Found</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1>❌ Code Not Found</h1>
                    <p>The code "${id}" has not been assigned a destination yet.</p>
                    <p>Please check your code or contact support.</p>
                </body>
                </html>
            `);
        }
        
        const ip = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'] || 'Unknown';
        await db.logScan(id, 'qr', ip, userAgent);
        await db.incrementQRScan(id);
        
        console.log(`🔄 Redirecting ${id} → ${codeData.qr_destination}`);
        
        res.redirect(codeData.qr_destination);
        
    } catch (error) {
        console.error('Redirect error:', error);
        res.status(500).send('Server error');
    }
});

// ============================================
// BARCODE SCAN (POS/Inventory)
// ============================================
app.post('/api/barcode/scan', async (req, res) => {
    try {
        const { id } = req.body;
        
        console.log(`📊 BARCODE SCAN: ${id}`);
        
        const codeData = await db.getCode(id);
        
        if (!codeData) {
            return res.status(404).json({ error: 'Code not found in inventory' });
        }
        
        const ip = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'] || 'Unknown';
        await db.logScan(id, 'barcode', ip, userAgent);
        await db.incrementBarcodeScan(id);
        
        res.json({
            success: true,
            id: id,
            productName: codeData.product_name,
            productType: codeData.product_type,
            price: codeData.price
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET ALL CODES
// ============================================
app.get('/api/codes/list', async (req, res) => {
    try {
        const codes = await db.getAllCodes();
        res.json({ success: true, codes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// UPDATE QR DESTINATION (Dynamic!)
// ============================================
app.put('/api/codes/update/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { qrDestination } = req.body;
        
        await db.updateQRDestination(id, qrDestination);
        
        res.json({
            success: true,
            message: `QR destination for ${id} updated to: ${qrDestination}`
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ============================================
// 301 REDIRECT MIDDLEWARE
// ============================================
app.use((req, res, next) => {
    // Define your domains
    const oldDomains = [
        'coffee-qr-system.vercel.app',
        'coffee-qr-system-nine.vercel.app',
        'luban-qr-system.vercel.app'
    ];
    const newDomain = 'qr.lubancoffee.com'; // Change to your actual domain
    const currentHost = req.headers.host;
    
    // Check if request came from old domain
    if (currentHost && oldDomains.some(old => currentHost.includes(old))) {
        const newUrl = `https://${newDomain}${req.url}`;
        console.log(`🔄 301 REDIRECT: ${currentHost}${req.url} → ${newUrl}`);
        return res.redirect(301, newUrl);
    }
    
    next();
});
// ============================================
// DELETE CODE
// ============================================
app.delete('/api/codes/delete/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.deleteCode(id);
        res.json({ success: true, message: `Deleted ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// STATISTICS
// ============================================
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║              ☕ LUBAN COFFEE - DYNAMIC QR + BARCODE SYSTEM                 ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                           ║
║  Server: http://localhost:${PORT}                                          ║
║                                                                           ║
║  FEATURES:                                                                ║
║    ✅ QR contains ONLY ID (dynamic - change destination anytime)         ║
║    ✅ Barcode contains same ID (POS/Inventory)                           ║
║    ✅ API Host Selector (Localhost, IP, Vercel, Custom)                  ║
║    ✅ Auto-detect server IP                                              ║
║    ✅ Color pickers (HEX + RGB)                                          ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;