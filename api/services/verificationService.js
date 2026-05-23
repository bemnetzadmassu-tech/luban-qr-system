const db = require('../../database');
const { validateBarcodeFormat } = require('../utils/validators');

// Verify a barcode for authenticity
async function verifyBarcode(barcodeValue, ipAddress, userAgent) {
    try {
        // Validate format first
        const formatCheck = validateBarcodeFormat(barcodeValue);
        if (!formatCheck.valid) {
            return {
                valid: false,
                message: formatCheck.error,
                status: 'invalid_format'
            };
        }
        
        // Check in database
        const barcode = await db.getSerializedBarcode(barcodeValue);
        
        if (!barcode) {
            // Log suspicious scan
            await logSuspiciousScan(barcodeValue, ipAddress, userAgent, 'not_found');
            return {
                valid: false,
                message: '❌ This barcode does not exist in our system',
                status: 'counterfeit'
            };
        }
        
        // Check if revoked
        if (barcode.is_revoked) {
            await logSuspiciousScan(barcodeValue, ipAddress, userAgent, 'revoked');
            return {
                valid: false,
                message: '⚠️ This product has been reported as counterfeit',
                status: 'revoked'
            };
        }
        
        // Check if returned
        if (barcode.is_returned) {
            return {
                valid: false,
                message: '⚠️ This product has been returned',
                status: 'returned'
            };
        }
        
        // Update verification count
        await db.query(`
            UPDATE serialized_barcodes 
            SET verification_count = verification_count + 1
            WHERE barcode_value = $1
        `, [barcodeValue]);
        
        // Log successful verification
        await logVerification(barcodeValue, ipAddress, userAgent);
        
        // Calculate loyalty points (10 points per verification)
        const loyaltyPoints = 10;
        
        return {
            valid: true,
            message: '✅ GENUINE PRODUCT',
            status: 'authentic',
            product: {
                name: barcode.product_name,
                weight: barcode.weight_grams,
                roast: barcode.roast_level,
                batch: barcode.batch_number,
                serial: barcode.serial_number
            },
            verificationCount: barcode.verification_count + 1,
            loyaltyPointsAwarded: loyaltyPoints,
            verifiedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('Verification error:', error);
        return {
            valid: false,
            message: 'Error verifying product',
            status: 'error'
        };
    }
}

// Log successful verification
async function logVerification(barcodeValue, ipAddress, userAgent) {
    try {
        await db.query(`
            INSERT INTO verifications (barcode, ip_address, user_agent, loyalty_points_awarded)
            VALUES ($1, $2, $3, $4)
        `, [barcodeValue, ipAddress, userAgent, 10]);
    } catch (error) {
        console.error('Log verification error:', error);
    }
}

// Log suspicious/fraudulent scans
async function logSuspiciousScan(barcodeValue, ipAddress, userAgent, reason) {
    try {
        // Create fraud_alerts table if not exists
        await db.query(`
            CREATE TABLE IF NOT EXISTS fraud_alerts (
                id SERIAL PRIMARY KEY,
                barcode TEXT,
                ip_address INET,
                user_agent TEXT,
                reason TEXT,
                alert_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await db.query(`
            INSERT INTO fraud_alerts (barcode, ip_address, user_agent, reason)
            VALUES ($1, $2, $3, $4)
        `, [barcodeValue, ipAddress, userAgent, reason]);
    } catch (error) {
        console.error('Log fraud error:', error);
    }
}

// Check for duplicate/fraudulent scans
async function checkForFraud(barcodeValue, ipAddress) {
    try {
        // Check if same barcode scanned from different IPs rapidly
        const recentScans = await db.query(`
            SELECT COUNT(DISTINCT ip_address) as unique_ips, COUNT(*) as total_scans
            FROM verifications
            WHERE barcode = $1 
            AND verified_at > NOW() - INTERVAL '1 hour'
        `, [barcodeValue]);
        
        if (recentScans.rows[0]?.unique_ips > 5) {
            return {
                isFraud: true,
                reason: 'Multiple verifications from different locations',
                severity: 'high'
            };
        }
        
        return { isFraud: false };
    } catch (error) {
        console.error('Fraud check error:', error);
        return { isFraud: false };
    }
}

module.exports = {
    verifyBarcode,
    logVerification,
    logSuspiciousScan,
    checkForFraud
};