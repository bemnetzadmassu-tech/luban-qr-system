const db = require('../../database');
const bwipjs = require('bwip-js');
const { verifyBarcode } = require('../services/verificationService');
const { validateBarcodeFormat } = require('../utils/validators');

// Generate unique serialized barcodes (LBN-250-MR-X8K2A91 format)
async function generateSerializedBarcodes(req, res) {
    try {
        const { 
            productId, 
            quantity = 1, 
            weightGrams = 250, 
            roastCode = 'MR', 
            batchNumber 
        } = req.body;
        
        const product = await db.getProduct(productId);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        const results = [];
        const brandCode = 'LBN';
        
        function generateSerial() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let result = '';
            for (let i = 0; i < 7; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return result;
        }
        
        for (let i = 0; i < quantity; i++) {
            const serialNumber = generateSerial();
            const barcodeValue = `${brandCode}-${weightGrams}-${roastCode}-${serialNumber}`;
            
            // Save to database
            await db.createSerializedBarcode(
                barcodeValue, 
                productId, 
                product.name, 
                weightGrams, 
                roastCode, 
                serialNumber, 
                batchNumber || `BATCH-${Date.now()}`
            );
            
            // Generate barcode image
            const barcodeBuffer = await new Promise((resolve, reject) => {
                bwipjs.toBuffer({
                    bcid: 'code128',
                    text: barcodeValue,
                    scale: 3,
                    height: 12,
                    includetext: true,
                    textxalign: 'center',
                    barcolor: 'D4AF37'
                }, (err, png) => err ? reject(err) : resolve(png));
            });
            
            results.push({
                barcode: barcodeValue,
                image: `data:image/png;base64,${barcodeBuffer.toString('base64')}`
            });
        }
        
        res.json({ 
            success: true, 
            total: results.length, 
            barcodes: results,
            product: {
                id: product.id,
                name: product.name,
                price: product.price
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Verify barcode (anti-counterfeit)
async function verifyBarcodeEndpoint(req, res) {
    try {
        const { barcodeValue } = req.params;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];
        
        const result = await verifyBarcode(barcodeValue, ipAddress, userAgent);
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Generate single barcode
async function generateSingleBarcode(req, res) {
    try {
        const { id, barColor = '#D4AF37' } = req.body;
        if (!id) return res.status(400).json({ error: 'ID required' });
        
        const barcodeBuffer = await new Promise((resolve, reject) => {
            bwipjs.toBuffer({
                bcid: 'code128',
                text: id,
                scale: 3,
                height: 12,
                includetext: true,
                textxalign: 'center',
                barcolor: barColor.replace('#', '')
            }, (err, png) => err ? reject(err) : resolve(png));
        });
        
        res.json({ 
            success: true, 
            image: `data:image/png;base64,${barcodeBuffer.toString('base64')}`, 
            id 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Batch generate barcodes
async function batchGenerateBarcodes(req, res) {
    try {
        const { prefix, startNumber, endNumber, barColor = '#D4AF37' } = req.body;
        const results = [];
        const padLength = String(endNumber).length;
        
        for (let i = startNumber; i <= endNumber; i++) {
            const id = `${prefix}${String(i).padStart(padLength, '0')}`;
            const barcodeBuffer = await new Promise((resolve, reject) => {
                bwipjs.toBuffer({
                    bcid: 'code128',
                    text: id,
                    scale: 3,
                    height: 12,
                    includetext: true,
                    textxalign: 'center',
                    barcolor: barColor.replace('#', '')
                }, (err, png) => err ? reject(err) : resolve(png));
            });
            results.push({ id, image: barcodeBuffer.toString('base64') });
        }
        res.json({ success: true, total: results.length, barcodes: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Get barcode status
async function getBarcodeStatus(req, res) {
    try {
        const { barcode } = req.params;
        
        const barcodeData = await db.getSerializedBarcode(barcode);
        
        if (!barcodeData) {
            return res.json({
                success: true,
                barcode: barcode,
                exists: false,
                isAuthentic: false,
                message: 'Barcode not found in system'
            });
        }
        
        res.json({
            success: true,
            barcode: barcode,
            exists: true,
            isAuthentic: !barcodeData.is_revoked,
            isActivated: barcodeData.is_activated,
            isSold: barcodeData.is_sold,
            product: {
                name: barcodeData.product_name,
                weight: barcodeData.weight_grams,
                roast: barcodeData.roast_level
            },
            verificationCount: barcodeData.verification_count,
            status: barcodeData.is_revoked ? 'revoked' : (barcodeData.is_sold ? 'sold' : 'active')
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    generateSerializedBarcodes,
    verifyBarcodeEndpoint,
    generateSingleBarcode,
    batchGenerateBarcodes,
    getBarcodeStatus
};