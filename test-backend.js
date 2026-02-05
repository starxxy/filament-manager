
const http = require('http');

function request(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(JSON.parse(body));
                    } else {
                        console.error(`Error ${res.statusCode} on ${method} ${path}:`, body);
                        reject(new Error(`Status ${res.statusCode}`));
                    }
                } catch (e) {
                    console.error("Failed to parse response:", body);
                    resolve(body);
                }
            });
        });

        req.on('error', (e) => {
            console.error(`Request failed: ${method} ${path}`, e.message);
            reject(e);
        });

        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function runTests() {
    console.log("Starting Backend Tests on Port 3001...");
    try {
        // 1. Version
        console.log("1. Testing GET /api/version...");
        const ver = await request('GET', '/api/version');
        console.log("   Version:", ver);

        // 2. Settings
        console.log("2. Testing GET /api/settings...");
        const settings = await request('GET', '/api/settings');
        console.log("   Settings:", Object.keys(settings).length, "keys");

        // 3. Create Filament
        console.log("3. Testing POST /api/filaments...");
        const filament = {
            brand: "TestBrand",
            type: "TestType",
            color: "Red",
            weight: 1.0,
            status: "Sealed",
            minNozzle: 200, maxNozzle: 220,
            minBed: 50, maxBed: 60,
            purchaseDate: "2023-01-01",
            purchasePrice: 100,
            purchaseChannel: "TestStore",
            location: "Shelf 1",
            createdAt: Date.now()
        };
        const created = await request('POST', '/api/filaments', filament);
        console.log("   Created ID:", created.id);

        // 4. List Filaments
        console.log("4. Testing GET /api/filaments...");
        const list = await request('GET', '/api/filaments');
        console.log("   Total items:", list.items.length);
        const found = list.items.find(i => i.id === created.id);
        if (!found) throw new Error("Created item not found in list!");
        console.log("   Verified item exists.");

        // 5. Delete Filament
        console.log(`5. Testing DELETE /api/filaments/${created.id}...`);
        await request('DELETE', `/api/filaments/${created.id}`);
        console.log("   Deleted.");

        // 6. Backups List
        console.log("6. Testing GET /api/backups...");
        const backups = await request('GET', '/api/backups');
        console.log("   Backups found:", backups.length);

        console.log("\n✅ All Backend Tests Passed!");
    } catch (err) {
        console.error("\n❌ Test Failed:", err.message);
        process.exit(1);
    }
}

runTests();
