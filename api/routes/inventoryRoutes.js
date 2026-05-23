const express = require('express');
const router = express.Router();
const db = require('../../database');

// Get inventory
router.get('/', async (req, res) => {
    try {
        const inventory = [
            { id: 'YIRG001', name: 'Yirgacheffe Coffee', quantity: 500, price: 24.99 },
            { id: 'SIDM001', name: 'Sidama Coffee', quantity: 350, price: 22.99 },
            { id: 'GUJI001', name: 'Guji Coffee', quantity: 200, price: 26.99 }
        ];
        
        res.json({ success: true, inventory: inventory });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
