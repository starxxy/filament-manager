const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. 初始化数据库与存储
// ==========================================

// 初始化数据目录 (确保 Docker 挂载路径正确)
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// 初始化 SQLite 数据库连接
// 数据库文件存储在 /data 目录下，方便持久化
const db = new Database(path.join(DATA_DIR, 'database.db'));

// 初始化备份目录
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR);
}

// ==========================================
// 2. 数据库表结构定义
// ==========================================
db.exec(`
  -- 耗材主表
  CREATE TABLE IF NOT EXISTS filaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT NOT NULL,       -- 品牌
    type TEXT NOT NULL,        -- 材质 (PLA, PETG等)
    color TEXT,                -- 颜色
    weight REAL DEFAULT 1.0,   -- 重量 (kg)
    status TEXT DEFAULT 'Sealed', -- 状态 (Sealed, InUse, Finished)
    minNozzle INTEGER,         -- 最小喷嘴温度
    maxNozzle INTEGER,         -- 最大喷嘴温度
    minBed INTEGER,            -- 最小热床温度
    maxBed INTEGER,            -- 最大热床温度
    purchaseDate TEXT,         -- 购买日期
    purchasePrice REAL,        -- 购买价格
    purchaseChannel TEXT,      -- 购买渠道
    imageBlob TEXT,            -- 图片数据 (Base64)
    location TEXT,             -- 存放位置
    createdAt INTEGER NOT NULL -- 创建时间戳
  );

  -- 品牌预设表
  CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  -- 材质预设表 (关联温度参数)
  CREATE TABLE IF NOT EXISTS types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT NOT NULL,
    typeName TEXT NOT NULL,
    minNozzle INTEGER,
    maxNozzle INTEGER,
    minBed INTEGER,
    maxBed INTEGER,
    UNIQUE(brand, typeName)
  );

  -- 购买渠道预设表
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  -- 存放位置预设表
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );
`);

// 自动迁移：确保旧版本数据库包含 location 字段
try {
    db.exec("ALTER TABLE filaments ADD COLUMN location TEXT");
} catch (e) {
    // 忽略错误（列已存在）
}

// ==========================================
// 3. 中间件配置
// ==========================================

// 跨域配置 (允许所有来源)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Cache-Control', 'Authorization']
}));

// Body Parser配置 (增加限制以支持大图片上传)
app.use(express.json({ limit: '50000mb' }));

// 请求日志记录
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
    });
    next();
});

// 全局版本号，用于前端检测数据更新
let lastModifiedVersion = Date.now();

// 缓存控制策略
app.use('/api', (req, res, next) => {
    // 允许图片缓存 (静态资源)
    if (req.url.includes('/image')) {
        res.set('Cache-Control', 'public, max-age=86400'); // 缓存 1 天
        return next();
    }
    // API 数据禁止缓存，确保多端同步实时性
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

app.use(express.static('.'));

// ===== Filaments API =====
app.get('/api/filaments', (req, res) => {
    try {
        // 关键优化：主列表排除大体积的 imageBlob，改为返回 hasImage 标志
        const filaments = db.prepare(`
            SELECT id, brand, type, color, weight, status, purchaseDate, 
                   purchasePrice, purchaseChannel, location, createdAt,
                   minNozzle, maxNozzle, minBed, maxBed,
                   (CASE WHEN imageBlob IS NOT NULL AND imageBlob != '' THEN 1 ELSE 0 END) as hasImage 
            FROM filaments 
            ORDER BY createdAt DESC
        `).all();
        res.json({
            items: filaments,
            version: lastModifiedVersion
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取单个耗材详情（包含图片）
app.get('/api/filaments/:id', (req, res) => {
    try {
        const item = db.prepare('SELECT * FROM filaments WHERE id = ?').get(req.params.id);
        if (item) res.json(item);
        else res.status(404).json({ error: 'Not found' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 专门获取耗材图片
app.get('/api/filaments/:id/image', (req, res) => {
    try {
        const item = db.prepare('SELECT imageBlob FROM filaments WHERE id = ?').get(req.params.id);
        if (item && item.imageBlob) {
            res.json({ imageBlob: item.imageBlob });
        } else {
            res.status(404).json({ error: 'Image not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/filaments', (req, res) => {
    try {
        const { brand, type, color, weight, status, minNozzle, maxNozzle, minBed, maxBed,
            purchaseDate, purchasePrice, purchaseChannel, location, imageBlob, createdAt } = req.body;

        const stmt = db.prepare(`
      INSERT INTO filaments (brand, type, color, weight, status, minNozzle, maxNozzle, 
                             minBed, maxBed, purchaseDate, purchasePrice, purchaseChannel, 
                             location, imageBlob, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        const result = stmt.run(brand, type, color, weight, status, minNozzle, maxNozzle,
            minBed, maxBed, purchaseDate, purchasePrice, purchaseChannel,
            location, imageBlob, createdAt || Date.now());

        lastModifiedVersion = Date.now();
        res.json({ id: result.lastInsertRowid, ...req.body });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/filaments/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { brand, type, color, weight, status, minNozzle, maxNozzle, minBed, maxBed,
            purchaseDate, purchasePrice, purchaseChannel, location, imageBlob } = req.body;

        const stmt = db.prepare(`
      UPDATE filaments 
      SET brand=?, type=?, color=?, weight=?, status=?, minNozzle=?, maxNozzle=?, 
          minBed=?, maxBed=?, purchaseDate=?, purchasePrice=?, purchaseChannel=?, location=?, imageBlob=?
      WHERE id=?
    `);

        stmt.run(brand, type, color, weight, status, minNozzle, maxNozzle, minBed, maxBed,
            purchaseDate, purchasePrice, purchaseChannel, location, imageBlob, id);

        lastModifiedVersion = Date.now();
        res.json({ id: parseInt(id), ...req.body });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/filaments/:id', (req, res) => {
    try {
        const { id } = req.params;
        db.prepare('DELETE FROM filaments WHERE id=?').run(id);
        lastModifiedVersion = Date.now();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Brands API =====
app.get('/api/brands', (req, res) => {
    try {
        const brands = db.prepare('SELECT * FROM brands ORDER BY name').all();
        res.json(brands);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/brands', (req, res) => {
    try {
        const { name } = req.body;
        const stmt = db.prepare('INSERT OR IGNORE INTO brands (name) VALUES (?)');
        const result = stmt.run(name);
        lastModifiedVersion = Date.now();
        res.json({ id: result.lastInsertRowid, name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/brands/:id', (req, res) => {
    try {
        const { id } = req.params;
        db.prepare('DELETE FROM brands WHERE id=?').run(id);
        lastModifiedVersion = Date.now();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Types API =====
app.get('/api/types', (req, res) => {
    try {
        const types = db.prepare('SELECT * FROM types ORDER BY brand, typeName').all();
        res.json(types);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/types', (req, res) => {
    try {
        const { brand, typeName, minNozzle, maxNozzle, minBed, maxBed } = req.body;
        const stmt = db.prepare(`
      INSERT OR IGNORE INTO types (brand, typeName, minNozzle, maxNozzle, minBed, maxBed)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(brand, typeName, minNozzle, maxNozzle, minBed, maxBed);
        lastModifiedVersion = Date.now();
        res.json({ id: result.lastInsertRowid, ...req.body });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/types/:id', (req, res) => {
    try {
        const { id } = req.params;
        db.prepare('DELETE FROM types WHERE id=?').run(id);
        lastModifiedVersion = Date.now();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Channels API =====
app.get('/api/channels', (req, res) => {
    try {
        const channels = db.prepare('SELECT * FROM channels ORDER BY name').all();
        res.json(channels);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/channels', (req, res) => {
    try {
        const { name } = req.body;
        const stmt = db.prepare('INSERT OR IGNORE INTO channels (name) VALUES (?)');
        const result = stmt.run(name);
        lastModifiedVersion = Date.now();
        res.json({ id: result.lastInsertRowid, name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/channels/:id', (req, res) => {
    try {
        const { id } = req.params;
        db.prepare('DELETE FROM channels WHERE id=?').run(id);
        lastModifiedVersion = Date.now();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Locations API =====
app.get('/api/locations', (req, res) => {
    try {
        const locations = db.prepare('SELECT * FROM locations ORDER BY name').all();
        res.json(locations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/locations', (req, res) => {
    try {
        const { name } = req.body;
        const stmt = db.prepare('INSERT OR IGNORE INTO locations (name) VALUES (?)');
        const result = stmt.run(name);
        lastModifiedVersion = Date.now();
        res.json({ id: result.lastInsertRowid, name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/locations/:id', (req, res) => {
    try {
        const { id } = req.params;
        db.prepare('DELETE FROM locations WHERE id=?').run(id);
        lastModifiedVersion = Date.now();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Data Migration API =====
app.post('/api/migrate', (req, res) => {
    try {
        const { filaments, brands, types, channels } = req.body;

        // Migrate brands
        if (brands && brands.length > 0) {
            const brandStmt = db.prepare('INSERT OR IGNORE INTO brands (name) VALUES (?)');
            brands.forEach(b => brandStmt.run(b.name));
        }

        // Migrate types
        if (types && types.length > 0) {
            const typeStmt = db.prepare(`
        INSERT OR IGNORE INTO types (brand, typeName, minNozzle, maxNozzle, minBed, maxBed)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
            types.forEach(t => typeStmt.run(t.brand, t.typeName, t.minNozzle, t.maxNozzle, t.minBed, t.maxBed));
        }

        // Migrate channels
        if (channels && channels.length > 0) {
            const channelStmt = db.prepare('INSERT OR IGNORE INTO channels (name) VALUES (?)');
            channels.forEach(c => channelStmt.run(c.name));
        }

        // Migrate filaments
        if (filaments && filaments.length > 0) {
            const filamentStmt = db.prepare(`
        INSERT INTO filaments (brand, type, color, weight, status, minNozzle, maxNozzle, 
                               minBed, maxBed, purchaseDate, purchasePrice, purchaseChannel, 
                               location, imageBlob, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

            filaments.forEach(f => {
                filamentStmt.run(
                    f.brand, f.type, f.color, f.weight, f.status,
                    f.minNozzle, f.maxNozzle, f.minBed, f.maxBed,
                    f.purchaseDate, f.purchasePrice, f.purchaseChannel,
                    f.location || '', f.imageBlob, f.createdAt || Date.now()
                );
            });
        }

        lastModifiedVersion = Date.now();
        res.json({ success: true, message: 'Data migrated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== Local AI Proxy (LLaVA) =====
// ===== AI Proxy (Supports OpenAI Compatible & Local LLaVA) =====
app.post('/api/ai-proxy', async (req, res) => {
    try {
        // 1. Get Settings from DB
        const settings = db.prepare("SELECT * FROM settings WHERE key IN ('ai_api_key', 'ai_base_url', 'ai_model_name')").all();
        const config = {
            apiKey: '',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            modelName: 'qwen-vl-plus-latest'
        };
        settings.forEach(s => {
            if (s.key === 'ai_api_key') config.apiKey = s.value;
            if (s.key === 'ai_base_url') config.baseUrl = s.value;
            if (s.key === 'ai_model_name') config.modelName = s.value;
        });

        // 2. Construct Upstream URL
        // Ensure baseUrl is clean (no trailing slash)
        let baseUrl = config.baseUrl.replace(/\/+$/, '');
        // If user puts full path, respect it. If root, append /chat/completions
        let targetUrl = `${baseUrl}/chat/completions`;

        // Special handling for local Ollama if user sets base url to root ie http://locahost:11434
        // Ollama OpenAI compat is at /v1/chat/completions
        if (baseUrl.includes('11434') && !baseUrl.includes('/v1')) {
            targetUrl = `${baseUrl}/v1/chat/completions`;
        }

        // 3. Prepare Request to Upstream
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
        };

        const upstreamResponse = await fetch(targetUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(req.body)
        });

        if (!upstreamResponse.ok) {
            const errorText = await upstreamResponse.text();
            console.error('AI Proxy Upstream Error:', errorText);
            try {
                // Try to parse json error
                const errorJson = JSON.parse(errorText);
                res.status(upstreamResponse.status).json(errorJson);
            } catch (e) {
                res.status(upstreamResponse.status).json({ error: `Upstream Error: ${errorText}` });
            }
            return;
        }

        const data = await upstreamResponse.json();
        res.json(data);

    } catch (error) {
        console.error('AI Proxy Error:', error);
        res.status(500).json({ error: error.message });
    }
});



// ===== Settings API =====
app.get('/api/settings', (req, res) => {
    try {
        // Create settings table if not exists
        db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
        const settings = db.prepare('SELECT * FROM settings').all();
        const settingsObj = {};
        settings.forEach(s => {
            settingsObj[s.key] = s.value;
        });
        res.json(settingsObj);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/settings', (req, res) => {
    try {
        db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
        const { key, value } = req.body;
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        stmt.run(key, value);
        lastModifiedVersion = Date.now();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== System API =====
app.get('/api/version', (req, res) => {
    res.json({ version: lastModifiedVersion });
});

// --- 备份与恢复 API ---

// 下载备份文件
app.get('/api/backups/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        // 基础安全检查：防止目录遍历攻击
        if (filename.includes('..') || filename.includes('/')) {
            return res.status(400).send('非法的文件名');
        }

        const filepath = path.join(BACKUP_DIR, filename);
        if (fs.existsSync(filepath)) {
            res.download(filepath); // 设置 Content-Disposition 为 attachment 触发下载
        } else {
            res.status(404).send('文件不存在');
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 获取备份列表
app.get('/api/backups', (req, res) => {
    try {
        const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db'));
        const backups = files.map(f => {
            const stats = fs.statSync(path.join(BACKUP_DIR, f));
            return {
                name: f,
                size: stats.size,
                created: stats.birthtime
            };
        }).sort((a, b) => b.created - a.created);
        res.json(backups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 创建新备份 (手动触发)
app.post('/api/backups', async (req, res) => {
    try {
        // 先检查磁盘空间，必要时清理旧备份
        await maintainDiskSpace();

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backup-${timestamp}.db`;
        await doBackup(filename);
        res.json({ success: true, filename });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 优化的流式上传接口 (支持超大文件，不占用内存)
app.post('/api/backups/upload-stream', (req, res) => {
    const fileName = req.headers['x-file-name'];
    if (!fileName) return res.status(400).json({ error: 'Missing X-File-Name header' });

    // Decode filename
    const safeName = decodeURIComponent(fileName);
    if (!safeName.endsWith('.db')) {
        return res.status(400).json({ error: '仅支持 .db 格式' });
    }

    const tempPath = path.join(__dirname, `temp_upload_${Date.now()}.db`);
    const writeStream = fs.createWriteStream(tempPath);

    req.pipe(writeStream);

    writeStream.on('error', (err) => {
        console.error('File write error:', err);
        res.status(500).json({ error: '文件写入失败' });
    });

    req.on('end', () => {
        // 上传完成，进行校验
        let valid = false;
        let tempDb;
        try {
            tempDb = new Database(tempPath, { fileMustExist: true });
            const table = tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='filaments'").get();
            if (table) valid = true;
        } catch (e) {
            console.error('Database validation failed:', e);
        } finally {
            if (tempDb) tempDb.close();
        }

        if (!valid) {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            return res.status(400).json({ error: '无效的数据库文件或文件损坏' });
        }

        // 移动到备份目录
        const destName = path.basename(safeName).replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const destPath = path.join(BACKUP_DIR, destName);

        fs.renameSync(tempPath, destPath);
        res.json({ success: true });
    });
});

// 上传备份文件 (旧接口 - 兼容小文件)
app.post('/api/backups/upload', (req, res) => {
    const { fileData, fileName } = req.body;
    if (!fileData || !fileName) return res.status(400).json({ error: '缺少文件数据' });

    // 校验文件扩展名
    if (!fileName.endsWith('.db')) {
        return res.status(400).json({ error: '仅支持 .db 格式的数据库文件' });
    }

    const tempPath = path.join(__dirname, `temp_upload_${Date.now()}.db`);

    try {
        // 1. 保存为临时文件
        const buffer = Buffer.from(fileData, 'base64');
        fs.writeFileSync(tempPath, buffer);

        // 2. 校验 SQLite 文件格式与 Schema
        let valid = false;
        let tempDb;
        try {
            tempDb = new Database(tempPath, { fileMustExist: true });
            // 检查是否存在关键表 'filaments'
            const table = tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='filaments'").get();
            if (table) {
                valid = true;
            }
        } catch (e) {
            console.error('数据库校验失败:', e);
        } finally {
            if (tempDb) tempDb.close();
        }

        if (!valid) {
            fs.unlinkSync(tempPath);
            return res.status(400).json({ error: '无效的数据库文件: 缺少 filaments 表或文件损坏。' });
        }

        // 3. 移动到正式备份目录
        // 文件名安全处理
        const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const destPath = path.join(BACKUP_DIR, safeName);

        fs.renameSync(tempPath, destPath);

        res.json({ success: true, message: '备份上传并验证成功。' });

    } catch (err) {
        // 发生错误时清理临时文件
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        res.status(500).json({ error: err.message });
    }
});

// 执行恢复操作
app.post('/api/backups/restore', async (req, res) => {
    try {
        const { filename } = req.body;
        const backupPath = path.join(BACKUP_DIR, filename);
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: '备份文件未找到' });
        }

        // 关闭当前数据库连接
        db.close();

        // 恢复前创建当前数据的安全快照
        const safetyBackup = `pre-restore-${Date.now()}.db`;
        fs.copyFileSync(path.join(DATA_DIR, 'database.db'), path.join(BACKUP_DIR, safetyBackup));

        // 覆盖主数据库文件
        fs.copyFileSync(backupPath, path.join(DATA_DIR, 'database.db'));

        // 重启服务以重新加载数据库连接
        // Node.js 进程退出后，Docker 容器会自动重启 (depends on restart policy)
        res.json({ success: true, message: '恢复成功，服务正在重启...' });

        setTimeout(() => process.exit(0), 1000); // 1秒后退出进程
    } catch (err) {
        res.status(500).json({ error: err.message });
        process.exit(1); // 发生严重错误也退出
    }
});

// 删除备份文件
app.delete('/api/backups/:filename', (req, res) => {
    try {
        const filepath = path.join(BACKUP_DIR, req.params.filename);
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: '文件未找到' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 系统升级 API ---
// 接收 .tar.gz 升级包
app.post('/api/upgrade', (req, res) => {
    const { fileData, fileName } = req.body;
    if (!fileData || !fileName) return res.status(400).json({ error: '缺少文件数据' });

    try {
        const buffer = Buffer.from(fileData, 'base64');
        const savePath = path.join(__dirname, fileName);
        fs.writeFileSync(savePath, buffer);

        // 执行升级脚本
        // 1. 创建临时目录
        // 2. 解压文件
        // 3. 覆盖当前应用文件 (支持单层目录结构或直接平铺结构)
        const upgradeScript = `
            sleep 1
            TEMP_DIR="./upgrade_temp_${Date.now()}"
            mkdir -p "$TEMP_DIR"
            
            # 解压到临时目录
            tar -xzf "${fileName}" -C "$TEMP_DIR"
            
            # 删除压缩包
            rm "${fileName}"
            
            # 判断解压后的结构并移动文件
            COUNT=$(ls -1 "$TEMP_DIR" | wc -l)
            if [ "$COUNT" -eq 1 ] && [ -d "$TEMP_DIR"/$(ls -1 "$TEMP_DIR") ]; then
                # 情况A: 压缩包内包含一个根文件夹 -> 移动该文件夹内的所有内容
                SUBDIR=$(ls -1 "$TEMP_DIR")
                cp -rf "$TEMP_DIR/$SUBDIR/"* ./
            else
                # 情况B: 压缩包内直接是文件 -> 直接移动所有内容
                cp -rf "$TEMP_DIR/"* ./
            fi
            
            # 清理临时目录
            rm -rf "$TEMP_DIR"
            
            # 服务将在脚本执行完毕后由系统重启
        `;

        exec(upgradeScript, { cwd: __dirname }, (err) => {
            if (err) console.error('升级解压失败:', err);
        });

        res.json({ success: true, message: '升级包已接收，系统将更新并重启。' });

        // 延迟退出，确保脚本开始执行
        setTimeout(() => process.exit(0), 3000);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 后台任务与维护 ---

// 执行数据库物理备份 (通过复制文件)
async function doBackup(filename) {
    return new Promise((resolve, reject) => {
        try {
            // 强制 WAL Checkpoint 确保数据写入磁盘
            db.pragma('wal_checkpoint(RESTART)');
            fs.copyFileSync(path.join(DATA_DIR, 'database.db'), path.join(BACKUP_DIR, filename));
            resolve();
        } catch (e) {
            reject(e);
        }
    });
}

// 获取当前磁盘使用率 (%)
function getDiskUsage() {
    return new Promise(resolve => {
        exec('df -h . | tail -1 | awk \'{print $5}\'', (err, stdout) => {
            if (err) return resolve(0); // 失败时返回 0，避免误删除
            const p = parseInt(stdout.replace('%', ''));
            resolve(isNaN(p) ? 0 : p);
        });
    });
}

// 磁盘自动维护 (使用率 > 80% 时清理最旧备份)
async function maintainDiskSpace() {
    const usage = await getDiskUsage();
    if (usage > 80) {
        console.log(`磁盘使用率 ${usage}% > 80%, 开始清理旧备份...`);
        const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db'))
            .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).birthtime }))
            .sort((a, b) => a.time - b.time); // 按时间正序排列 (最旧在前)

        if (files.length > 0) {
            fs.unlinkSync(path.join(BACKUP_DIR, files[0].name));
            console.log(`已删除旧备份: ${files[0].name}`);
        }
    }
}

// Auto Backup Scheduler
setInterval(() => {
    checkAutoBackup();
}, 60 * 60 * 1000); // Check every hour

async function checkAutoBackup() {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'lastAutoBackup'").get();
        const lastBackup = row ? parseInt(row.value) : 0;
        const now = Date.now();
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;

        if (now - lastBackup > thirtyDays) {
            console.log('Performing monthly auto-backup...');
            await maintainDiskSpace();
            const filename = `autobackup-${new Date().toISOString().split('T')[0]}.db`;
            await doBackup(filename);

            db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('lastAutoBackup', now.toString());
            console.log('Auto-backup complete.');
        }
    } catch (e) {
        console.error('Auto-backup check failed:', e);
    }
}

// Initial check on startup
setTimeout(checkAutoBackup, 10000);

// Global Error Handlers
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    // Keep the process alive or exit gracefully depending on critical logic
    // For debugging, we log and maybe exit
    // process.exit(1); 
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});

// Start server
const portToUse = process.env.PORT || PORT;
app.listen(portToUse, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${portToUse}`);
});
