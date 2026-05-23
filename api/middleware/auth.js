// Simple auth middleware
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'lubanadmin2024';

function validateAdminPassword(password) {
    return password === ADMIN_PASSWORD;
}

function authenticateAdmin(req, res, next) {
    const token = req.headers.authorization;
    
    // Simple validation - you can enhance with JWT
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    next();
}

module.exports = { validateAdminPassword, authenticateAdmin };