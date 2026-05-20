const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Simple test endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working!' });
});

// Serve static files
app.use(express.static('public'));

module.exports = app;
