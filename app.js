// --- 1. 核心数据驱动 ---
const db = new Dexie("FilamentPro_V3");
db.version(4).stores({
  filaments: "++id, brand, type, color, status, createdAt",
  brands: "++id, name",
  types: "++id, brand, typeName",
  channels: "++id, name"
}).upgrade(async tx => {
  // 迁移：为缺失 createdAt 的旧条目补齐时间戳
  await tx.table("filaments").toCollection().modify(f => {
    if (!f.createdAt) f.createdAt = Date.now();
  });
});

// 初始化静态默认值
async function initDefaults() {
  const brandCount = await db.brands.count();
  if (brandCount === 0) {
    await db.brands.bulkAdd([{ name: "eSUN" }, { name: "Bambu Lab" }, { name: "Generic" }]);
    await db.types.bulkAdd([
      { brand: "Generic", typeName: "PLA", minNozzle: 190, maxNozzle: 220, minBed: 50, maxBed: 60 },
      { brand: "Generic", typeName: "PETG", minNozzle: 220, maxNozzle: 240, minBed: 70, maxBed: 80 },
      { brand: "Generic", typeName: "ABS", minNozzle: 240, maxNozzle: 260, minBed: 90, maxBed: 110 }
    ]);
  }
  const channelCount = await db.channels.count();
  if (channelCount === 0) {
    await db.channels.bulkAdd([{ name: "淘宝" }, { name: "京东" }, { name: "拼多多" }, { name: "闲鱼" }, { name: "官方网站" }]);
  }

  // 迁移：将已有耗材中的位置导入到位置库
  try {
    const allFilaments = await db.filaments.toArray();
    const existingLocations = await db.locations.toArray();
    const existingNames = new Set(existingLocations.map(l => l.name.toLowerCase()));

    const usedLocations = [...new Set(allFilaments.map(f => f.location).filter(l => l && l.trim()))];
    for (const loc of usedLocations) {
      if (!existingNames.has(loc.toLowerCase())) {
        await db.locations.add({ name: loc });
        existingNames.add(loc.toLowerCase());
      }
    }
  } catch (e) {
    console.warn('Location migration failed:', e);
  }
}

// Init View Mode on Load
document.addEventListener('DOMContentLoaded', () => {
  // Call initViewMode if DOM is ready, or just call it directly since script is at bottom
  if (typeof initViewMode === 'function') initViewMode();
  if (typeof startAutoRefresh === 'function') startAutoRefresh();
});

// --- 2. 状态变量 ---
let stream = null;
let currentSourceImg = null;
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
let lastKnownServerVersion = 0;

// Auto Refresh Logic
function startAutoRefresh() {
  setInterval(async () => {
    try {
      // 避免在模态框打开时自动刷新，防止用户输入被打断
      if (document.getElementById('modal-overlay').style.display === 'flex') return;
      if (document.getElementById('type-modal-v3').style.display === 'flex') return;

      const res = await fetch('/api/version?t=' + Date.now());
      if (!res.ok) return;
      const data = await res.json();
      console.log('Auto-refresh check:', data.version, 'Local:', lastKnownServerVersion);

      // 初始化版本号
      if (lastKnownServerVersion === 0) {
        lastKnownServerVersion = data.version;
        return;
      }

      // 如果服务器版本更新，则刷新列表
      if (data.version > lastKnownServerVersion) {
        console.log('Detected new data version, refreshing...');
        lastKnownServerVersion = data.version;
        await renderFilaments();
      }
    } catch (e) {
      console.warn('Auto-refresh check failed:', e);
    }
  }, 10000); // Check every 10 seconds (optimized from 3s)
}

// 缓存 DOM 引用 (脚本在 body 底部，可直接初始化)
const runOcrBtn = document.getElementById('btn-run-ocr');
const ocrStatus = document.getElementById('ocr-status-msg');

// --- 3. UI 切换控制 ---
let currentViewMode = localStorage.getItem('view_mode') || 'grid';

function initViewMode() {
  toggleViewMode(currentViewMode);
}

function toggleViewMode(mode) {
  currentViewMode = mode;
  localStorage.setItem('view_mode', mode);

  const grid = document.getElementById('filament-grid');
  const btnGrid = document.getElementById('btn-view-grid');
  const btnList = document.getElementById('btn-view-list');

  if (mode === 'list') {
    grid.classList.add('list-view');
    btnList.classList.add('active');
    btnGrid.classList.remove('active');
  } else {
    grid.classList.remove('list-view');
    btnGrid.classList.add('active');
    btnList.classList.remove('active');
  }
}

function switchTab(tab) {
  document.getElementById('page-inventory').style.display = tab === 'inventory' ? 'block' : 'none';
  document.getElementById('page-config').style.display = tab === 'config' ? 'block' : 'none';

  document.getElementById('page-config').style.display = tab === 'config' ? 'block' : 'none';

  if (tab === 'inventory') renderFilaments();
  else {
    renderConfig();
    if (typeof loadBackups === 'function') loadBackups(); // Load backups when switching to config
  }
}

function resetAndGoHome() {
  clearFilters();
  switchTab('inventory');
}

function togglePresetList() {
  const moreDiv = document.getElementById('preset-list-more');
  const btn = document.getElementById('btn-toggle-presets');
  if (moreDiv.style.display === 'none') {
    moreDiv.style.display = 'block';
    btn.innerText = '收起列表';
  } else {
    moreDiv.style.display = 'none';
    // We need to know the count again, but simplest is just generic text or fetch current count if we want to be precise. 
    // Since we don't store "rest" count globally, '展开更多' is fine or we can count children.
    const count = moreDiv.children.length;
    btn.innerText = `展开全部 (${count} 个更多)`;
  }
}

function openAddModal(item = null) {
  // 状态重置与编辑模式判断
  currentSourceImg = null;
  document.getElementById('modal-title').innerText = item ? '编辑耗材信息' : '添加新耗材';
  document.getElementById('btn-save-filament').dataset.editId = item ? item.id : '';

  // 重置 UI 显示
  document.getElementById('img-preview').style.display = 'none';
  const videoPreview = document.getElementById('video-preview');
  videoPreview.style.display = 'block';
  document.getElementById('ai-debug-container').style.display = 'none';
  document.getElementById('ai-raw-output').innerText = '';

  ocrStatus.innerText = '等待图片上传...';
  ocrStatus.style.color = 'var(--accent-blue)';
  runOcrBtn.disabled = true;
  runOcrBtn.style.opacity = '0.5';

  runOcrBtn.disabled = true;
  runOcrBtn.style.opacity = '0.5';

  // Layout: Hide viewport initially on ALL devices (PC & Mobile) to keep UI clean
  const ocrViewport = document.querySelector('.ocr-viewport');
  ocrViewport.style.display = 'none';

  // Edit Mode Logic: Hide OCR card if editing
  const ocrCard = document.querySelector('.ocr-card');
  if (item) {
    ocrCard.style.display = 'none';
  } else {
    ocrCard.style.display = 'flex';
  }

  // 填充/重置字段
  document.getElementById('entry-brand').value = item ? item.brand : '';
  document.getElementById('entry-type').value = item ? item.type : '';
  document.getElementById('entry-color').value = item ? (item.color || '') : '';
  document.getElementById('entry-weight').value = item ? (item.weight || '') : '';
  document.getElementById('entry-status').value = item ? item.status : 'Sealed';
  document.getElementById('entry-nozzle-min').value = item ? (item.minNozzle || '') : '';
  document.getElementById('entry-nozzle-max').value = item ? (item.maxNozzle || '') : '';
  document.getElementById('entry-bed-min').value = item ? (item.minBed || '') : '';
  document.getElementById('entry-bed-max').value = item ? (item.maxBed || '') : '';

  // 新字段
  document.getElementById('entry-purchase-date').value = item ? (item.purchaseDate || '') : new Date().toISOString().split('T')[0];
  document.getElementById('entry-purchase-price').value = item ? (item.purchasePrice || '') : '';
  document.getElementById('entry-purchase-channel').value = item ? (item.purchaseChannel || '') : '';
  document.getElementById('entry-location').value = item ? (item.location || '') : '';

  // 记录并显示识别图片/存档图片
  window.lastIdentifiedImg = item ? item.imageBlob : null;
  const savedImgContainer = document.getElementById('modal-img-saved-container');
  const savedImgPreview = document.getElementById('modal-img-saved');

  if (window.lastIdentifiedImg) {
    savedImgPreview.style.backgroundImage = `url(${window.lastIdentifiedImg})`;
    savedImgContainer.style.display = 'block';
  } else {
    savedImgContainer.style.display = 'none';
  }

  document.getElementById('modal-overlay').style.display = 'flex';

  // 强制重置滚动位置到顶部 (解决手机端记忆滚动位置导致看不到头部的问题)
  const formSection = document.querySelector('.form-section');
  if (formSection) formSection.scrollTop = 0;

  updateAllSelects().then(() => {
    if (item) {
      document.getElementById('entry-brand').value = item.brand;
      document.getElementById('entry-type').value = item.type;
    }
    // Update clear icons for initial state
    updateClearIconVisibility('brand');
    updateClearIconVisibility('type');
    updateClearIconVisibility('channel');
  });

  if (!item) {
    if (isMobile) {
      // 移动端不自动开启实时摄像头，节省资源并避免权限弹窗干扰
      video.style.display = 'none';
      ocrOverlay.style.display = 'none';
      ocrStatus.innerText = '等待拍照或上传...';
    } else {
      startCamera();
    }
  }
}

function closeAddModal() {
  stopCamera();
  document.getElementById('modal-overlay').style.display = 'none';
}

function viewFullImage() {
  if (window.lastIdentifiedImg) {
    document.getElementById('image-viewer-img').src = window.lastIdentifiedImg;
    document.getElementById('image-viewer-modal').style.display = 'flex';
  } else {
    alert("暂无图片可供查看");
  }
}

function closeImageModal() {
  document.getElementById('image-viewer-modal').style.display = 'none';
}

function setFilterAndRender(field, value) {
  const el = document.getElementById(`filter-${field}`);
  if (el) {
    // 切换逻辑：如果点击的是已经激活的，则取消筛选
    if (el.value === value) el.value = '';
    else el.value = value;

    renderFilaments();
    // 自动滚动到列表顶部以便观察变化
    document.querySelector('main').scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function handlePillClick(field, value) {
  setFilterAndRender(field, value);
}

function getDropdownInputId(key) {
  return key === 'channel' ? 'entry-purchase-channel' : `entry-${key}`;
}

function clearDropdownInput(key, event) {
  if (event) event.stopPropagation(); // Prevent triggering other clicks
  const input = document.getElementById(getDropdownInputId(key));
  if (input) {
    input.value = '';
    input.focus();
  }
  // Update icon visibility
  updateClearIconVisibility(key);
  // Show full dropdown
  openDropdown(key, true);
}

function updateClearIconVisibility(key) {
  const input = document.getElementById(getDropdownInputId(key));
  if (!input) return;
  const val = input.value;
  const icon = document.getElementById(`clear-${key}`);
  if (icon) icon.style.display = val ? 'block' : 'none';
}

// 辅助：颜色映射
// 辅助：颜色映射 (模糊匹配)
function getColorHex(colorName) {
  if (!colorName) return '#eee';
  const name = colorName.trim().toLowerCase();

  const colors = [
    { headers: ['red', '红'], hex: '#ff4d4f' },
    { headers: ['orange', '橙'], hex: '#ffa940' },
    { headers: ['yellow', 'gold', '黄', '金'], hex: '#ffec3d' },
    { headers: ['green', '绿'], hex: '#73d13d' },
    { headers: ['cyan', '青'], hex: '#36cfc9' },
    { headers: ['blue', '蓝'], hex: '#40a9ff' },
    { headers: ['purple', 'violet', '紫'], hex: '#9254de' },
    { headers: ['black', '黒', '黑'], hex: '#262626' },
    { headers: ['white', '白'], hex: '#ffffff' },
    { headers: ['grey', 'gray', 'silver', '灰', '银'], hex: '#8c8c8c' },
    { headers: ['pink', '粉'], hex: '#ff85c0' },
    { headers: ['brown', '棕', '褐'], hex: '#873800' },
    { headers: ['transparent', 'clear', '透'], hex: 'rgba(0,0,0,0.1)' }, // 透明稍微带点灰边框
    { headers: ['flesh', 'skin', '肤'], hex: '#e6a23c' }
  ];

  for (const c of colors) {
    if (c.headers.some(h => name.includes(h))) {
      return c.hex;
    }
  }

  // Default fallback
  return '#eee';
}

// --- 4. 摄像头与 OCR 逻辑 ---
const video = document.getElementById('video-preview');
const ocrOverlay = document.getElementById('ocr-overlay');

async function startCamera() {
  // 在移动端，我们不再尝试使用 getUserMedia 实时预览，因为它在很多浏览器和非 HTTPS 下不稳定
  // 改为直接引导用户使用点击按钮后的原生拍照
  if (isMobile) {
    video.style.display = 'none';
    ocrOverlay.style.display = 'none';
    ocrStatus.innerText = '请点击“拍照识别”或“上传图片”';
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn("getUserMedia not supported");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    document.querySelector('.ocr-viewport').style.display = 'flex'; // Ensure viewport is visible for camera
    video.style.display = 'block';
    video.srcObject = stream;
    video.play();
    ocrOverlay.style.display = 'block';
    document.getElementById('img-preview').style.display = 'none';
  } catch (err) {
    console.error("Camera access failed:", err);
  }
}

function triggerNativeCamera() {
  // 回退方案：直接触发 native input
  document.getElementById('input-camera-native').click();
}

function stopCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  ocrOverlay.style.display = 'none';
}

// --- 移除已失效的 btn-snap 监听 ---

// 已合并至 HTML 内联调用，此处移除冗余监听

// 已合并至 input-camera-native，此处移除冗余监听

// --- 5. 图像识别 (OCR) 核心逻辑 ---

// 图像压缩与调整尺寸辅助函数
async function resizeImageDataURL(dataUrl, maxWidth = 1000, maxHeight = 1000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      // 启用图像平滑以保证缩影图质量
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      // 使用 JPEG 格式和 0.75 的质量，平衡体积与清晰度
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.src = dataUrl;
  });
}

function handleImageFile(files, autoOCR = false) {
  const file = files[0];
  if (!file) return;

  // 停止现有摄像头流 (如果有)
  if (stream) stopCamera();

  ocrStatus.innerText = '⌛ 正在加载预览图...';
  ocrStatus.style.color = 'var(--accent-blue)';

  const reader = new FileReader();
  reader.onerror = () => {
    ocrStatus.innerText = '❌ 图片加载失败，请重试';
    ocrStatus.style.color = 'var(--danger)';
  };

  reader.onload = async (e) => {
    const img = new Image();
    img.onerror = () => {
      ocrStatus.innerText = '❌ 无效的图片文件';
      ocrStatus.style.color = 'var(--danger)';
    };
    img.onload = async () => {
      // 记录当前源图 (用于后续可能的旋转/重新识别)
      currentSourceImg = img;

      // 压缩并调整尺寸后再存储
      const compressedDataUrl = await resizeImageDataURL(e.target.result);
      window.lastIdentifiedImg = compressedDataUrl;

      // 更新预览
      const preview = document.getElementById('img-preview'); // Changed from ocr-preview-img to img-preview
      preview.style.backgroundImage = `url(${compressedDataUrl})`; // Changed from .src to .style.backgroundImage
      preview.style.display = 'block';

      // Ensure viewport is visible when image is loaded
      document.querySelector('.ocr-viewport').style.display = 'flex';

      const savedImgContainer = document.getElementById('modal-img-saved-container');
      const savedImgPreview = document.getElementById('modal-img-saved');
      savedImgPreview.style.backgroundImage = `url(${compressedDataUrl})`;
      savedImgContainer.style.display = 'block';

      video.style.display = 'none';
      ocrOverlay.style.display = 'none';
      runOcrBtn.disabled = false;
      runOcrBtn.style.opacity = '1';
      ocrStatus.innerText = '✅ 图片就绪';
      ocrStatus.style.color = 'var(--accent-color)';

      if (autoOCR) { processOCR(img); }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// 供“重新识别”按钮调用
async function processOCRFromCurrent() {
  if (currentSourceImg) {
    processOCR(currentSourceImg);
  } else if (stream) {
    processOCR(video);
  } else {
    ocrStatus.innerText = '⚠️ 请先获取图片';
  }
}

// 已合并至 HTML 内联调用

async function processOCR(source) {
  ocrStatus.innerText = '⚡ AI 正在深度分析中...';
  ocrStatus.style.color = 'var(--accent-purple)';
  runOcrBtn.disabled = true;
  runOcrBtn.style.opacity = '0.5';

  ocrOverlay.style.borderWidth = '4px';
  ocrOverlay.style.borderColor = '#fff';
  ocrOverlay.style.boxShadow = '0 0 30px #fff';

  // 图像预处理辅助函数：统一 1000px/0.75 质量
  const preprocessImage = (angle) => {
    const tmpCanvas = document.createElement('canvas');
    const tmpCtx = tmpCanvas.getContext('2d');
    const origWidth = source.videoWidth || source.width;
    const origHeight = source.videoHeight || source.height;

    let targetWidth = origWidth;
    let targetHeight = origHeight;
    const maxDim = 1000;

    if (targetWidth > targetHeight) {
      if (targetWidth > maxDim) {
        targetHeight *= maxDim / targetWidth;
        targetWidth = maxDim;
      }
    } else {
      if (targetHeight > maxDim) {
        targetWidth *= maxDim / targetHeight;
        targetHeight = maxDim;
      }
    }

    if (angle === 90 || angle === 270) {
      tmpCanvas.width = targetHeight;
      tmpCanvas.height = targetWidth;
    } else {
      tmpCanvas.width = targetWidth;
      tmpCanvas.height = targetHeight;
    }

    tmpCtx.save();
    tmpCtx.imageSmoothingEnabled = true;
    tmpCtx.imageSmoothingQuality = 'high';
    // 识别时适当增强对比度有助于提高准确率
    tmpCtx.filter = 'contrast(120%) brightness(105%)';

    if (angle !== 0) {
      tmpCtx.translate(tmpCanvas.width / 2, tmpCanvas.height / 2);
      tmpCtx.rotate(angle * Math.PI / 180);
      tmpCtx.drawImage(source, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
    } else {
      tmpCtx.drawImage(source, 0, 0, targetWidth, targetHeight);
    }
    tmpCtx.restore();
    return tmpCanvas.toDataURL('image/jpeg', 0.75);
  };

  try {
    const dataUrl = source.tagName === 'VIDEO' ? preprocessImage(0) : source.src;
    window.lastIdentifiedImg = dataUrl;

    // 同步更新预览图
    const savedImgPreview = document.getElementById('modal-img-saved');
    savedImgPreview.style.backgroundImage = `url(${dataUrl})`;
    savedImgPreview.style.display = 'block';

    // 关键升级：集成用户配置的 AI 参数
    const settings = await window.getAISettings();
    const MODEL = settings.modelName || 'qwen-vl-plus-latest';
    const isLocal = MODEL.toLowerCase().includes('llava') || MODEL.toLowerCase().includes('local');

    if (!isLocal && !settings.apiKey) {
      ocrStatus.innerText = '⚠️ 请先在“系统设置”中配置 AI API Key';
      ocrStatus.style.color = 'var(--danger)';
      return;
    }

    const API_KEY = settings.apiKey;
    const BASE_URL = settings.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

    let rawContent = "";

    // 统一通过服务端代理请求 AI (解决 CORS 及 HTTPS 混用问题)
    const API_URL = `${window.location.origin}/api/ai-proxy`;

    // 构建标准的 OpenAI Chat 格式请求体
    const requestBody = {
      model: MODEL,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "你是一位精通3D打印耗材识别的专家。请分析这张标签，并返回严格的 JSON 格式：{brand: '厂家', type: '材质(如PLA/PETG/ABS等)', color: '颜色(中文)', weight: 数字(单位kg), price: 数字(如果能看到价格), purchaseDate: 'YYYY-MM-DD'(如果能看到日期), minNozzle: 数字, maxNozzle: 数字, minBed: 数字, maxBed: 数字}。提示：重点识别 Nozzle/Bed Printing Temperature Range。必须仅返回 JSON，不要解释。" },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }],
      max_tokens: 1000
    };

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      let errorHint = `Status: ${response.status}`;
      try {
        const errBody = await response.json();
        if (errBody.error?.message) errorHint += ` - ${errBody.error.message}`;
        else if (errBody.error) errorHint += ` - ${JSON.stringify(errBody.error)}`;
      } catch (e) {
        const txt = await response.text();
        if (txt) errorHint += ` - ${txt.substring(0, 100)}`;
      }
      throw new Error(`AI 服务请求失败 (${errorHint})`);
    }

    const result = await response.json();
    // 兼容 OpenAI 格式
    if (result.choices && result.choices[0] && result.choices[0].message) {
      rawContent = result.choices[0].message.content;
    } else {
      // 尝试兼容非标准返回
      rawContent = result.result || result.content || JSON.stringify(result);
    }

    document.getElementById('ai-debug-container').style.display = 'block';
    document.getElementById('ai-raw-output').innerText = rawContent;

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 返回内容不包含有效的 JSON 格式');
    const aiData = JSON.parse(jsonMatch[0]);

    console.log("AI Analysis Result:", aiData);

    // 关键改变：应用预设，但随后使用 AI 识别值覆盖它 (实现 AI 优先级)
    if (aiData.type) {
      document.getElementById('entry-type').value = aiData.type.toUpperCase();
      await applyTypePresets(true); // 先加载数据库默认温度
    }

    let detectedCount = 0;
    if (aiData.brand) { document.getElementById('entry-brand').value = aiData.brand; detectedCount++; }
    if (aiData.color) { document.getElementById('entry-color').value = aiData.color; detectedCount++; }
    if (aiData.weight) { document.getElementById('entry-weight').value = aiData.weight; detectedCount++; }
    if (aiData.price) { document.getElementById('entry-purchase-price').value = aiData.price; }

    // Purchase Date Logic
    if (aiData.purchaseDate) {
      document.getElementById('entry-purchase-date').value = aiData.purchaseDate;
    } else {
      // Default to today if not found (though openAddModal sets this, AI might overwrite or we just reinforce it)
      document.getElementById('entry-purchase-date').value = new Date().toISOString().split('T')[0];
    }

    // AI 识别出的温度具有最高优先级
    if (aiData.minNozzle) { document.getElementById('entry-nozzle-min').value = aiData.minNozzle; detectedCount++; }
    if (aiData.maxNozzle) document.getElementById('entry-nozzle-max').value = aiData.maxNozzle;
    if (aiData.minBed) { document.getElementById('entry-bed-min').value = aiData.minBed; detectedCount++; }
    if (aiData.maxBed) document.getElementById('entry-bed-max').value = aiData.maxBed;

    if (detectedCount > 0) {
      ocrStatus.innerText = `✅ AI 分析成功！已提取 ${detectedCount} 项核心参数`;
      ocrStatus.style.color = 'var(--accent-color)';
    } else {
      ocrStatus.innerText = '❌ AI 识别失败：建议切换角度或光照后重试';
      ocrStatus.style.color = 'var(--danger)';
    }

  } catch (e) {
    ocrStatus.innerText = '⚠️ 识别出错：' + e.message;
    ocrStatus.style.color = 'var(--danger)';
    console.error(e);
  } finally {
    ocrOverlay.style.borderWidth = '1px';
    ocrOverlay.style.borderColor = 'var(--accent-blue)';
    ocrOverlay.style.boxShadow = 'none';
    runOcrBtn.disabled = false;
    runOcrBtn.style.opacity = '1';
    if (stream && isMobile) stopCamera();
  }
}

// --- 5. 数据联动 ---
async function applyTypePresets(isAIPriority = false) {
  const typeName = document.getElementById('entry-type').value;
  const brandName = document.getElementById('entry-brand').value;

  let config = await db.types.where({ brand: brandName, typeName: typeName }).first();
  if (!config) config = await db.types.where({ brand: "Generic", typeName: typeName }).first();

  if (config) {
    // 如果是手动选择导致的触发，或者当前字段为空，则填充
    const fields = [
      { id: 'entry-nozzle-min', val: config.minNozzle },
      { id: 'entry-nozzle-max', val: config.maxNozzle },
      { id: 'entry-bed-min', val: config.minBed },
      { id: 'entry-bed-max', val: config.maxBed }
    ];

    fields.forEach(f => {
      const el = document.getElementById(f.id);
      if (!isAIPriority || !el.value) { // 只有在非 AI 优先模式，或者字段为空时才应用预设
        el.value = f.val;
      }
    });
  }
}

async function updateAllSelects() {
  const brands = await db.brands.toArray();
  const types = await db.types.toArray();

  // 关键：按拼音首字母排序 (Case-insensitive)
  // 关键：按拼音首字母排序 (Case-insensitive) & 严格去重
  const uniqueBrandNames = [...new Set(brands.map(b => b.name))].sort((a, b) => a.localeCompare(b, 'zh'));
  const uniqueTypes = [...new Set(types.map(t => t.typeName))].sort((a, b) => a.localeCompare(b, 'zh'));

  // 1. 填充 Custom Dropdowns
  populateCustomDropdown('brand', uniqueBrandNames);
  populateCustomDropdown('type', uniqueTypes);

  const channels = await db.channels.toArray();
  const uniqueChannelNames = [...new Set(channels.map(c => c.name))].sort((a, b) => a.localeCompare(b, 'zh'));
  populateCustomDropdown('channel', uniqueChannelNames);

  // 1.5 填充 Location Dropdown (从 locations 设置库中提取)
  const locations = await db.locations.toArray();
  const uniqueLocations = [...new Set(locations.map(l => l.name))].sort((a, b) => a.localeCompare(b, 'zh'));
  populateCustomDropdown('location', uniqueLocations);

  // 2. 填充 传统的 selects (设置页和过滤器)
  const bSelectHtml = uniqueBrandNames.map(b => `<option value="${b}">${b}</option>`).join('');
  const tSelectHtml = uniqueTypes.map(t => `<option value="${t}">${t}</option>`).join('');

  // 关键：获取所有现有颜色用于过滤
  const allFilaments = await db.filaments.toArray();
  const uniqueColors = [...new Set(allFilaments.map(f => f.color || '常规色'))].sort((a, b) => a.localeCompare(b, 'zh'));
  const cSelectHtml = uniqueColors.map(c => `<option value="${c}">${c}</option>`).join('');

  document.getElementById('conf-brand').innerHTML = bSelectHtml;
  const fBrand = document.getElementById('filter-brand');
  const fType = document.getElementById('filter-type');
  const fColor = document.getElementById('filter-color');

  if (fBrand) fBrand.innerHTML = '<option value="">所有品牌</option>' + bSelectHtml;
  if (fType) fType.innerHTML = '<option value="">所有材质</option>' + tSelectHtml;
  if (fColor) fColor.innerHTML = '<option value="">所有颜色</option>' + cSelectHtml;
}

// --- 5.1 Custom Dropdown Logic ---
let dropdownData = { brand: [], type: [], channel: [] };

function populateCustomDropdown(key, items) {
  dropdownData[key] = items;
  renderDropdownItems(key, items);
}

function renderDropdownItems(key, items) {
  const ul = document.getElementById(`dropdown-${key}`);
  if (!ul) return;

  if (items.length === 0) {
    ul.innerHTML = `<li style="color:var(--text-muted); padding:8px; cursor:default;">无匹配项</li>`;
  } else {
    ul.innerHTML = items.map(item =>
      `<li onmousedown="selectDropdownItem('${key}', '${item}')">${item}</li>`
    ).join('');
    // Note: use onmousedown to fire before blur
  }
}

function filterDropdown(key) {
  const input = document.getElementById(getDropdownInputId(key));
  if (!input) return;
  const query = input.value.toLowerCase();
  updateClearIconVisibility(key); // Update clear icon
  const filtered = dropdownData[key].filter(item => item.toLowerCase().includes(query));
  renderDropdownItems(key, filtered);
  document.getElementById(`${key}-wrapper`).classList.add('active');
}

function toggleDropdown(key) {
  const wrapper = document.getElementById(`${key}-wrapper`);
  if (wrapper.classList.contains('active')) closeDropdown(key);
  else {
    openDropdown(key, true); // Force show all on click
    document.getElementById(`entry-${key}`).focus();
  }
}

function openDropdown(key, forceShowAll = false) {
  // Close others
  ['brand', 'type', 'channel'].forEach(k => { if (k !== key) closeDropdown(k); });

  const wrapper = document.getElementById(`${key}-wrapper`);
  wrapper.classList.add('active');

  const val = document.getElementById(getDropdownInputId(key)).value;
  // If forced (click/focus) OR empty, show all. Otherwise filter.
  if (forceShowAll || !val) {
    renderDropdownItems(key, dropdownData[key]);
  } else {
    filterDropdown(key);
  }
}

function closeDropdown(key) {
  document.getElementById(`${key}-wrapper`).classList.remove('active');
}

function delayCloseDropdown(key) {
  setTimeout(() => closeDropdown(key), 200);
}

function selectDropdownItem(key, value) {
  const input = document.getElementById(getDropdownInputId(key));
  if (input) {
    input.value = value;
    updateClearIconVisibility(key); // Update clear icon
  }

  // Trigger change events if needed
  if (key === 'type') applyTypePresets();
  closeDropdown(key);
}

function clearFilters() {
  const fields = ['filter-brand', 'filter-type', 'filter-color', 'filter-status', 'filter-channel', 'filter-location'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderFilaments();
}

// --- 6. 耗材渲染与操作 ---
async function renderFilaments() {
  const getVal = (id) => document.getElementById(id)?.value || '';
  const brand = getVal('filter-brand');
  const type = getVal('filter-type');
  const color = getVal('filter-color');
  const status = getVal('filter-status');
  const channel = getVal('filter-channel');
  const location = getVal('filter-location');

  let items = [];
  try {
    // 优先使用索引排序
    items = await db.filaments.orderBy('createdAt').reverse().toArray();
  } catch (err) {
    console.warn("IndexedDB 排序查询失败，尝试内存排序:", err);
    // 兜底方案：先取全量数据，再在 JS 中手动排序 (防止旧版本索引残留导致的加载失败)
    items = await db.filaments.toArray();
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  // 更新本地已知的 Version，防止刷新后立即再次触发
  if (db.filaments.lastServerVersion && db.filaments.lastServerVersion > lastKnownServerVersion) {
    lastKnownServerVersion = db.filaments.lastServerVersion;
  }

  if (brand) {
    if (brand === '未知品牌') items = items.filter(i => !i.brand);
    else items = items.filter(i => i.brand === brand);
  }
  if (type) {
    if (type === '未知材质') items = items.filter(i => !i.type);
    else items = items.filter(i => i.type === type);
  }
  if (color) items = items.filter(i => (i.color || '常规色') === color);
  if (status) items = items.filter(i => i.status === status);
  if (channel) {
    if (channel === '未知渠道') items = items.filter(i => !i.purchaseChannel);
    else items = items.filter(i => (i.purchaseChannel || '') === channel);
  }
  if (location) {
    if (location === '未指定') items = items.filter(i => !i.location);
    else items = items.filter(i => (i.location || '') === location);
  }

  // Sorting Logic
  const sortValue = document.getElementById('sort-select') ? document.getElementById('sort-select').value : 'default';
  if (sortValue !== 'default') {
    items.sort((a, b) => {
      const dateA = a.purchaseDate || (sortValue === 'oldest' ? '9999-99-99' : '0000-00-00');
      const dateB = b.purchaseDate || (sortValue === 'oldest' ? '9999-99-99' : '0000-00-00');
      // If dates are equal, fallback to ID (creation order)
      if (dateA === dateB) return (b.id || 0) - (a.id || 0);

      if (sortValue === 'oldest') {
        // Oldest first (Ascending)
        return dateA.localeCompare(dateB);
      } else {
        // Newest first (Descending)
        return dateB.localeCompare(dateA);
      }
    });
  }

  const brandMap = {};
  const typeMap = {};
  const colorMap = {};
  const channelMap = {};
  const locationMap = {};
  const statusMap = {};
  items.forEach(i => {
    const b = i.brand || '未知品牌';
    const t = i.type || '未知材质';
    const c = i.color || '常规色';
    const ch = i.purchaseChannel || '未知渠道';
    const loc = i.location || '未指定';
    const s = i.status || 'Unknown';
    brandMap[b] = (brandMap[b] || 0) + 1;
    typeMap[t] = (typeMap[t] || 0) + 1;
    colorMap[c] = (colorMap[c] || 0) + 1;
    channelMap[ch] = (channelMap[ch] || 0) + 1;
    locationMap[loc] = (locationMap[loc] || 0) + 1;
    statusMap[s] = (statusMap[s] || 0) + 1;
  });

  // 1. 更新顶部核心指标卡片
  document.getElementById('stat-total-count').innerText = items.length;
  document.getElementById('stat-inuse-count').innerText = items.filter(i => i.status === 'InUse').length;
  document.getElementById('stat-finished-count').innerText = items.filter(i => i.status === 'Finished').length;

  const totalValue = items.reduce((sum, item) => sum + (parseFloat(item.purchasePrice) || 0), 0);
  document.getElementById('stat-total-value').innerText = `¥${totalValue.toFixed(2)}`;

  // 2. 更新分类统计药丸标签
  const renderPills = (containerId, dataMap, filterField) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Sort keys alphabetically, except for status which has a specific order
    let sortedKeys = Object.keys(dataMap);
    if (filterField === 'status') {
      const statusOrder = ['Sealed', 'InUse', 'Finished', 'Unknown'];
      sortedKeys.sort((a, b) => statusOrder.indexOf(a) - statusOrder.indexOf(b));
    } else {
      sortedKeys.sort((a, b) => a.localeCompare(b, 'zh'));
    }

    const currentFilterEl = document.getElementById(`filter-${filterField}`);
    const currentFilterValue = currentFilterEl ? currentFilterEl.value : '';

    container.innerHTML = sortedKeys.map(key => {
      const count = dataMap[key];
      const isActive = currentFilterValue === key;

      // Status 翻译
      let displayKey = key;
      if (filterField === 'status') {
        const statusTranslations = { 'Sealed': '全新未拆', 'InUse': '使用中', 'Finished': '已用完', 'Unknown': '未知状态' };
        displayKey = statusTranslations[key] || key;
      }

      return `
        <div class="pill-label ${isActive ? 'active' : ''}" onclick="handlePillClick('${filterField}', '${key}')">
          ${filterField === 'color' ? `<span style="width:10px; height:10px; border-radius:50%; background:${getColorHex(key)}; border:1px solid rgba(0,0,0,0.1);"></span>` : ''}
          ${displayKey} <span class="count">${count}</span>
        </div>
      `;
    }).join('');
  };

  renderPills('class-brand', brandMap, 'brand');
  renderPills('class-type', typeMap, 'type');
  renderPills('class-color', colorMap, 'color');
  renderPills('class-status', statusMap, 'status'); // Add Status Pills
  renderPills('class-channel', channelMap, 'channel');
  renderPills('class-location', locationMap, 'location');

  const grid = document.getElementById('filament-grid');
  grid.innerHTML = items.map(f => `
    <div class="card-v3 filament-card">
      ${f.imageBlob ? `
        <div class="card-image" style="background-image: url(${f.imageBlob});"></div>
      ` : (f.hasImage ? `
        <div class="card-image lazy-image" data-id="${f.id}" style="background-color: rgba(0,0,0,0.05); display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:11px;">
          <div class="loading-spinner-small"></div>
        </div>
      ` : `
        <div class="card-image placeholder" style="display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text-muted); font-size:11px; background: rgba(0,0,0,0.02);">
          <i data-lucide="image-off" style="width:20px; margin-bottom:4px; opacity:0.3;"></i>
          <span>无图片</span>
        </div>
      `)}
      <div class="card-content">
        <div class="card-header">
          <div>
            <h4 class="filament-title">${f.brand} ${f.type}</h4>
            <p class="filament-subtitle">${f.color || '常规色'}</p>
          </div>
          <span class="status-label ${f.status === 'InUse' ? 'status-in-use' : (f.status === 'Finished' ? 'status-finished' : 'status-sealed')}">
            ${f.status === 'InUse' ? '使用中' : (f.status === 'Finished' ? '已耗尽' : '全新')}
          </span>
        </div>
        <div class="card-details">
          <div class="detail-item">
            <i data-lucide="thermometer"></i>
            <span>参数: ${f.minNozzle}-${f.maxNozzle}℃ / ${f.minBed}-${f.maxBed}℃</span>
          </div>
          <div class="detail-item">
            <i data-lucide="shopping-cart"></i>
            <span>渠道: ${f.purchaseChannel || '未知'} · ¥${f.purchasePrice || '--'}</span>
          </div>
          <div class="detail-item">
            <i data-lucide="scale"></i>
            <span>重量: ${f.weight || '1.0'} kg</span>
          </div>
          <div class="detail-item">
            <i data-lucide="clock"></i>
            <span>入库: ${f.purchaseDate || '未知'}</span>
          </div>
          <div class="detail-item">
            <i data-lucide="map-pin"></i>
            <span>位置: ${f.location || '未指定'}</span>
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button class="action-btn" onclick="editFilament(${f.id})">编辑</button>
        <button class="action-btn" onclick="updateStatus(${f.id}, 'InUse')">使用</button>
        <button class="action-btn" onclick="updateStatus(${f.id}, 'Finished')">耗尽</button>
        <button class="action-btn btn-danger" onclick="deleteFilament(${f.id})" title="删除">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </div>
    </div>
  `).join('');

  // 渲染图标，增加容错
  if (typeof lucide !== 'undefined') {
    try {
      lucide.createIcons();
    } catch (e) {
      console.warn('Lucide icons creation failed:', e);
    }
  }

  // 异步加载图片，不阻塞主列表渲染
  loadLazyImages();
}

// 简单的内存缓存，存储已加载图片的 Blob URL 或状态
// 键: filamentId, 值: blobUrl 或 'failed'
const imageCache = new Map();
let imageObserver = null;

// Concurrency Control
const MAX_CONCURRENT_IMG_LOADS = isMobile ? 4 : 8; // Higher concurrency for PC
let activeImgLoads = 0;
const imgLoadQueue = [];

function processImgQueue() {
  if (imgLoadQueue.length === 0 || activeImgLoads >= MAX_CONCURRENT_IMG_LOADS) return;

  activeImgLoads++;
  const { el, id } = imgLoadQueue.shift();

  doFetchImage(el, id).finally(() => {
    activeImgLoads--;
    processImgQueue();
  });
}

function loadLazyImages() {
  if (imageObserver) imageObserver.disconnect();

  if ('IntersectionObserver' in window) {
    imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          observer.unobserve(el);
          loadImageElement(el);
        }
      });
    }, { rootMargin: '500px 0px', threshold: 0.01 }); // Larger margin for faster pre-loading

    document.querySelectorAll('.lazy-image').forEach(el => imageObserver.observe(el));
  } else {
    document.querySelectorAll('.lazy-image').forEach(el => loadImageElement(el));
  }
}

async function loadImageElement(el) {
  const id = el.dataset.id;
  if (!id) return;

  // 1. Check Cache
  if (imageCache.has(id)) {
    const cached = imageCache.get(id);
    if (cached && cached !== 'failed') {
      applyImageToEl(el, cached);
    } else if (cached === 'failed') {
      el.innerHTML = '<span style="font-size:10px; color:var(--danger)">加载失败</span>'; // Remove spinner
    }
    return;
  }

  // 2. Queue Fetch
  imgLoadQueue.push({ el, id });
  processImgQueue();
}

async function doFetchImage(el, id) {
  try {
    // Timeout Promise
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(`/api/filaments/${id}/image`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data.imageBlob) {
        imageCache.set(id, data.imageBlob);
        applyImageToEl(el, data.imageBlob);
      } else {
        markImageFailed(el, id);
      }
    } else {
      markImageFailed(el, id);
    }
  } catch (err) {
    console.warn(`Failed to load image for ${id}:`, err);
    markImageFailed(el, id);
  }
}

function markImageFailed(el, id) {
  imageCache.set(id, 'failed');
  el.innerHTML = '<i data-lucide="image-off" style="width:16px; opacity:0.3;"></i>';
  el.classList.remove('lazy-image');
  // Re-run lucide if needed, but simple SVG might be better or just text
  if (typeof lucide !== 'undefined') {
    try { lucide.createIcons(); } catch (e) { }
  }
}

function applyImageToEl(el, blobUrl) {
  el.style.backgroundImage = `url(${blobUrl})`;
  el.innerText = '';
  el.classList.remove('lazy-image');
  // Optional: Add a fade-in effect
  el.style.opacity = 0;
  el.style.transition = 'opacity 0.3s ease';
  requestAnimationFrame(() => {
    el.style.opacity = 1;
  });
}

async function updateStatus(id, status) {
  console.log(`Updating status for ID ${id} to ${status}`);
  try {
    await db.filaments.update(id, { status });
    renderFilaments();
    // alert(`状态已更新: ${status === 'InUse' ? '使用中' : '已耗尽'}`); // Optional: feedback
  } catch (e) {
    console.error("Update failed:", e);
    alert("更新状态失败: " + e.message);
  }
}

async function deleteFilament(id) {
  if (confirm("删除该耗材记录？")) {
    await db.filaments.delete(id);
    renderFilaments();
  }
}

async function editFilament(id) {
  const item = await db.filaments.get(id);
  if (item) {
    openAddModal(item);
  }
}

// --- 7. 配置管理 ---
async function renderConfig() {
  const brands = await db.brands.toArray();
  document.getElementById('brand-list').innerHTML = brands.map(b => `
    <span class="status-label" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); display:flex; align-items:center; gap:6px;">
      ${b.name} <i data-lucide="x" style="width:12px; cursor:pointer;" onclick="deleteBrand(${b.id})"></i>
    </span>
  `).join('');

  const channels = await db.channels.toArray();
  document.getElementById('channel-list').innerHTML = channels.map(c => `
    <span class="status-label" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); display:flex; align-items:center; gap:6px;">
      ${c.name} <i data-lucide="x" style="width:12px; cursor:pointer;" onclick="deleteChannel(${c.id})"></i>
    </span>
  `).join('');

  const locations = await db.locations.toArray();
  document.getElementById('location-list').innerHTML = locations.map(l => `
    <span class="status-label" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); display:flex; align-items:center; gap:6px;">
      ${l.name} <i data-lucide="x" style="width:12px; cursor:pointer;" onclick="deleteLocation(${l.id})"></i>
    </span>
  `).join('');

  const types = await db.types.toArray();
  // Sort by Newest (ID desc)
  types.sort((a, b) => b.id - a.id);

  const renderItem = (t) => `
    <div style="padding:12px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
      <div>
        <p style="font-size: 14px; font-weight:600;">${t.brand} - ${t.typeName}</p>
        <p style="font-size: 11px; color:var(--text-muted)">温度: ${t.minNozzle}-${t.maxNozzle} / ${t.minBed}-${t.maxBed}℃</p>
      </div>
      <i data-lucide="minus-circle" style="width:16px; color:var(--danger); cursor:pointer;" onclick="deleteType(${t.id})"></i>
    </div>
  `;

  const top3 = types.slice(0, 3);
  const rest = types.slice(3);

  let html = top3.map(renderItem).join('');

  if (rest.length > 0) {
    html += `<div id="preset-list-more" style="display:none;">${rest.map(renderItem).join('')}</div>`;
    html += `
      <div style="text-align:center; padding:8px;">
        <button id="btn-toggle-presets" onclick="togglePresetList()" 
          style="background:none; border:none; color:var(--accent-blue); font-size:12px; cursor:pointer;">
          展开全部 (${rest.length} 个更多)
        </button>
      </div>
    `;
  } else if (types.length === 0) {
    html = '<p style="padding:12px; font-size:12px; color:var(--text-muted); text-align:center;">暂无预设</p>';
  }

  document.getElementById('type-config-list').innerHTML = html;

  if (typeof lucide !== 'undefined') {
    try { lucide.createIcons(); } catch (e) { }
  }
}

async function addBrand() {
  const name = document.getElementById('new-brand-name').value.trim();
  if (name) {
    // 检查重复
    const exists = await db.brands.where('name').equalsIgnoreCase(name).first();
    if (!exists) await db.brands.add({ name });
    document.getElementById('new-brand-name').value = '';
    renderConfig();
  }
}
async function deleteBrand(id) { await db.brands.delete(id); renderConfig(); }

async function addChannel() {
  const name = document.getElementById('new-channel-name').value.trim();
  if (name) {
    const exists = await db.channels.where('name').equalsIgnoreCase(name).first();
    if (!exists) await db.channels.add({ name });
    document.getElementById('new-channel-name').value = '';
    renderConfig();
  }
}
async function deleteChannel(id) { await db.channels.delete(id); renderConfig(); }

async function addLocation() {
  const name = document.getElementById('new-location-name').value.trim();
  if (name) {
    const exists = await db.locations.where('name').equalsIgnoreCase(name).first();
    if (!exists) await db.locations.add({ name });
    document.getElementById('new-location-name').value = '';
    renderConfig();
  }
}
async function deleteLocation(id) { await db.locations.delete(id); renderConfig(); }
async function showAddTypeModal() {
  updateAllSelects();
  document.getElementById('type-modal-v3').style.display = 'flex';
}
async function saveTypeConfig() {
  const conf = {
    brand: document.getElementById('conf-brand').value,
    typeName: document.getElementById('conf-type-name').value.toUpperCase(),
    minNozzle: parseInt(document.getElementById('conf-min-nozzle').value),
    maxNozzle: parseInt(document.getElementById('conf-max-nozzle').value),
    minBed: parseInt(document.getElementById('conf-min-bed').value),
    maxBed: parseInt(document.getElementById('conf-max-bed').value)
  };
  await db.types.add(conf);
  document.getElementById('type-modal-v3').style.display = 'none';
  renderConfig();
}
async function deleteType(id) { await db.types.delete(id); renderConfig(); }

// --- 8. 初始化入口 ---
document.getElementById('btn-save-filament').onclick = async function () {
  const saveBtn = this;
  const originalText = saveBtn.innerText;
  const editId = saveBtn.dataset.editId;
  const brand = document.getElementById('entry-brand').value.trim();
  const type = document.getElementById('entry-type').value.trim();
  const channel = document.getElementById('entry-purchase-channel').value.trim();

  if (!brand || !type) {
    alert("请填写品牌和材质");
    return;
  }

  // 禁用按钮并显示加载中状态
  saveBtn.disabled = true;
  saveBtn.innerText = '正在保存...';
  saveBtn.style.opacity = '0.7';

  const item = {
    brand: brand,
    type: type,
    color: document.getElementById('entry-color').value,
    weight: parseFloat(document.getElementById('entry-weight').value) || 1.0,
    minNozzle: parseInt(document.getElementById('entry-nozzle-min').value) || 200,
    maxNozzle: parseInt(document.getElementById('entry-nozzle-max').value) || 230,
    minBed: parseInt(document.getElementById('entry-bed-min').value) || 50,
    maxBed: parseInt(document.getElementById('entry-bed-max').value) || 70,
    status: document.getElementById('entry-status').value,
    purchaseDate: document.getElementById('entry-purchase-date').value,
    purchasePrice: document.getElementById('entry-purchase-price').value,
    purchaseChannel: channel,
    location: document.getElementById('entry-location').value.trim(),
    imageBlob: window.lastIdentifiedImg, // 保存被识别的图片
    createdAt: editId ? undefined : Date.now()
  };

  try {
    if (editId) {
      const oldItem = await db.filaments.get(parseInt(editId));
      item.id = parseInt(editId);
      if (!item.createdAt) item.createdAt = oldItem.createdAt;
      if (!item.imageBlob) item.imageBlob = oldItem.imageBlob;
      // location update is handled by item object
    }

    // 自动同步厂家/材质/渠道到各库
    const brandExists = await db.brands.where('name').equalsIgnoreCase(brand).first();
    if (brand && !brandExists) await db.brands.add({ name: brand });

    const channelExists = await db.channels.where('name').equalsIgnoreCase(channel).first();
    if (channel && !channelExists) await db.channels.add({ name: channel });

    const typeExists = await db.types.where({ brand: brand, typeName: type }).first();
    if (brand && type && !typeExists) {
      await db.types.add({
        brand: brand, typeName: type,
        minNozzle: item.minNozzle, maxNozzle: item.maxNozzle,
        minBed: item.minBed, maxBed: item.maxBed
      });
    }

    await db.filaments.put(item);

    // 清理全局变量
    window.lastIdentifiedImg = null;
    currentSourceImg = null;

    closeAddModal();

    // 关键：强制清空筛选并刷新所有数据
    clearFilters();
    await updateAllSelects();
    await renderFilaments(); // 确保列表刷新

    console.log("Filament saved successfully");
  } catch (err) {
    console.error("Save failed:", err);
    alert("保存失败: " + err.message);
  } finally {
    // 恢复按钮状态
    saveBtn.disabled = false;
    saveBtn.innerText = originalText;
    saveBtn.style.opacity = '1';
  }
};

document.getElementById('filter-brand').onchange = renderFilaments;
document.getElementById('filter-type').onchange = renderFilaments;
document.getElementById('filter-color').onchange = renderFilaments;
document.getElementById('filter-status').onchange = renderFilaments;

// Optimization: Parallel Boot
Promise.all([
  initDefaults(),
  loadAISettings()
]).then(() => {
  // These calls are now fast because of parallel checks and local cache in api-dexie
  updateAllSelects();
  switchTab('inventory');
});

if (typeof lucide !== 'undefined') {
  try { lucide.createIcons(); } catch (e) { }
}

// --- 9. AI 配置管理 ---
async function loadAISettings() {
  const settings = await window.getAISettings();
  const apiKeyEl = document.getElementById('ai-api-key');
  const baseUrlEl = document.getElementById('ai-base-url');
  const modelNameEl = document.getElementById('ai-model-name');

  if (apiKeyEl) {
    apiKeyEl.value = settings.apiKey || '';
    // Store real value for toggling
    apiKeyEl.dataset.realValue = settings.apiKey || '';
  }
  if (baseUrlEl) baseUrlEl.value = settings.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  if (modelNameEl) modelNameEl.value = settings.modelName || 'qwen-vl-plus-latest';
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('ai-api-key');
  const icon = document.getElementById('btn-toggle-key');
  const isPassword = input.getAttribute('type') === 'password';

  if (isPassword) {
    // Switch to Masked View
    const realVal = input.value;
    if (!realVal) return;

    input.dataset.realValue = realVal; // Sync latest input

    // Create mask: First 3 + **** + Last 3
    if (realVal.length > 6) {
      const mask = realVal.substring(0, 3) + '••••••' + realVal.substring(realVal.length - 3);
      input.setAttribute('type', 'text');
      input.value = mask;
    } else {
      // Too short to mask nicely, just show plain (or handled differently, but requirement implies long keys)
      input.setAttribute('type', 'text');
    }

    input.readOnly = true;
    icon?.setAttribute('data-lucide', 'eye-off');
    input.style.color = 'var(--text-muted)';
  } else {
    // Switch back to Edit/Password Mode
    input.value = input.dataset.realValue || '';
    input.setAttribute('type', 'password');
    input.readOnly = false;
    icon.setAttribute('data-lucide', 'eye');
    input.style.color = 'var(--text-main)';
  }
  if (typeof lucide !== 'undefined') {
    try { lucide.createIcons(); } catch (e) { }
  }
}

async function saveAISettings() {
  const input = document.getElementById('ai-api-key');
  // Critical: If in masked (readonly) mode, use the hidden real value. Otherwise use current input.
  let apiKey = input.readOnly ? (input.dataset.realValue || '') : input.value.trim();

  const baseUrl = document.getElementById('ai-base-url').value.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const modelName = document.getElementById('ai-model-name').value.trim() || 'qwen-vl-plus-latest';
  const statusEl = document.getElementById('ai-config-status');

  const isLocal = modelName.toLowerCase().includes('llava') || modelName.toLowerCase().includes('local');

  if (!isLocal && !apiKey) {
    showAIStatus('请输入 API Key', 'error');
    return;
  }

  if (isLocal) {
    showAIStatus('正在保存本地 AI 配置...', 'info');
    try {
      await fetch(`${window.location.origin}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'ai_api_key', value: apiKey || 'local-no-key' }) });
      await fetch(`${window.location.origin}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'ai_base_url', value: baseUrl }) });
      await fetch(`${window.location.origin}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'ai_model_name', value: modelName }) });
      input.dataset.realValue = apiKey || 'local-no-key';
      showAIStatus('本地 AI 配置已保存！', 'success');
      return;
    } catch (e) {
      showAIStatus('保存失败，请检查网络', 'error');
      return;
    }
  }

  showAIStatus('正在验证配置...', 'info');

  try {
    // Verify via Proxy
    const response = await fetch(`${window.location.origin}/api/ai-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      // Note: We need to temporarily save settings to DB first for proxy to use them, 
      // OR we send credentials in this test request.
      // However, /api/ai-proxy currently reads from DB. 
      // So we should save FIRST, then test. If fail, maybe warn user?
      // Or we can modify /api/ai-proxy to accept override config? No, that's insecure.
      // Let's optimistic save, then test.
    });

    // Actually, save first is better logic.
    // Save to server
    await fetch(`${window.location.origin}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'ai_api_key', value: apiKey }) });
    await fetch(`${window.location.origin}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'ai_base_url', value: baseUrl }) });
    await fetch(`${window.location.origin}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'ai_model_name', value: modelName }) });

    // Now test
    const testResp = await fetch(`${window.location.origin}/api/ai-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5
      })
    });

    if (testResp.ok) {
      input.dataset.realValue = apiKey;
      showAIStatus('保存并验证成功！', 'success');
    } else {
      const err = await testResp.json();
      showAIStatus(`配置保存成功，但在验证连接时失败: ${err.error?.message || JSON.stringify(err)}`, 'warning');
    }

    // Logic moved above (Save first, then verify)
    return;
  } catch (err) {
    showAIStatus(`连接失败: ${err.message}`, 'error');
  }
}

function showAIStatus(msg, type) {
  const el = document.getElementById('ai-config-status');
  if (!el) return;
  el.style.display = 'block';
  el.innerText = msg;
  el.style.background = type === 'success' ? 'rgba(76, 175, 80, 0.1)' : (type === 'error' ? 'rgba(244, 67, 54, 0.1)' : 'rgba(33, 150, 243, 0.1)');
  el.style.color = type === 'success' ? '#2e7d32' : (type === 'error' ? '#d32f2f' : '#1976d2');
  el.style.border = `1px solid ${type === 'success' ? '#2e7d32' : (type === 'error' ? '#d32f2f' : '#1976d2')}`;
}

// --- 7. 数据自动同步 ---
let lastLocalVersion = null;

async function syncWithServer() {
  try {
    // 触发一次获取，会更新 db.filaments.lastServerVersion
    const items = await db.filaments.toArray();
    const serverVersion = db.filaments.lastServerVersion;

    // 如果是第一次加载，或者版本不一致，则强制刷新 UI
    if (lastLocalVersion === null) {
      lastLocalVersion = serverVersion;
    } else if (serverVersion && serverVersion !== lastLocalVersion) {
      console.log("检测到服务端数据更新，正在同步:", serverVersion);
      lastLocalVersion = serverVersion;
      // 只有在没有打开模态框时才自动刷新，避免打断用户操作
      if (document.getElementById('modal-overlay').style.display !== 'flex') {
        renderFilaments();
      }
    }
  } catch (err) {
    console.warn("自动同步检查失败 (网络原因):", err);
  }
}

// 每 10 秒检查一次同步
// setInterval(syncWithServer, 10000); // Replaced by startAutoRefresh with /api/version

// --- 7. 系统维护 (Backup & Upgrade) ---

async function loadBackups() {
  const list = document.getElementById('backup-list');
  if (!list) return;
  list.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:10px;">加载中...</td></tr>';

  try {
    const res = await fetch('/api/backups');
    const backups = await res.json();

    if (backups.length === 0) {
      list.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:10px; color:var(--text-muted);">暂无备份</td></tr>';
    } else {
      list.innerHTML = backups.map(b => `
        <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.2s;">
        <td style="padding: 12px 8px; color: var(--text-main); font-weight: 500;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i data-lucide="database" style="width: 14px; color: var(--text-muted);"></i>
            ${b.name}
          </div>
        </td>
        <td style="padding: 12px 8px; color: var(--text-muted); font-size: 13px;">${(b.size / 1024 / 1024).toFixed(2)} MB</td>
        <td style="padding: 12px 8px; color: var(--text-muted); font-size: 13px;">${new Date(b.created).toLocaleString()}</td>
        <td style="padding: 12px 8px;">
          <!-- 操作按钮组：纵向排列 -->
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
            <a href="/api/backups/${b.name}" target="_blank" title="下载到本地"
               style="color: var(--accent-purple); text-decoration: none; font-size: 12px; font-weight: 600; padding: 4px 8px; border-radius: 4px; transition: background 0.2s; width: 60px; text-align: center; background: rgba(139, 92, 246, 0.05);">
               下载
            </a>
            <button onclick="restoreBackup('${b.name}')" title="恢复此备份"
               style="color: var(--accent-blue); background: rgba(59, 130, 246, 0.05); border:none; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor:pointer; width: 60px; text-align: center;">
               恢复
            </button>
            <button onclick="deleteBackup('${b.name}')" title="永久删除"
               style="color: var(--danger); background: rgba(239, 68, 68, 0.05); border:none; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor:pointer; width: 60px; text-align: center;">
               删除
            </button>
          </div>
        </td>
      </tr>
      `).join('');
    }

    document.getElementById('next-backup-time').innerText = '下次自动备份: 每月1号或距离上次自动备份30天后';

  } catch (e) {
    list.innerHTML = `< tr > <td colspan="4" style="text-align:center; padding:10px; color:var(--danger);">加载失败: ${e.message}</td></tr > `;
  }
}

async function createBackup() {
  if (!confirm('确定要立即创建新的数据库备份吗？')) return;
  try {
    const res = await fetch('/api/backups', { method: 'POST' });
    if (!res.ok) throw new Error(res.statusText);
    alert('备份创建成功！');
    loadBackups();
  } catch (e) {
    alert('备份失败: ' + e.message);
  }
}

async function uploadBackupFile(input) {
  const file = input.files[0];
  if (!file) return;

  if (!file.name.endsWith('.db')) {
    alert('仅支持 .db 格式的数据库备份文件');
    input.value = '';
    return;
  }



  if (!confirm(`确定要上传备份文件 "${file.name}" 吗？\n上传后需要手动点击“恢复”才能应用该备份。`)) {
    input.value = '';
    return;
  }

  // 显示进度条
  const progressModal = document.getElementById('upload-progress-modal');
  const progressBar = document.getElementById('upload-progress-bar');
  const progressText = document.getElementById('upload-progress-text');

  progressModal.style.display = 'flex';
  progressBar.style.width = '0%';
  progressText.innerText = '准备中...';

  // 使用流式上传 (Raw Binary)
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/backups/upload-stream', true);
  // 重要：设置文件名 Header
  xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');

  // 监听上传进度
  xhr.upload.onprogress = function (event) {
    if (event.lengthComputable) {
      const percent = Math.round((event.loaded / event.total) * 100);
      progressBar.style.width = percent + '%';
      progressText.innerText = percent + '%';
    }
  };

  xhr.onload = function () {
    progressModal.style.display = 'none';
    input.value = ''; // Reset input

    if (xhr.status === 200) {
      try {
        const res = JSON.parse(xhr.responseText);
        if (res.success) {
          alert('✅ 备份上传成功！\n请在列表中点击“恢复”按钮应用此备份。');
          loadBackups();
        } else {
          alert('❌ 上传失败: ' + (res.error || '未知错误'));
        }
      } catch (e) {
        alert('❌ 上传失败: 服务器响应解析错误。');
      }
    } else {
      alert(`❌ 上传失败 (Status ${xhr.status}): ${xhr.statusText}`);
    }
  };

  xhr.onerror = function () {
    progressModal.style.display = 'none';
    input.value = '';
    alert('❌ 网络错误，上传中断。');
  };

  // 发送原始文件对象 (触发流式传输)
  xhr.send(file);
}



async function restoreBackup(filename) {
  if (!confirm(`警告：恢复备份[${filename}]将覆盖当前所有数据！\n系统将自动重启。\n\n确定要继续吗？`)) return;

  try {
    const res = await fetch('/api/backups/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    // Show overlay and start polling
    showRecoveryOverlay('正在恢复数据并重启...', 'primary');
    await pollForRecovery();

  } catch (e) {
    alert('恢复失败: ' + e.message);
  }
}

async function deleteBackup(filename) {
  if (!confirm(`确定要彻底删除备份文件[${filename}]吗？`)) return;
  try {
    const res = await fetch(`/api/backups/${filename}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.statusText);
    loadBackups();
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

let selectedUpgradeFile = null;

function handleUpgradeFile(input) {
  const file = input.files[0];
  const label = document.getElementById('upgrade-filename');
  const btn = document.getElementById('btn-start-upgrade');

  if (file) {
    if (!file.name.endsWith('.tar.gz')) {
      alert('仅支持 .tar.gz 格式的升级包');
      input.value = '';
      selectedUpgradeFile = null;
      label.innerText = '未选择文件';
      btn.disabled = true;
      btn.style.background = 'var(--text-muted)';
      btn.style.pointerEvents = 'none';
      return;
    }
    selectedUpgradeFile = file;
    label.innerText = file.name + ` (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    btn.disabled = false;
    btn.style.background = 'var(--accent-purple)';
    btn.style.pointerEvents = 'auto';
  } else {
    selectedUpgradeFile = null;
    label.innerText = '未选择文件';
    btn.disabled = true;
    btn.style.background = 'var(--text-muted)';
    btn.style.pointerEvents = 'none';
  }
}

async function startUpgrade() {
  if (!selectedUpgradeFile) return;

  // Ask for backup preference
  // 1. Cancel
  // 2. Backup & Upgrade
  // 3. Upgrade Only

  // Since we rely on standard alerts/confirms which are limited (Yes/No), 
  // we will use a sequence:
  // "系统升级可能存在风险。建议在升级前备份数据库。\n\n点击【确定】将自动创建备份并开始升级。\n点击【取消】将跳过备份直接升级。"
  // Wait, that's ambiguous. Better to ask explicitly.

  // Let's make it clearer logic:
  // Step 1: Confirm upgrade intent.
  // Step 2: Ask specifically if they want to backup.

  if (!confirm('确定要开始系统升级吗？\n升级过程中服务将短暂不可用。')) return;

  let shouldBackup = false;
  if (confirm('强烈建议在升级前备份当前数据库。\n\n是否立即创建备份？\n(点击“确定”创建备份并升级，点击“取消”仅升级)')) {
    shouldBackup = true;
  }

  const btn = document.getElementById('btn-start-upgrade');
  btn.innerText = shouldBackup ? '正在备份并升级...' : '正在上传并处理...';
  btn.disabled = true;

  try {
    if (shouldBackup) {
      try {
        const res = await fetch('/api/backups', { method: 'POST' });
        if (!res.ok) throw new Error("备份失败");
        // Refresh backup list in bg (optional but good context)
        loadBackups();
        console.log("Backup created successfully before upgrade.");
      } catch (e) {
        if (!confirm(`自动备份失败: ${e.message} \n\n是否仍要继续强行升级？`)) {
          btn.innerText = '开始升级';
          btn.disabled = false;
          return;
        }
      }
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64Data = e.target.result.split(',')[1];

        const res = await fetch('/api/upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: selectedUpgradeFile.name,
            fileData: base64Data
          })
        });

        const result = await res.json();
        if (!res.ok) throw new Error(result.error || res.statusText);

        showRecoveryOverlay('系统升级中，服务即将重启...', 'purple');
        await pollForRecovery();

      } catch (err) {
        alert('升级失败: ' + err.message);
        btn.innerText = '开始升级';
        btn.disabled = false;
      }
    };
    reader.readAsDataURL(selectedUpgradeFile);
  } catch (err) {
    alert('操作失败: ' + err.message);
    btn.innerText = '开始升级';
    btn.disabled = false;
  }
}

// --- Helper: Auto-Recovery UI & Polling ---
function showRecoveryOverlay(message, theme = 'primary') {
  const color = theme === 'purple' ? 'var(--accent-purple)' : 'var(--accent-blue)';
  const overlay = document.createElement('div');
  overlay.id = 'recovery-overlay';
  overlay.style = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.95);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;transition:opacity 0.5s;";
  overlay.innerHTML = `
      < div class="loading-spinner-large" style = "border-top-color:${color}; width:50px; height:50px;" ></div >
    <h2 style="color:${color}; margin-top:20px;">${message}</h2>
    <p style="color:var(--text-muted); font-size:14px; margin-top:8px;">请勿关闭页面，系统恢复后将自动刷新...</p>
    <div id="recovery-progress" style="margin-top:20px; font-family:monospace; color:var(--text-muted); font-size:12px;">Waiting for server...</div>
    `;
  document.body.appendChild(overlay);
}

async function pollForRecovery() {
  const statusEl = document.getElementById('recovery-progress');
  let retries = 0;

  const check = async () => {
    try {
      if (statusEl) statusEl.innerText = `Connecting... (${retries})`;
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (res.ok) {
        if (statusEl) statusEl.innerText = 'Server is back! Refreshing...';
        setTimeout(() => window.location.reload(), 1000);
        return;
      }
    } catch (e) {
      // Continue polling
    }
    retries++;
    setTimeout(check, 2000);
  };

  // Wait 3 seconds before first check to allow server to shut down
  setTimeout(check, 3000);
}

// --- Community Startup Modal Logic ---
async function checkCommunityPopup() {
  try {
    // Fetch server version (timestamp of server start)
    const res = await fetch('/api/version');
    if (!res.ok) return;
    const data = await res.json();
    const serverVersion = data.version;

    // Check if we have suppressed this specific server version
    const suppressedVersion = localStorage.getItem('filament_popup_suppressed_version');

    if (suppressedVersion !== String(serverVersion)) {
      const modal = document.getElementById('community-modal');
      if (modal) {
        modal.style.display = 'flex';
        // Store current version so we can easily suppress it later
        window.currentServerVersion = serverVersion;
      }
    }
  } catch (e) {
    console.error("Failed to check popup status:", e);
  }
}

function closeCommunityModal() {
  const modal = document.getElementById('community-modal');
  if (modal) modal.style.display = 'none';
}

function suppressCommunityModal() {
  if (window.currentServerVersion) {
    localStorage.setItem('filament_popup_suppressed_version', String(window.currentServerVersion));
  }
  closeCommunityModal();
}

// Ensure it runs after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkCommunityPopup);
} else {
  // Wait a moment for network to be ready if needed, or call immediately
  checkCommunityPopup();
}

// --- Image Enlarge Logic ---
function openImageModal(src) {
  if (src) {
    document.getElementById('image-viewer-img').src = src;
    document.getElementById('image-viewer-modal').style.display = 'flex';
  }
}
