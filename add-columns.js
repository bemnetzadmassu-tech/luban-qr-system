const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

async function addColumns() {
    try {
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_name TEXT`);
        console.log('✅ Added product_name');
        
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_price DECIMAL(10,2)`);
        console.log('✅ Added product_price');
        
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS product_description TEXT`);
        console.log('✅ Added product_description');
        
        await pool.query(`ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'redirect'`);
        console.log('✅ Added page_type');
        
        console.log('All columns added successfully!');
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        pool.end();
    }
}

addColumns();
