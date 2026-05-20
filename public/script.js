// ============================================
// CONFIGURATION
// ============================================
const baseUrl = window.location.origin;
console.log('📍 Base URL:', baseUrl);

let currentQR = null;
let currentBarcode = null;
let serverPort = null;
let serverIp = null;

// API Host Management
let currentApiHost = localStorage.getItem('apiHostType') || 'localhost';
let currentIpAddress = localStorage.getItem('ipAddress') || '';
let currentCustomUrl = localStorage.getItem('customUrl') || '';

// Auto-detect if on Vercel
const isOnVercel = window.location.hostname.includes('vercel.app');

// ============================================
// COLOR CONVERSION FUNCTIONS
// ============================================
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function updateDarkColor() {
    const hexColor = document.getElementById('qr-dark').value;
    const rgb = hexToRgb(hexColor);
    document.getElementById('qr-dark-rgb').value = `${rgb.r},${rgb.g},${rgb.b}`;
    document.getElementById('dark-preview').style.backgroundColor = hexColor;
}

function updateDarkColorFromRgb() {
    const rgbValue = document.getElementById('qr-dark-rgb').value;
    const parts = rgbValue.split(',').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
        const hex = rgbToHex(parts[0], parts[1], parts[2]);
        document.getElementById('qr-dark').value = hex;
        document.getElementById('dark-preview').style.backgroundColor = hex;
    }
}

function updateLightColor() {
    const hexColor = document.getElementById('qr-light').value;
    const rgb = hexToRgb(hexColor);
    document.getElementById('qr-light-rgb').value = `${rgb.r},${rgb.g},${rgb.b}`;
    document.getElementById('light-preview').style.backgroundColor = hexColor;
}

function updateLightColorFromRgb() {
    const rgbValue = document.getElementById('qr-light-rgb').value;
    const parts = rgbValue.split(',').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
        const hex = rgbToHex(parts[0], parts[1], parts[2]);
        document.getElementById('qr-light').value = hex;
        document.getElementById('light-preview').style.backgroundColor = hex;
    }
}

function updateBarcodeColor() {
    const hexColor = document.getElementById('barcode-color').value;
    const rgb = hexToRgb(hexColor);
    document.getElementById('barcode-color-rgb').value = `${rgb.r},${rgb.g},${rgb.b}`;
    document.getElementById('barcode-preview').style.backgroundColor = hexColor;
}

function updateBarcodeColorFromRgb() {
    const rgbValue = document.getElementById('barcode-color-rgb').value;
    const parts = rgbValue.split(',').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
        const hex = rgbToHex(parts[0], parts[1], parts[2]);
        document.getElementById('barcode-color').value = hex;
        document.getElementById('barcode-preview').style.backgroundColor = hex;
    }
}

function setPreset(darkHex, lightHex) {
    document.getElementById('qr-dark').value = darkHex;
    document.getElementById('qr-light').value = lightHex;
    updateDarkColor();
    updateLightColor();
}

// Add event listeners for color pickers
if (document.getElementById('qr-dark')) {
    document.getElementById('qr-dark').addEventListener('input', updateDarkColor);
    document.getElementById('qr-dark-rgb').addEventListener('input', updateDarkColorFromRgb);
    document.getElementById('qr-light').addEventListener('input', updateLightColor);
    document.getElementById('qr-light-rgb').addEventListener('input', updateLightColorFromRgb);
}

if (document.getElementById('barcode-color')) {
    document.getElementById('barcode-color').addEventListener('input', updateBarcodeColor);
    document.getElementById('barcode-color-rgb').addEventListener('input', updateBarcodeColorFromRgb);
}

// ============================================
// API HOST MANAGEMENT
// ============================================
async function fetchServerInfo() {
    try {
        const response = await fetch(`${baseUrl}/api/server-info`);
        const data = await response.json();
        
        if (data.success) {
            serverPort = data.port;
            serverIp = data.ip;
            localStorage.setItem('serverPort', serverPort);
            localStorage.setItem('serverIp', serverIp);
            console.log(`✅ Auto-detected server: ${data.baseUrl}`);
            return true;
        }
    } catch (error) {
        console.log('Could not auto-detect:', error.message);
        if (isOnVercel) {
            serverPort = '443';
            serverIp = window.location.hostname;
        } else {
            serverPort = '3000';
            serverIp = 'localhost';
        }
        return false;
    }
}

function getApiBaseUrl() {
    const hostType = document.getElementById('api-host-type')?.value || currentApiHost;
    const detectedPort = serverPort || localStorage.getItem('serverPort') || '3000';
    const detectedIp = serverIp || localStorage.getItem('serverIp') || '192.168.1.100';
    
    switch(hostType) {
        case 'localhost':
            return `http://localhost:${detectedPort}`;
        case 'ip':
            const ip = document.getElementById('ip-address')?.value || currentIpAddress || detectedIp;
            return `http://${ip}:${detectedPort}`;
        case 'vercel':
            return 'https://luban-qr-system.vercel.app';
        case 'custom':
            return document.getElementById('custom-url')?.value || currentCustomUrl;
        default:
            return baseUrl;
    }
}

function updateApiHost() {
    const hostType = document.getElementById('api-host-type').value;
    currentApiHost = hostType;
    localStorage.setItem('apiHostType', hostType);
    
    const ipGroup = document.getElementById('ip-address-group');
    const customGroup = document.getElementById('custom-url-group');
    
    if (ipGroup) ipGroup.style.display = hostType === 'ip' ? 'block' : 'none';
    if (customGroup) customGroup.style.display = hostType === 'custom' ? 'block' : 'none';
    
    if (hostType === 'ip') {
        const savedIp = localStorage.getItem('ipAddress');
        if (savedIp) document.getElementById('ip-address').value = savedIp;
    }
    if (hostType === 'custom') {
        const savedUrl = localStorage.getItem('customUrl');
        if (savedUrl) document.getElementById('custom-url').value = savedUrl;
    }
    updateApiInfoDisplay();
}

function updateApiInfoDisplay() {
    const apiBaseUrl = getApiBaseUrl();
    const infoDiv = document.getElementById('current-api-info');
    if (infoDiv) {
        infoDiv.innerHTML = `
            Current API Base URL: <strong>${apiBaseUrl}</strong><br>
            QR codes will redirect to: ${apiBaseUrl}/api/r/YOUR_CODE<br>
            ✅ Server: ${serverIp || 'localhost'}:${serverPort || '3000'}
        `;
    }
}

function saveIpAddress() {
    const ip = document.getElementById('ip-address').value;
    if (ip) {
        localStorage.setItem('ipAddress', ip);
        currentIpAddress = ip;
        updateApiInfoDisplay();
        alert(`✅ IP Address saved: ${ip}`);
    }
}

function saveCustomUrl() {
    const url = document.getElementById('custom-url').value;
    if (url) {
        localStorage.setItem('customUrl', url);
        currentCustomUrl = url;
        updateApiInfoDisplay();
        alert(`✅ Custom URL saved: ${url}`);
    }
}

async function applyHostToAll() {
    const apiBaseUrl = getApiBaseUrl();
    if (!confirm(`Apply ${apiBaseUrl} to ALL QR codes?`)) return;
    
    try {
        const response = await fetch(`${baseUrl}/api/codes/list`);
        const data = await response.json();
        if (!data.codes || data.codes.length === 0) {
            alert('No QR codes found');
            return;
        }
        
        let updated = 0;
        for (const code of data.codes) {
            const newDestination = `${apiBaseUrl}/api/r/${code.id}`;
            const updateResponse = await fetch(`${baseUrl}/api/codes/update/${code.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qrDestination: newDestination })
            });
            if (updateResponse.ok) updated++;
        }
        alert(`✅ Updated ${updated} of ${data.codes.length} QR codes`);
        loadCodes();
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

function refreshCurrentHost() {
    updateApiInfoDisplay();
    loadCodes();
}

// ============================================
// TAB SWITCHING
// ============================================
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');
    event.target.classList.add('active');
    
    if (tabName === 'manage') loadCodes();
    if (tabName === 'barcode-manage') loadBarcodes();
    if (tabName === 'stats') loadStats();
}

// ============================================
// CREATE CODE
// ============================================
async function createCode() {
    const id = document.getElementById('code-id').value.toUpperCase();
    const productName = document.getElementById('product-name').value;
    const productType = document.getElementById('product-type').value;
    const price = parseFloat(document.getElementById('price').value);
    const qrDestination = document.getElementById('qr-destination').value;
    
    if (!id || !qrDestination) {
        alert('ID and QR Destination are required');
        return;
    }
    
    const response = await fetch(`${baseUrl}/api/codes/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, productName, productType, price, qrDestination })
    });
    
    const data = await response.json();
    
    if (data.success) {
        document.getElementById('create-result').innerHTML = `
            <div class="success-box">
                ✅ Code ${id} created!<br>
                Use this ID for both QR and barcode!
            </div>
        `;
        document.getElementById('create-result').classList.add('show');
        loadCodes();
        loadStats();
    } else {
        alert('Error: ' + data.error);
    }
}

// ============================================
// GENERATE QR CODE
// ============================================
async function generateQR() {
    const id = document.getElementById('qr-id').value.toUpperCase();
    const dark = document.getElementById('qr-dark').value;
    const light = document.getElementById('qr-light').value;
    
    if (!id) {
        alert('Enter ID');
        return;
    }
    
    const response = await fetch(`${baseUrl}/api/generate/qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, qrDarkColor: dark, qrLightColor: light })
    });
    
    const data = await response.json();
    
    if (data.success) {
        currentQR = data;
        document.getElementById('qr-result').innerHTML = `
            <div class="preview"><img src="${data.image}" alt="QR Code"></div>
            <p><strong>ID:</strong> ${data.id}</p>
            <p><strong>QR Contains:</strong> <code>${data.qrContent}</code></p>
            <div class="success-box">
                ✅ This QR code is DYNAMIC!<br>
                The printed QR will always work.<br>
                You can change where it redirects ANYTIME in the Manage tab!
            </div>
            <button class="btn-secondary" onclick="downloadQR()">📥 Download QR Code</button>
        `;
        document.getElementById('qr-result').classList.add('show');
    }
}

function downloadQR() {
    if (currentQR?.imageUrl) {
        window.open(currentQR.imageUrl);
    }
}

// ============================================
// GENERATE BARCODE
// ============================================
async function generateBarcode() {
    const id = document.getElementById('barcode-id').value.toUpperCase();
    const type = document.getElementById('barcode-type').value;
    const color = document.getElementById('barcode-color').value;
    
    if (!id) {
        alert('Enter ID');
        return;
    }
    
    const response = await fetch(`${baseUrl}/api/generate/barcode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, barcodeType: type, barColor: color })
    });
    
    const data = await response.json();
    
    if (data.success) {
        currentBarcode = data;
        document.getElementById('barcode-result').innerHTML = `
            <div class="preview"><img src="${data.image}" alt="Barcode"></div>
            <p><strong>ID:</strong> ${data.id}</p>
            <p><strong>Barcode Contains:</strong> ${data.value}</p>
            <button class="btn-secondary" onclick="downloadBarcode()">📥 Download Barcode</button>
        `;
        document.getElementById('barcode-result').classList.add('show');
    }
}

function downloadBarcode() {
    if (currentBarcode?.imageUrl) {
        window.open(currentBarcode.imageUrl);
    }
}

// ============================================
// LOAD CODES
// ============================================
async function loadCodes() {
    try {
        const response = await fetch(`${baseUrl}/api/codes/list`);
        const data = await response.json();
        
        if (!data.codes || data.codes.length === 0) {
            document.getElementById('codes-list').innerHTML = '<p>No codes yet. Create one!</p>';
            return;
        }
        
        const apiBaseUrl = getApiBaseUrl();
        
        let html = '';
        for (const code of data.codes) {
            const fullRedirectUrl = `${apiBaseUrl}/api/r/${code.id}`;
            html += `
                <div class="code-item">
                    <div><strong>📱 ${code.id}</strong> - ${code.product_name || 'No product'}</div>
                    <div style="font-size: 12px;">🎯 Current destination: ${code.qr_destination || 'Not set'}</div>
                    <div style="font-size: 11px; color: #666;">🔗 API redirect URL: ${fullRedirectUrl}</div>
                    <div style="font-size: 12px;">📊 QR Scans: ${code.qr_scan_count || 0} | Barcode Scans: ${code.barcode_scan_count || 0}</div>
                    <div style="margin-top: 10px;">
                        <input type="text" id="edit-${code.id}" placeholder="New destination URL (e.g., https://google.com)" style="padding: 6px; width: 250px;">
                        <button class="btn-secondary" onclick="updateDestination('${code.id}')">✏️ Update QR Destination</button>
                        <button class="btn-secondary" onclick="deleteCode('${code.id}')" style="background:#dc3545;color:white;">🗑️ Delete</button>
                    </div>
                </div>
            `;
        }
        document.getElementById('codes-list').innerHTML = html;
        
    } catch (error) {
        document.getElementById('codes-list').innerHTML = '<p>Error loading codes</p>';
    }
}

async function updateDestination(id) {
    const newUrl = document.getElementById(`edit-${id}`).value;
    if (!newUrl) {
        alert('Enter a new destination URL');
        return;
    }
    
    const response = await fetch(`${baseUrl}/api/codes/update/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrDestination: newUrl })
    });
    
    const data = await response.json();
    alert(data.message);
    loadCodes();
}

async function deleteCode(id) {
    if (!confirm(`Delete code ${id}?`)) return;
    
    const response = await fetch(`${baseUrl}/api/codes/delete/${id}`, {
        method: 'DELETE'
    });
    
    const data = await response.json();
    alert(data.message);
    loadCodes();
    loadStats();
}

// ============================================
// LOAD BARCODES
// ============================================
async function loadBarcodes() {
    try {
        const response = await fetch(`${baseUrl}/api/codes/list`);
        const data = await response.json();
        
        if (!data.codes || data.codes.length === 0) {
            document.getElementById('barcodes-list').innerHTML = '<p>No barcodes yet. Generate some!</p>';
            return;
        }
        
        let html = '';
        for (const code of data.codes) {
            html += `
                <div class="code-item">
                    <div><strong>📊 ${code.id}</strong> - ${code.product_name || 'No product'}</div>
                    <div style="font-size: 12px;">💰 Price: $${code.price || 'N/A'}</div>
                    <div style="font-size: 12px;">📊 Scans: ${code.barcode_scan_count || 0}</div>
                    <div style="margin-top: 10px;">
                        <button class="btn-secondary" onclick="deleteCode('${code.id}')" style="background:#dc3545;color:white;">🗑️ Delete</button>
                    </div>
                </div>
            `;
        }
        document.getElementById('barcodes-list').innerHTML = html;
        
    } catch (error) {
        document.getElementById('barcodes-list').innerHTML = '<p>Error loading barcodes</p>';
    }
}
// ============================================
// 301 REDIRECT FUNCTIONS
// ============================================

function generateRedirectCode() {
    const oldDomain = document.getElementById('old-domain').value;
    const newDomain = document.getElementById('new-domain').value;
    
    if (!oldDomain || !newDomain) {
        alert('Please enter both old and new domains');
        return;
    }
    
    const redirectConfig = {
        redirects: [
            {
                source: "/api/r/(.*)",
                destination: `https://${newDomain}/api/r/$1`,
                permanent: true,
                statusCode: 301
            },
            {
                source: "/api/(.*)",
                destination: `https://${newDomain}/api/$1`,
                permanent: true,
                statusCode: 301
            },
            {
                source: "/(.*)",
                destination: `https://${newDomain}/$1`,
                permanent: true,
                statusCode: 301
            }
        ]
    };
    
    const configText = JSON.stringify(redirectConfig, null, 2);
    document.getElementById('redirect-config').textContent = configText;
    document.getElementById('redirect-info').style.display = 'block';
    
    // Also show the alternative middleware code
    const middlewareCode = `// Add this to your server.js
app.use((req, res, next) => {
    const oldDomains = ['${oldDomain}'];
    const newDomain = '${newDomain}';
    const currentHost = req.headers.host;
    
    if (currentHost && oldDomains.some(old => currentHost.includes(old))) {
        const newUrl = ` + '`' + `https://\${newDomain}\${req.url}` + '`' + `;
        console.log(` + '`' + `🔄 301 REDIRECT: \${currentHost}\${req.url} → \${newUrl}` + '`' + `);
        return res.redirect(301, newUrl);
    }
    next();
});`;
    
    // Append middleware code to the display
    document.getElementById('redirect-config').textContent += '\n\n// OR add this middleware to server.js:\n' + middlewareCode;
}

function copyRedirectConfig() {
    const configText = document.getElementById('redirect-config').textContent;
    navigator.clipboard.writeText(configText);
    alert('✅ Redirect configuration copied to clipboard!');
}

// Test 301 redirect
async function testRedirect() {
    const testCode = document.getElementById('test-redirect-code').value;
    if (!testCode) {
        alert('Enter a QR code ID to test');
        return;
    }
    
    const currentHost = window.location.host;
    const testUrl = `${window.location.origin}/api/r/${testCode}`;
    
    try {
        const response = await fetch(testUrl, { method: 'HEAD' });
        const redirectUrl = response.headers.get('location');
        
        if (response.status === 301 || response.status === 302) {
            document.getElementById('redirect-test-result').innerHTML = `
                <div class="success-box">
                    ✅ Redirect is working!<br>
                    Status: ${response.status} (301 Permanent Redirect)<br>
                    Redirects to: ${redirectUrl}
                </div>
            `;
        } else {
            document.getElementById('redirect-test-result').innerHTML = `
                <div class="warning-box">
                    ⚠️ No redirect detected. Status: ${response.status}
                </div>
            `;
        }
    } catch (error) {
        document.getElementById('redirect-test-result').innerHTML = `
            <div class="warning-box">
                ❌ Error: ${error.message}
            </div>
        `;
    }
}
// ============================================
// STATISTICS
// ============================================
async function loadStats() {
    const response = await fetch(`${baseUrl}/api/stats`);
    const data = await response.json();
    
    if (data.success) {
        document.getElementById('stats-content').innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number">${data.stats.total_codes || 0}</div>
                    <div class="stat-label">Total Codes</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${data.stats.total_qr_scans || 0}</div>
                    <div class="stat-label">QR Scans (Marketing)</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${data.stats.total_barcode_scans || 0}</div>
                    <div class="stat-label">Barcode Scans (Sales)</div>
                </div>
            </div>
        `;
    }
}

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Luban Coffee QR System - Initializing...');
    console.log('📍 Base URL:', baseUrl);
    
    await fetchServerInfo();
    
    const hostSelect = document.getElementById('api-host-type');
    if (hostSelect) {
        hostSelect.value = currentApiHost;
        updateApiHost();
    }
    
    const ipInput = document.getElementById('ip-address');
    if (ipInput) {
        if (serverIp && !ipInput.value && !isOnVercel) {
            ipInput.value = serverIp;
            currentIpAddress = serverIp;
            localStorage.setItem('ipAddress', serverIp);
        }
        ipInput.addEventListener('change', saveIpAddress);
    }
    
    const customUrlInput = document.getElementById('custom-url');
    if (customUrlInput) {
        customUrlInput.addEventListener('change', saveCustomUrl);
    }
    
    loadCodes();
    loadStats();
    updateApiInfoDisplay();
    
    console.log(`✅ System ready! Base URL: ${baseUrl}`);
});