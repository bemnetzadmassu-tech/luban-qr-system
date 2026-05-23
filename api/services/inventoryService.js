const db = require('../../database');

// Update inventory when product is sold
async function deductInventory(productId, quantity, barcodeValue) {
    try {
        // Get current inventory
        const inventory = await db.getInventory();
        const productItem = inventory.find(item => item.product_id === productId);
        
        if (!productItem) {
            throw new Error(`Product ${productId} not found in inventory`);
        }
        
        if (productItem.quantity < quantity) {
            throw new Error(`Insufficient stock for ${productId}. Available: ${productItem.quantity}`);
        }
        
        // Deduct quantity
        await db.updateInventory(productId, -quantity);
        
        // Mark barcode as sold
        if (barcodeValue) {
            const product = await db.getProduct(productId);
            await db.markBarcodeAsSold(barcodeValue, product?.price);
        }
        
        return {
            success: true,
            productId,
            newQuantity: productItem.quantity - quantity,
            quantityDeducted: quantity
        };
    } catch (error) {
        console.error('Inventory deduction error:', error);
        throw error;
    }
}

// Add inventory (restock)
async function addInventory(productId, quantity, notes = '') {
    try {
        await db.updateInventory(productId, quantity);
        
        // Log restock
        await db.query(`
            CREATE TABLE IF NOT EXISTS inventory_logs (
                id SERIAL PRIMARY KEY,
                product_id TEXT,
                quantity_change INTEGER,
                new_quantity INTEGER,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const currentInventory = await db.getInventory();
        const productItem = currentInventory.find(item => item.product_id === productId);
        
        await db.query(`
            INSERT INTO inventory_logs (product_id, quantity_change, new_quantity, notes)
            VALUES ($1, $2, $3, $4)
        `, [productId, quantity, productItem?.quantity || quantity, notes]);
        
        return {
            success: true,
            productId,
            addedQuantity: quantity,
            newQuantity: productItem?.quantity || quantity
        };
    } catch (error) {
        console.error('Inventory addition error:', error);
        throw error;
    }
}

// Get low stock alerts
async function getLowStockAlerts(threshold = 20) {
    try {
        const inventory = await db.getInventory();
        const lowStockItems = inventory.filter(item => item.quantity <= (item.reorder_level || threshold));
        
        return {
            success: true,
            lowStockItems,
            count: lowStockItems.length
        };
    } catch (error) {
        console.error('Low stock check error:', error);
        throw error;
    }
}

// Get inventory summary
async function getInventorySummary() {
    try {
        const inventory = await db.getInventory();
        
        const totalValue = inventory.reduce((sum, item) => {
            return sum + (item.quantity * parseFloat(item.price || 0));
        }, 0);
        
        const totalUnits = inventory.reduce((sum, item) => sum + item.quantity, 0);
        
        return {
            success: true,
            summary: {
                totalProducts: inventory.length,
                totalUnits,
                totalValue: totalValue.toFixed(2),
                lowStockCount: inventory.filter(item => item.quantity <= 20).length
            },
            inventory
        };
    } catch (error) {
        console.error('Inventory summary error:', error);
        throw error;
    }
}

module.exports = {
    deductInventory,
    addInventory,
    getLowStockAlerts,
    getInventorySummary
};