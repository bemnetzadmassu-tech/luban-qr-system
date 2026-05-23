const db = require('../../database');
const QRCode = require('qrcode');

// Create a new QR code (ONE QR per product)
async function createQR(req, res) {
    const { id, productSku, destinationUrl } = req.body;
    
    if (!id) {
        return res.status(400).json({ error: 'QR ID required' });
    }
    
    try {
        // Check if product exists
        const product = await db.getProduct(productSku);
        
        await db.createCode(id, product?.name || 'Coffee Product', 'qr', product?.price || 0, destinationUrl);
        
        // Link QR to product if provided
        if (productSku) {
            await db.query(
                `UPDATE codes SET product_id = $1 WHERE id = $2`,
                [productSku, id]
            );
        }
        
        res.json({ 
            success: true, 
            id,
            message: `QR code ${id} created for product ${productSku || 'generic'}`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Generate QR code image
async function generateQR(req, res) {
    try {
        const { content, darkColor = '#D4AF37', lightColor = '#FFFFFF', format = 'png' } = req.body;
        
        if (!content) {
            return res.status(400).json({ error: 'Content required' });
        }
        
        if (format === 'svg') {
            const svgString = await QRCode.toString(content, {
                type: 'svg',
                width: 500,
                margin: 2,
                color: { dark: darkColor, light: lightColor },
                errorCorrectionLevel: 'H'
            });
            res.json({ success: true, svgContent: svgString, format: 'svg' });
        } else {
            const qrBuffer = await QRCode.toBuffer(content, {
                type: 'png',
                width: 500,
                margin: 2,
                color: { dark: darkColor, light: lightColor },
                errorCorrectionLevel: 'H'
            });
            res.json({ 
                success: true, 
                image: `data:image/png;base64,${qrBuffer.toString('base64')}`,
                format: 'png'
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// List all QR codes
async function listQRs(req, res) {
    try {
        const codes = await db.getAllCodes();
        res.json({ success: true, codes });
    } catch (error) {
        res.json({ success: true, codes: [] });
    }
}

// Update QR destination URL
async function updateQR(req, res) {
    const { id } = req.params;
    const { destinationUrl } = req.body;
    
    try {
        await db.updateQRDestination(id, destinationUrl);
        res.json({ success: true, message: `Updated ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Update QR to show product page
async function updateProductPage(req, res) {
    const { id } = req.params;
    const { productName, productPrice, productDescription, productSku } = req.body;
    
    try {
        // Add product columns if not exist
        await db.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS product_name TEXT`);
        await db.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS product_price DECIMAL(10,2)`);
        await db.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS product_description TEXT`);
        await db.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'redirect'`);
        await db.query(`ALTER TABLE codes ADD COLUMN IF NOT EXISTS product_id TEXT`);
        
        await db.query(`
            UPDATE codes 
            SET page_type = 'product', 
                product_name = $1, 
                product_price = $2, 
                product_description = $3,
                product_id = $4,
                qr_destination = NULL
            WHERE id = $5
        `, [productName, productPrice, productDescription, productSku, id]);
        
        res.json({ success: true, message: `Product page saved for ${id}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Get product details for QR
async function getProductDetails(req, res) {
    const { id } = req.params;
    try {
        const result = await db.query(`
            SELECT page_type, product_name, product_price, product_description, qr_destination, product_id
            FROM codes WHERE id = $1
        `, [id]);
        res.json({ success: true, product: result.rows[0] || {} });
    } catch (error) {
        res.json({ success: true, product: {} });
    }
}

// Delete QR code
async function deleteQR(req, res) {
    const { id } = req.params;
    try {
        await db.deleteCode(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    createQR,
    generateQR,
    listQRs,
    updateQR,
    updateProductPage,
    getProductDetails,
    deleteQR
};