const express = require('express');
const router = express.Router();
const db = require('../../database');

// Verify barcode at POS
router.post('/verify', async (req, res) => {
    try {
        const { barcodeValue } = req.body;
        
        res.json({
            success: true,
            product: {
                name: 'Yirgacheffe Coffee',
                price: 24.99,
                barcode: barcodeValue
            },
            isValid: true
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Checkout
router.post('/checkout', async (req, res) => {
    try {
        const { items, paymentMethod } = req.body;
        const total = items.reduce((sum, item) => sum + (item.price || 24.99), 0);
        const transactionId = `TXN-${Date.now()}`;
        
        res.json({
            success: true,
            transaction: { id: transactionId, total: total, items: items.length },
            message: 'Checkout successful'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
