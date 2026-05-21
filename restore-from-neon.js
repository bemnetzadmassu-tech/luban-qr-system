const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
});

async function restore() {
    try {
        const result = await pool.query('SELECT * FROM qr_codes');
        console.log(`Found ${result.rows.length} QR codes in Neon`);
        
        // Save to file
        fs.writeFileSync('restored-qr-codes.json', JSON.stringify(result.rows, null, 2));
        console.log('Saved to restored-qr-codes.json');
        
        console.log('\n📋 Your QR Codes:');
        result.rows.forEach(row => {
            console.log(`   ID: ${row.id}, Destination: ${row.destination_url || 'Not set'}, Scans: ${row.scan_count || 0}`);
        });
        
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        pool.end();
    }
}

restore();
