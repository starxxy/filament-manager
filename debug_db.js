const Database = require('better-sqlite3');
const dbPath = '/app/database.db';
const db = new Database(dbPath, { readonly: true });

try {
    const stmt = db.prepare("SELECT id, brand, type, length(imageBlob) as imgLen FROM filaments LIMIT 50");
    const rows = stmt.all();

    console.log("All filaments:");
    rows.forEach(r => {
        console.log(`ID: ${r.id}, Brand: '${r.brand}', Type: '${r.type}', ImageLen: ${r.imgLen || 0}`);
    });
} catch (e) {
    console.error(e);
}
