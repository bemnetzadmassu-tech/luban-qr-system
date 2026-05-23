const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'luban123';

function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'] || req.body.token || req.query.token;
    
    // Allow during development or if token matches
    if (token === ADMIN_PASSWORD || process.env.NODE_ENV === 'development') {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized access' });
    }
}

function validateAdminPassword(password) {
    return password === ADMIN_PASSWORD;
}

module.exports = { requireAuth, validateAdminPassword };
