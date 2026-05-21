const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const db = new sqlite3.Database('./luban_codes.db');

db.all('SELECT * FROM qr_codes', (err, rows) => {
    if (err) {
        console.error('Error:', err);
        return;
    }
    fs.writeFileSync('qr_codes_export.json', JSON.stringify(rows, null, 2));
    console.log(`✅ Exported ${rows.length} records to qr_codes_export.json`);
});
