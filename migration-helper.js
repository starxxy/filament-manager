// Migration Helper - Add this at the beginning of app.js
const API_BASE = window.location.origin;

// Check if migration is needed and perform it
async function checkAndMigrate() {
    try {
        // Check if we have IndexedDB data
        const hasIndexedDB = await checkIndexedDBData();

        if (hasIndexedDB) {
            const migrate = confirm('检测到本地数据，是否迁移到服务器？\n迁移后所有设备都能访问这些数据。');
            if (migrate) {
                await migrateToServer();
                alert('数据迁移成功！');
                // Clear IndexedDB after successful migration
                await clearIndexedDB();
            }
        }
    } catch (error) {
        console.error('Migration check failed:', error);
    }
}

async function checkIndexedDBData() {
    try {
        const dbCheck = new Dexie("FilamentPro_V3");
        dbCheck.version(4).stores({
            filaments: "++id",
            brands: "++id",
            types: "++id",
            channels: "++id"
        });

        const count = await dbCheck.filaments.count();
        return count > 0;
    } catch (error) {
        return false;
    }
}

async function migrateToServer() {
    const dbMigrate = new Dexie("FilamentPro_V3");
    dbMigrate.version(4).stores({
        filaments: "++id, brand, type, color, status, createdAt",
        brands: "++id, name",
        types: "++id, brand, typeName",
        channels: "++id, name"
    });

    const filaments = await dbMigrate.filaments.toArray();
    const brands = await dbMigrate.brands.toArray();
    const types = await dbMigrate.types.toArray();
    const channels = await dbMigrate.channels.toArray();

    const response = await fetch(`${API_BASE}/api/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filaments, brands, types, channels })
    });

    if (!response.ok) {
        throw new Error('Migration failed');
    }

    return await response.json();
}

async function clearIndexedDB() {
    const dbClear = new Dexie("FilamentPro_V3");
    await dbClear.delete();
}

// API Helper Functions
const API = {
    async getFilaments() {
        const res = await fetch(`${API_BASE}/api/filaments`);
        return await res.json();
    },

    async createFilament(data) {
        const res = await fetch(`${API_BASE}/api/filaments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await res.json();
    },

    async updateFilament(id, data) {
        const res = await fetch(`${API_BASE}/api/filaments/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await res.json();
    },

    async deleteFilament(id) {
        const res = await fetch(`${API_BASE}/api/filaments/${id}`, {
            method: 'DELETE'
        });
        return await res.json();
    },

    async getBrands() {
        const res = await fetch(`${API_BASE}/api/brands`);
        return await res.json();
    },

    async createBrand(name) {
        const res = await fetch(`${API_BASE}/api/brands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        return await res.json();
    },

    async deleteBrand(id) {
        const res = await fetch(`${API_BASE}/api/brands/${id}`, {
            method: 'DELETE'
        });
        return await res.json();
    },

    async getTypes() {
        const res = await fetch(`${API_BASE}/api/types`);
        return await res.json();
    },

    async createType(data) {
        const res = await fetch(`${API_BASE}/api/types`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await res.json();
    },

    async deleteType(id) {
        const res = await fetch(`${API_BASE}/api/types/${id}`, {
            method: 'DELETE'
        });
        return await res.json();
    },

    async getChannels() {
        const res = await fetch(`${API_BASE}/api/channels`);
        return await res.json();
    },

    async createChannel(name) {
        const res = await fetch(`${API_BASE}/api/channels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        return await res.json();
    },

    async deleteChannel(id) {
        const res = await fetch(`${API_BASE}/api/channels/${id}`, {
            method: 'DELETE'
        });
        return await res.json();
    }
};
