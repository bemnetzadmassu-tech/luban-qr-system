// Validation utilities

function validateBarcodeFormat(barcode) {
    // Format: LBN-250-MR-X8K2A91
    const pattern = /^LBN-(\d{3})-([A-Z]{2})-([A-Z0-9]{7})$/;
    const isValid = pattern.test(barcode);
    
    if (!isValid) return { valid: false, error: 'Invalid barcode format' };
    
    const parts = barcode.split('-');
    return {
        valid: true,
        weight: parts[1],
        roastCode: parts[2],
        serial: parts[3]
    };
}

function validateProductSKU(sku) {
    const pattern = /^[A-Z]{3,4}\d{3}$/;
    return pattern.test(sku);
}

function validateEmail(email) {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(email);
}

function validatePhone(phone) {
    const pattern = /^\+?[\d\s-]{10,}$/;
    return pattern.test(phone);
}

function validatePrice(price) {
    return typeof price === 'number' && price > 0 && !isNaN(price);
}

function validateQuantity(quantity) {
    return Number.isInteger(quantity) && quantity > 0;
}

module.exports = {
    validateBarcodeFormat,
    validateProductSKU,
    validateEmail,
    validatePhone,
    validatePrice,
    validateQuantity
};