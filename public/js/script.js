// ============================================
// LUBAN COFFEE - MAIN SCRIPT
// QR Code Landing Page with 5-second redirect
// ============================================

// Configuration
const CONFIG = {
    redirectSeconds: 5,
    websiteUrl: 'https://luban-qr-ecosystem.vercel.app',
    phoneNumber: '+251900000000',
    email: 'info@lubancoffee.et',
    address: 'Addis Ababa, Ethiopia'
};

// Global variables
let redirectTimer = null;
let redirectCancelled = false;

// ============================================
// REDIRECT HANDLER FUNCTIONS
// ============================================

function startRedirect() {
    const messageDiv = document.getElementById('redirectMessage');
    if (!messageDiv) return;
    
    let seconds = CONFIG.redirectSeconds;
    
    redirectTimer = setInterval(() => {
        if (!redirectCancelled) {
            seconds--;
            messageDiv.innerHTML = `🔄 Redirecting to website in ${seconds} second${seconds !== 1 ? 's' : ''}...`;
            
            if (seconds <= 0) {
                clearInterval(redirectTimer);
                window.location.href = CONFIG.websiteUrl;
            }
        }
    }, 1000);
}

function cancelRedirect() {
    if (!redirectCancelled) {
        redirectCancelled = true;
        if (redirectTimer) {
            clearInterval(redirectTimer);
        }
        
        const messageDiv = document.getElementById('redirectMessage');
        if (messageDiv) {
            messageDiv.innerHTML = '⏹️ Auto-redirect cancelled';
            messageDiv.style.background = 'rgba(220, 53, 69, 0.9)';
            messageDiv.style.borderLeftColor = '#dc3545';
            
            setTimeout(() => {
                messageDiv.style.opacity = '0';
                setTimeout(() => {
                    messageDiv.style.display = 'none';
                }, 500);
            }, 2000);
        }
    }
}

// ============================================
// IMAGE FALLBACK HANDLER
// ============================================

function handleImageErrors() {
    // Logo fallback
    const logoImg = document.getElementById('logoImg');
    if (logoImg) {
        logoImg.onerror = function() {
            this.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Ccircle cx='100' cy='100' r='90' fill='%23D4AF37'/%3E%3Ccircle cx='100' cy='100' r='75' fill='%231a1a2e'/%3E%3Ctext x='100' y='140' text-anchor='middle' fill='%23D4AF37' font-size='16' font-weight='bold'%3ELUBAN%3C/text%3E%3Ctext x='100' y='160' text-anchor='middle' fill='%23D4AF37' font-size='12'%3ECOFFEE%3C/text%3E%3C/svg%3E";
        };
    }
    
    // Leaf image fallback
    const leafImg = document.getElementById('leafImg');
    if (leafImg) {
        leafImg.onerror = function() {
            this.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 200'%3E%3Cpath d='M50,20 C30,40 20,80 30,120 C40,160 50,180 50,180 C50,180 60,160 70,120 C80,80 70,40 50,20 Z' fill='%23D4AF37' opacity='0.6'/%3E%3C/svg%3E";
        };
    }
    
    // Bottom banner fallback
    const bottomImg = document.getElementById('bottomPngImg');
    if (bottomImg) {
        bottomImg.onerror = function() {
            this.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 500 120'%3E%3Crect width='500' height='120' fill='%23D4AF37'/%3E%3Ctext x='250' y='45' text-anchor='middle' fill='%231a1a2e' font-size='20' font-weight='bold'%3EPREMIUM ETHIOPIAN COFFEE%3C/text%3E%3C/svg%3E";
        };
    }
}

// ============================================
// VERIFICATION FUNCTIONS
// ============================================

async function verifyBarcode(barcode) {
    // Simulate API call - Replace with your actual API endpoint
    return new Promise((resolve) => {
        setTimeout(() => {
            if (barcode && barcode.startsWith('LBN-')) {
                resolve({
                    success: true,
                    valid: true,
                    productName: 'Luban Coffee Premium Blend',
                    batchNumber: barcode,
                    verifiedDate: new Date().toLocaleString()
                });
            } else {
                resolve({
                    success: false,
                    valid: false,
                    message: 'Invalid barcode format'
                });
            }
        }, 1000);
    });
}

// ============================================
// EVENT LISTENERS
// ============================================

function initEventListeners() {
    // Visit website button
    const websiteBtn = document.getElementById('visitWebsiteBtn');
    if (websiteBtn) {
        websiteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            cancelRedirect();
            window.location.href = CONFIG.websiteUrl;
        });
    }
    
    // Cancel redirect on any interactive element
    const interactiveElements = document.querySelectorAll('a, button, .social-link, .step');
    interactiveElements.forEach(el => {
        el.addEventListener('click', cancelRedirect);
    });
    
    // Contact items don't cancel redirect (they open native apps)
    const contactItems = document.querySelectorAll('.contact-item');
    contactItems.forEach(el => {
        el.addEventListener('click', (e) => {
            // Don't cancel redirect for contact clicks
            // They open phone/maps/email apps
        });
    });
}

// ============================================
// ANIMATION & VISUAL EFFECTS
// ============================================

function addHoverEffects() {
    // Add ripple effect to button
    const btn = document.querySelector('.btn-primary');
    if (btn) {
        btn.addEventListener('click', function(e) {
            let ripple = document.createElement('span');
            ripple.classList.add('ripple');
            this.appendChild(ripple);
            
            let x = e.clientX - e.target.offsetLeft;
            let y = e.clientY - e.target.offsetTop;
            
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;
            
            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
    }
}

// Add ripple styles dynamically
const rippleStyle = document.createElement('style');
rippleStyle.textContent = `
    .btn-primary {
        position: relative;
        overflow: hidden;
    }
    .ripple {
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.7);
        transform: scale(0);
        animation: ripple-animation 0.6s linear;
        pointer-events: none;
    }
    @keyframes ripple-animation {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(rippleStyle);

// ============================================
// PAGE LOAD INITIALIZATION
// ============================================

function init() {
    console.log('Luban Coffee - Page Loaded');
    
    // Handle image loading errors
    handleImageErrors();
    
    // Initialize event listeners
    initEventListeners();
    
    // Add visual effects
    addHoverEffects();
    
    // Start auto-redirect for QR code scan
    startRedirect();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for debugging (optional)
window.lubanCoffee = {
    cancelRedirect,
    config: CONFIG,
    version: '1.0.0'
};