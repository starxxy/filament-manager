// API-backed Dexie replacement - TRUE Offline-First Version
const API_BASE = '';

// Storage Helpers
const STORAGE_PREFIX = 'filapro_v2_';
const getStoredData = (table) => {
    try {
        const str = localStorage.getItem(STORAGE_PREFIX + table);
        return str ? JSON.parse(str) : null;
    } catch (e) { return null; }
};
const setStoredData = (table, data, version) => {
    try {
        localStorage.setItem(STORAGE_PREFIX + table, JSON.stringify({ data, version, ts: Date.now() }));
    } catch (e) { console.warn('LocalStorage save failed', e); }
};

window.Dexie = class APIDatabase {
    constructor(name) {
        this.name = name;
        this.filaments = new APITable('filaments');
        this.brands = new APITable('brands');
        this.types = new APITable('types');
        this.channels = new APITable('channels');
        this.locations = new APITable('locations');
    }
    version(v) {
        return { stores: () => ({ upgrade: () => this }) };
    }
};

class APITable {
    constructor(tableName) {
        this.tableName = tableName;
        this.lastServerVersion = 0;
        this._memCache = null;
    }

    async toArray() {
        const table = this.tableName;

        // 1. Memory Cache - Fastest (valid for 30 seconds)
        if (this._memCache && (Date.now() - this._memCacheTs < 30000)) {
            return this._memCache;
        }

        // 2. LocalStorage Cache - Return IMMEDIATELY, refresh in background
        const stored = getStoredData(table);
        if (stored && stored.data && stored.data.length > 0) {
            console.log(`[${table}] Returning ${stored.data.length} items from local cache`);
            this._memCache = stored.data;
            this._memCacheTs = Date.now();
            this.lastServerVersion = stored.version || 0;

            // Background sync (non-blocking)
            this._backgroundSync();

            return stored.data;
        }

        // 3. No local cache - must fetch from server (first time only)
        console.log(`[${table}] No cache, fetching from server...`);
        return await this._fetchFromServer();
    }

    async _backgroundSync() {
        const table = this.tableName;
        try {
            const res = await fetch(`${API_BASE}/api/${table}?t=${Date.now()}`);
            if (!res.ok) return;
            const result = await res.json();
            const serverData = result.items || result;
            const serverVersion = result.version || Date.now();

            const stored = getStoredData(table);
            if (!stored || serverVersion !== stored.version) {
                console.log(`[${table}] Background sync: new data v${serverVersion}`);
                setStoredData(table, serverData, serverVersion);
                this._memCache = serverData;
                this._memCacheTs = Date.now();
                this.lastServerVersion = serverVersion;
                // Optionally trigger UI refresh here if needed
            }
        } catch (e) {
            console.warn(`[${table}] Background sync failed:`, e);
        }
    }

    async _fetchFromServer() {
        const table = this.tableName;
        try {
            const res = await fetch(`${API_BASE}/api/${table}?t=${Date.now()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const result = await res.json();
            const serverData = result.items || result;
            const serverVersion = result.version || Date.now();

            setStoredData(table, serverData, serverVersion);
            this._memCache = serverData;
            this._memCacheTs = Date.now();
            this.lastServerVersion = serverVersion;
            return serverData;
        } catch (e) {
            console.error(`[${table}] Fetch failed:`, e);
            return [];
        }
    }

    async count() {
        return (await this.toArray()).length;
    }

    async get(id) {
        // Check memory/local cache first for individual items
        // Check memory/local cache first for individual items
        const items = await this.toArray();
        const found = items.find(i => i.id == id); // Use loose equality or cast to match types

        if (found) {
            // Fix: If it's a filament and hasImage is true but imageBlob is missing (optimization artifact),
            // we MUST fetch the full item from server to get the image.
            if (this.tableName === 'filaments' && found.hasImage && !found.imageBlob) {
                // Fall through to fetch
            } else {
                return found;
            }
        }

        // Fallback to API for fresh data
        try {
            const res = await fetch(`${API_BASE}/api/${this.tableName}/${id}`);
            return res.ok ? await res.json() : null;
        } catch (e) { return null; }
    }

    async add(data) {
        const res = await fetch(`${API_BASE}/api/${this.tableName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        this._invalidateCache();
        return result.id || result.lastInsertRowid;
    }

    async put(data) {
        if (!data.id) return this.add(data);
        const res = await fetch(`${API_BASE}/api/${this.tableName}/${data.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        this._invalidateCache();
        return await res.json();
    }

    async update(id, changes) {
        const existing = await this.get(id);
        if (!existing) throw new Error("Not found");
        return await this.put({ ...existing, ...changes });
    }

    async delete(id) {
        await fetch(`${API_BASE}/api/${this.tableName}/${id}`, { method: 'DELETE' });
        this._invalidateCache();
        return true;
    }

    _invalidateCache() {
        this._memCache = null;
        this._memCacheTs = 0;
        localStorage.removeItem(STORAGE_PREFIX + this.tableName);
    }

    where(criteria) {
        const self = this;
        return {
            first: async () => {
                const items = await self.toArray();
                if (typeof criteria === 'string') return null;
                return items.find(i => Object.keys(criteria).every(k => i[k] === criteria[k]));
            },
            toArray: async () => {
                const items = await self.toArray();
                if (typeof criteria === 'string') return items;
                return items.filter(i => Object.keys(criteria).every(k => i[k] === criteria[k]));
            },
            equalsIgnoreCase: (value) => ({
                first: async () => {
                    const items = await self.toArray();
                    return items.find(i => i[criteria] && String(i[criteria]).toLowerCase() === String(value).toLowerCase());
                },
                toArray: async () => {
                    const items = await self.toArray();
                    return items.filter(i => i[criteria] && String(i[criteria]).toLowerCase() === String(value).toLowerCase());
                }
            })
        };
    }

    orderBy(field) {
        const self = this;
        return {
            reverse: () => ({
                toArray: async () => {
                    const items = await self.toArray();
                    return items.sort((a, b) => (b[field] || 0) - (a[field] || 0));
                }
            })
        };
    }
}

console.log('Offline-First API-Dexie v2 loaded');
