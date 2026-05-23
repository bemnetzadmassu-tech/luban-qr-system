// Authentication middleware
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'lubanadmin2024';

function validateAdminPassword(password) {
    return password === ADMIN_PASSWORD;
}

function authenticateAdmin(req, res, next) {
    const token = req.headers.authorization;
    
    // Simple token validation (you can enhance with JWT later)
    if (!token || token !== `Bearer ${ADMIN_PASSWORD}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    next();
}

// Generate simple session token
function generateToken() {
    return Buffer.from(`${Date.now()}-${ADMIN_PASSWORD}`).toString('base64');
}

module.exports = { validateAdminPassword, authenticateAdmin, generateToken };