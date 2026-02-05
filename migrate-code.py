#!/usr/bin/env python3
import re

# Read the backup file
with open('app.js.backup', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove Dexie initialization and upgrade code
content = re.sub(
    r'// --- 1\. 核心数据驱动 ---.*?}\);',
    '''// --- 1. 核心数据驱动 (使用后端 API) ---
const API_BASE = window.location.origin;

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
    const res = await fetch(`${API_BASE}/api/filaments/${id}`, { method: 'DELETE' });
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
    const res = await fetch(`${API_BASE}/api/brands/${id}`, { method: 'DELETE' });
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
    const res = await fetch(`${API_BASE}/api/types/${id}`, { method: 'DELETE' });
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
    const res = await fetch(`${API_BASE}/api/channels/${id}`, { method: 'DELETE' });
    return await res.json();
  }
};''',
    content,
    flags=re.DOTALL
)

# Replace database operations
replacements = [
    # Filaments
    (r'await db\.filaments\.toArray\(\)', 'await API.getFilaments()'),
    (r'await db\.filaments\.orderBy\([^)]+\)\.reverse\(\)\.toArray\(\)', 'await API.getFilaments()'),
    (r'await db\.filaments\.put\(([^)]+)\)', 'await (item.id ? API.updateFilament(item.id, \\1) : API.createFilament(\\1))'),
    (r'await db\.filaments\.delete\(([^)]+)\)', 'await API.deleteFilament(\\1)'),
    (r'await db\.filaments\.get\(([^)]+)\)', 'await API.getFilaments().then(all => all.find(f => f.id === \\1))'),
    
    # Brands
    (r'await db\.brands\.toArray\(\)', 'await API.getBrands()'),
    (r'await db\.brands\.add\(\{[^}]*name:\s*([^}]+)\}\)', 'await API.createBrand(\\1)'),
    (r'await db\.brands\.delete\(([^)]+)\)', 'await API.deleteBrand(\\1)'),
    (r'await db\.brands\.where\([^)]+\)\.equalsIgnoreCase\(([^)]+)\)\.first\(\)', 
     'await API.getBrands().then(all => all.find(b => b.name.toLowerCase() === (\\1).toLowerCase()))'),
    (r'await db\.brands\.count\(\)', 'await API.getBrands().then(all => all.length)'),
    
    # Types
    (r'await db\.types\.toArray\(\)', 'await API.getTypes()'),
    (r'await db\.types\.add\(([^)]+)\)', 'await API.createType(\\1)'),
    (r'await db\.types\.delete\(([^)]+)\)', 'await API.deleteType(\\1)'),
    (r'await db\.types\.where\([^)]+\)\.first\(\)', 
     'await API.getTypes().then(all => all.find(t => t.brand === brandName && t.typeName === typeName))'),
    
    # Channels
    (r'await db\.channels\.toArray\(\)', 'await API.getChannels()'),
    (r'await db\.channels\.add\(\{[^}]*name:\s*([^}]+)\}\)', 'await API.createChannel(\\1)'),
    (r'await db\.channels\.delete\(([^)]+)\)', 'await API.deleteChannel(\\1)'),
    (r'await db\.channels\.where\([^)]+\)\.equalsIgnoreCase\(([^)]+)\)\.first\(\)',
     'await API.getChannels().then(all => all.find(c => c.name.toLowerCase() === (\\1).toLowerCase()))'),
]

for pattern, replacement in replacements:
    content = re.sub(pattern, replacement, content)

# Remove initDefaults function as data will be in server
content = re.sub(r'async function initDefaults\(\) \{.*?\n\}', '// initDefaults removed - data is now on server', content, flags=re.DOTALL)

# Write the modified content
with open('app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Migration complete!")
