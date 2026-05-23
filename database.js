const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

// Initialize tables
async function initDB() {
    try {
        // ============================================
        // YOUR EXISTING TABLES (UNCHANGED)
        // ============================================
        
        // Main table - ONE ID for BOTH QR and Barcode!
        await pool.query(`
            CREATE TABLE IF NOT EXISTS codes (
                id TEXT PRIMARY KEY,
                product_name TEXT,
                product_type TEXT,
                price DECIMAL(10,2),
                qr_destination TEXT,
                qr_scan_count INTEGER DEFAULT 0,
                barcode_scan_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_qr_scanned TIMESTAMP,
                last_barcode_scanned TIMESTAMP
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS scan_logs (
                id SERIAL PRIMARY KEY,
                code TEXT NOT NULL,
                scan_type TEXT CHECK(scan_type IN ('qr', 'barcode')),
                scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ip_address TEXT,
                user_agent TEXT
            )
        `);
        
        // ============================================
        // NEW TABLES FOR MODULAR SYSTEM (ADDED)
        // ============================================
        
        // Products table (detailed product info)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                price DECIMAL(10,2) NOT NULL,
                cost DECIMAL(10,2),
                weight_grams INTEGER,
                roast_level TEXT,
                origin TEXT,
                region TEXT,
                altitude TEXT,
                processing TEXT,
                flavor_notes TEXT[],
                image_url TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Serialized Barcodes (Premium format: LBN-250-MR-X8K2A91)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS serialized_barcodes (
                id SERIAL PRIMARY KEY,
                barcode_value TEXT UNIQUE NOT NULL,
                product_id TEXT REFERENCES products(id),
                product_name TEXT,
                weight_grams INTEGER,
                roast_level TEXT,
                serial_number TEXT,
                batch_number TEXT,
                is_activated BOOLEAN DEFAULT FALSE,
                is_sold BOOLEAN DEFAULT FALSE,
                is_revoked BOOLEAN DEFAULT FALSE,
                is_returned BOOLEAN DEFAULT FALSE,
                verification_count INTEGER DEFAULT 0,
                sold_at TIMESTAMP,
                sold_price DECIMAL(10,2),
                activated_at TIMESTAMP,
                returned_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Inventory table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS inventory (
                id SERIAL PRIMARY KEY,
                product_id TEXT REFERENCES products(id),
                quantity INTEGER DEFAULT 0,
                reserved_quantity INTEGER DEFAULT 0,
                reorder_level INTEGER DEFAULT 20,
                reorder_quantity INTEGER DEFAULT 100,
                last_restocked_at TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Sales Transactions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sales_transactions (
                id SERIAL PRIMARY KEY,
                transaction_id TEXT UNIQUE NOT NULL,
                customer_name TEXT,
                customer_email TEXT,
                customer_phone TEXT,
                total_amount DECIMAL(10,2) NOT NULL,
                discount_amount DECIMAL(10,2) DEFAULT 0,
                tax_amount DECIMAL(10,2) DEFAULT 0,
                payment_method TEXT,
                payment_status TEXT DEFAULT 'completed',
                sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                cashier_name TEXT,
                pos_terminal_id TEXT
            )
        `);
        
        // Sale Items (line items)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sale_items (
                id SERIAL PRIMARY KEY,
                transaction_id TEXT REFERENCES sales_transactions(transaction_id),
                barcode_value TEXT REFERENCES serialized_barcodes(barcode_value),
                product_id TEXT REFERENCES products(id),
                quantity INTEGER DEFAULT 1,
                unit_price DECIMAL(10,2) NOT NULL,
                total_price DECIMAL(10,2) NOT NULL
            )
        `);
        
        // Store locations
        await pool.query(`
            CREATE TABLE IF NOT EXISTS store_locations (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                address TEXT,
                phone TEXT,
                is_active BOOLEAN DEFAULT TRUE
            )
        `);
        
        // QR Codes extended (for product pages)
        await pool.query(`
            ALTER TABLE codes ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'redirect'
        `);
        
        await pool.query(`
            ALTER TABLE codes ADD COLUMN IF NOT EXISTS product_description TEXT
        `);
        
        // Create indexes for performance
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_serialized_barcodes_value ON serialized_barcodes(barcode_value)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_serialized_barcodes_product ON serialized_barcodes(product_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_transactions_date ON sales_transactions(sale_date)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id)`);
        
        // Insert sample products if none exist
        const productCount = await pool.query(`SELECT COUNT(*) FROM products`);
        if (parseInt(productCount.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO products (id, name, description, price, cost, weight_grams, roast_level, origin, flavor_notes) VALUES 
                ('YIRG001', 'Yirgacheffe Coffee', 'Floral notes, bergamot, jasmine. Light roast.', 24.99, 12.50, 250, 'Light', 'Ethiopia', ARRAY['Floral', 'Bergamot', 'Jasmine']),
                ('SIDM001', 'Sidama Coffee', 'Berry, citrus, chocolate notes. Medium roast.', 22.99, 11.50, 250, 'Medium', 'Ethiopia', ARRAY['Berry', 'Citrus', 'Chocolate']),
                ('GUJI001', 'Guji Coffee', 'Blueberry, wine, cocoa. Medium-dark roast.', 26.99, 13.50, 250, 'Medium-Dark', 'Ethiopia', ARRAY['Blueberry', 'Wine', 'Cocoa']),
                ('SPEC001', 'Luban Special Blend', 'Our signature blend. Rich, smooth, full-bodied.', 32.99, 16.50, 250, 'Medium', 'Ethiopia', ARRAY['Chocolate', 'Caramel', 'Spice'])
            `);
        }
        
        // Insert inventory if none exist
        const inventoryCount = await pool.query(`SELECT COUNT(*) FROM inventory`);
        if (parseInt(inventoryCount.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO inventory (product_id, quantity, reorder_level) VALUES 
                ('YIRG001', 500, 20),
                ('SIDM001', 500, 20),
                ('GUJI001', 500, 20),
                ('SPEC001', 500, 20)
            `);
        }
        
        console.log('✅ PostgreSQL Database initialized (Modular)');
    } catch (error) {
        console.error('DB init error:', error.message);
    }
}

initDB();

// ============================================
// YOUR EXISTING DB HELPERS (UNCHANGED)
// ============================================
const dbHelpers = {
    createCode: async (id, productName, productType, price, qrDestination) => {
        await pool.query(
            `INSERT INTO codes (id, product_name, product_type, price, qr_destination) 
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [id, productName, productType, price, qrDestination]
        );
    },
    
    getCode: async (id) => {
        const result = await pool.query(`SELECT * FROM codes WHERE id = $1`, [id]);
        return result.rows[0];
    },
    
    getAllCodes: async () => {
        const result = await pool.query(`SELECT * FROM codes ORDER BY created_at DESC`);
        return result.rows;
    },
    
    updateQRDestination: async (id, destination) => {
        await pool.query(
            `UPDATE codes SET qr_destination = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [destination, id]
        );
    },
    
    incrementQRScan: async (id) => {
        await pool.query(
            `UPDATE codes SET qr_scan_count = qr_scan_count + 1, last_qr_scanned = CURRENT_TIMESTAMP WHERE id = $1`,
            [id]
        );
    },
    
    incrementBarcodeScan: async (id) => {
        await pool.query(
            `UPDATE codes SET barcode_scan_count = barcode_scan_count + 1, last_barcode_scanned = CURRENT_TIMESTAMP WHERE id = $1`,
            [id]
        );
    },
    
    logScan: async (code, scanType, ip, userAgent) => {
        await pool.query(
            `INSERT INTO scan_logs (code, scan_type, ip_address, user_agent) VALUES ($1, $2, $3, $4)`,
            [code, scanType, ip, userAgent]
        );
    },
    
    getStats: async () => {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_codes,
                COALESCE(SUM(qr_scan_count), 0) as total_qr_scans,
                COALESCE(SUM(barcode_scan_count), 0) as total_barcode_scans
            FROM codes
        `);
        return result.rows[0];
    },
    
    deleteCode: async (id) => {
        await pool.query(`DELETE FROM codes WHERE id = $1`, [id]);
    },
    
    // ============================================
    // NEW DB HELPERS FOR MODULAR SYSTEM (ADDED)
    // ============================================
    
    // Products
    getAllProducts: async () => {
        const result = await pool.query(`SELECT * FROM products WHERE is_active = TRUE ORDER BY name`);
        return result.rows;
    },
    
    getProduct: async (id) => {
        const result = await pool.query(`SELECT * FROM products WHERE id = $1`, [id]);
        return result.rows[0];
    },
    
    // Serialized Barcodes
    createSerializedBarcode: async (barcodeValue, productId, productName, weightGrams, roastLevel, serialNumber, batchNumber) => {
        await pool.query(`
            INSERT INTO serialized_barcodes (barcode_value, product_id, product_name, weight_grams, roast_level, serial_number, batch_number)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [barcodeValue, productId, productName, weightGrams, roastLevel, serialNumber, batchNumber]);
    },
    
    getSerializedBarcode: async (barcodeValue) => {
        const result = await pool.query(`
            SELECT sb.*, p.price, p.description 
            FROM serialized_barcodes sb
            LEFT JOIN products p ON sb.product_id = p.id
            WHERE sb.barcode_value = $1
        `, [barcodeValue]);
        return result.rows[0];
    },
    
    markBarcodeAsSold: async (barcodeValue, soldPrice) => {
        await pool.query(`
            UPDATE serialized_barcodes 
            SET is_sold = TRUE, sold_at = CURRENT_TIMESTAMP, sold_price = $1
            WHERE barcode_value = $2
        `, [soldPrice, barcodeValue]);
    },
    
    // Inventory
    getInventory: async () => {
        const result = await pool.query(`
            SELECT i.*, p.name, p.price, p.description
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            ORDER BY p.name
        `);
        return result.rows;
    },
    
    updateInventory: async (productId, quantityChange) => {
        await pool.query(`
            UPDATE inventory 
            SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = $2
        `, [quantityChange, productId]);
    },
    
    // Sales
    createTransaction: async (transactionId, customerName, customerEmail, customerPhone, totalAmount, discountAmount, taxAmount, paymentMethod, cashierName, posTerminalId) => {
        await pool.query(`
            INSERT INTO sales_transactions 
            (transaction_id, customer_name, customer_email, customer_phone, total_amount, discount_amount, tax_amount, payment_method, cashier_name, pos_terminal_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [transactionId, customerName, customerEmail, customerPhone, totalAmount, discountAmount, taxAmount, paymentMethod, cashierName, posTerminalId]);
        return transactionId;
    },
    
    addSaleItem: async (transactionId, barcodeValue, productId, quantity, unitPrice, totalPrice) => {
        await pool.query(`
            INSERT INTO sale_items (transaction_id, barcode_value, product_id, quantity, unit_price, total_price)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [transactionId, barcodeValue, productId, quantity, unitPrice, totalPrice]);
    },
    
    getDailySales: async (date) => {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as transaction_count,
                SUM(total_amount) as total_sales,
                AVG(total_amount) as average_order
            FROM sales_transactions
            WHERE DATE(sale_date) = $1
        `, [date]);
        return result.rows[0];
    },
    
    getLowStock: async () => {
        const result = await pool.query(`
            SELECT i.*, p.name, p.price
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            WHERE i.quantity <= i.reorder_level
        `);
        return result.rows;
    }
};

module.exports = dbHelpers;