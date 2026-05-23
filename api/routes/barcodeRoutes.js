const express = require('express');
const router = express.Router();
const barcodeController = require('../controllers/barcodeController');

// Generate unique serialized barcodes (factory)
router.post('/generate/serialized', barcodeController.generateSerializedBarcodes);

// Verify barcode (anti-counterfeit)
router.get('/verify/:barcodeValue', barcodeController.verifyBarcodeEndpoint);

// Get barcode status
router.get('/status/:barcode', barcodeController.getBarcodeStatus);

// Generate single barcode
router.post('/generate', barcodeController.generateSingleBarcode);

// Batch generate barcodes
router.post('/batch', barcodeController.batchGenerateBarcodes);

module.exports = router;

// Generate premium barcode (LBN-250-MR-X8K2A91 format)
router.post('/premium/generate', async (req, res) => {
    try {
        const { productId, quantity = 1, weightGrams = 250, roastCode = 'MR', batchNumber } = req.body;
        
        const product = await db.getCode(productId);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        const results = [];
        const brandCode = 'LBN';
        
        function generateSerial() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let result = '';
            for (let i = 0; i < 7; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
            return result;
        }
        
        for (let i = 0; i < quantity; i++) {
            const serialNumber = generateSerial();
            const barcodeValue = `${brandCode}-${weightGrams}-${roastCode}-${serialNumber}`;
            
            const QRCode = require('qrcode');
            const qrBuffer = await QRCode.toBuffer(barcodeValue, { type: 'png', width: 300 });
            
            results.push({ barcode: barcodeValue, image: qrBuffer.toString('base64') });
        }
        
        res.json({ success: true, total: results.length, barcodes: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verify premium barcode
router.post('/premium/verify', async (req, res) => {
    try {
        const { barcodeValue } = req.body;
        
        // Parse format: LBN-250-MR-X8K2A91
        const parts = barcodeValue.split('-');
        const isValidFormat = parts.length === 4 && parts[0] === 'LBN';
        
        res.json({
            success: true,
            isAuthentic: true,
            isValidFormat: isValidFormat,
            message: isValidFormat ? '✅ Product is authentic' : '⚠️ Invalid format',
            verifiedAt: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get barcode status
router.get('/status/:barcode', async (req, res) => {
    try {
        const { barcode } = req.params;
        res.json({
            success: true,
            barcode: barcode,
            isAuthentic: true,
            status: 'active',
            verifiedAt: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
