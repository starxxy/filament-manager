
const fs = require('fs');
const path = require('path');

// Conf
const HTML_FILE = 'index.html';
const APP_JS = 'app.js';
const SERVER_JS = 'server.js';

console.log("Starting Consistency Check...");

function checkIds() {
    console.log("\n--- Checking ID Consistency ---");
    const html = fs.readFileSync(HTML_FILE, 'utf8');
    const appJs = fs.readFileSync(APP_JS, 'utf8');

    // Extract IDs from HTML (naive regex, good enough for most cases)
    const idRegex = /id=["']([^"']+)["']/g;
    const htmlIds = new Set();
    let match;
    while ((match = idRegex.exec(html)) !== null) {
        htmlIds.add(match[1]);
    }

    // Extract getElementById from JS
    const jsIdRegex = /getElementById\(['"]([^"']+)['"]\)/g;
    const missingIds = new Set();
    while ((match = jsIdRegex.exec(appJs)) !== null) {
        if (!htmlIds.has(match[1])) {
            missingIds.add(match[1]);
        }
    }

    if (missingIds.size > 0) {
        console.error("❌ IDs referenced in app.js but missing in index.html:");
        missingIds.forEach(id => console.error(`   - ${id}`));
    } else {
        console.log("✅ All IDs referenced in app.js exist in index.html");
    }
}

function checkRoutes() {
    console.log("\n--- Checking API Route Consistency ---");
    const appJs = fs.readFileSync(APP_JS, 'utf8');
    const serverJs = fs.readFileSync(SERVER_JS, 'utf8');

    // Extract fetch calls from app.js: fetch('/api/foo'...)
    // Naively assume paths start with /api
    const fetchRegex = /fetch\(['"`](\/api\/[^'"`?]+)/g;
    const fetchedRoutes = new Set();
    let match;
    while ((match = fetchRegex.exec(appJs)) !== null) {
        let route = match[1];
        // Handle template literals loosely (e.g. /api/filaments/${id})
        // We'll just strip ${...} patterns to compare base
        route = route.replace(/\$\{[^}]+\}/g, ':param');
        fetchedRoutes.add(route);
    }

    // Extract routes from server.js: app.get('/api/foo'...)
    const serverRegex = /app\.(get|post|put|delete)\(['"`](\/api\/[^'"`]+)/g;
    const serverRoutes = new Set();
    while ((match = serverRegex.exec(serverJs)) !== null) {
        let route = match[2];
        // Normalize express params /:id to :param
        route = route.replace(/\/:[a-zA-Z0-9_]+/g, '/:param');
        serverRoutes.add(route);
    }

    // Compare
    const missingRoutes = [];
    fetchedRoutes.forEach(route => {
        // Simple normalization for comparison
        // e.g. /api/filaments/:param/image vs /api/filaments/:id/image -> normalized earlier
        if (!serverRoutes.has(route)) {
            // Try fuzzy match for singular/plural differences or unmatched params
            // But strictly, they should match logic.
            // Special case: /api/backups/${filename} -> /api/backups/:param
            missingRoutes.push(route);
        }
    });

    if (missingRoutes.length > 0) {
        console.warn("⚠️  Potential API Mismatches (Frontend calls -> Backend definition):");
        missingRoutes.forEach(r => console.warn(`   - Client calls: ${r}`));
        console.log("   (Note: variable substitutions make strict matching hard, check manually)");
    } else {
        console.log("✅ API Route basics look consistent.");
    }
}

checkIds();
checkRoutes();
