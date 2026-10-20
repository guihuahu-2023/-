/* 纸间 — all note data and image generation stay in this browser. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const SAMPLE = `## 把想法，变成值得收藏的笔记\n\n好的排版，是给文字留一点呼吸的空间。把正文粘贴到左侧，选一个喜欢的模板，剩下的交给纸间。\n\n**重点可以加粗**，也可以用 ==荧光标记== 留住目光。\n\n## 三步，完成一篇图文\n\n1. 写下标题与正文\n2. 选择模板，调整字体和配色\n3. 导出高清图片，分享你的表达\n\n> 不必等到准备完美，先记录此刻的想法。\n\n---\n\n## 让每一页，都有自己的节奏\n\n长文会自动拆分成 3:4 卡片。你也可以单独输入一行三个短横线，决定从哪里翻开新的一页。\n\n- 支持上传自己的底图\n- 支持保存专属模板\n- 手机、平板、电脑都能使用\n- 草稿自动保存在当前浏览器\n\n试着换一种风格，让这段文字有一点不一样。`;
  const first = window.CARD_TEMPLATES[0];
  const freshNote = (sample = false) => ({
    id: uid(), updatedAt: Date.now(), title: sample ? '把日常灵感\n写成一页好看' : '', body: sample ? SAMPLE : '',
    templateId: first.id, colors: clone(first.colors), font: first.font || 'sans', customFont: '', titleFont: 'inherit', titleCustomFont: '', titleBold: true, titleItalic: false, bodyBold: false, bodyItalic: false,
    titleSize: 64, bodySize: 32, titleOpacity: 1, bodyOpacity: 1, lineHeight: 1.65, paragraphGap: 18, padding: 68, paddingTop: 68, paddingBottom: 68,
    align: 'left', showTitle: true, repeatTitle: false, autoPaginate: true, showPageNumber: true,
    author: '', watermark: '', titleDecor: true,
    background: { dataUrl: '', fit: 'cover', opacity: 1, overlay: 0, colorOpacity: 1, patternOpacity: 1, x: 50, y: 50 }, assets: {}
  });
  let data = { version: 1, notes: [freshNote(true)], activeId: '', presets: [], fonts: [] };
  data.activeId = data.notes[0].id;
  let database, storageAvailable = true, currentPage = 0, layout, renderTicket = 0, saveTimer, renderTimer, historyTimer;
  let undoStack = [], redoStack = [], historyBase = '', currentFilter = '全部', currentSearch = '', exportUrls = [], exportBusy = false;
  const note = () => data.notes.find(n => n.id === data.activeId) || data.notes[0];
  const safeText = (value, max = 300000) => typeof value === 'string' ? value.slice(0, max) : '';
  function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function toast(message, error = false) {
    $('toast').textContent = message;
    $('toast').classList.add('show'); $('toast').classList.toggle('error', error);
    clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.remove('show'), 4200);
  }
  async function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('zhijian-card-studio', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('workspace');
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('浏览器存储被其他窗口占用'));
    });
  }
  async function dbGet() {
    return new Promise((resolve, reject) => {
      const req = database.transaction('workspace', 'readonly').objectStore('workspace').get('state');
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    if (!storageAvailable) { $('saveStatus').textContent = '请导出工程备份'; return false; }
    const snapshot = clone(data);
    try {
      await new Promise((resolve, reject) => {
        const tx = database.transaction('workspace', 'readwrite');
        tx.objectStore('workspace').put(snapshot, 'state'); tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      $('saveStatus').textContent = '已保存在此浏览器';
      return true;
    } catch (error) {
      $('saveStatus').textContent = '保存失败，请导出工程';
      toast('浏览器空间不足或存储不可用，请及时导出工程备份。', true);
      return false;
    }
  }
  function changed({ history = true, repaint = true } = {}) {
    note().updatedAt = Date.now(); $('saveStatus').textContent = '正在保存…';
    clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 650);
    if (history) { clearTimeout(historyTimer); historyTimer = setTimeout(commitHistory, 500); }
    updateCounts();
    if (repaint) { clearTimeout(renderTimer); renderTimer = setTimeout(renderPreview, 130); }
  }
  function historySnapshot() { const snapshot = clone(note()); delete snapshot.updatedAt; return JSON.stringify(snapshot); }
  function resetHistory() { clearTimeout(historyTimer); undoStack = []; redoStack = []; historyBase = historySnapshot(); updateHistoryButtons(); }
  function commitHistory() {
    clearTimeout(historyTimer); const next = historySnapshot();
    if (next !== historyBase) { undoStack.push(historyBase); if (undoStack.length > 40) undoStack.shift(); historyBase = next; redoStack = []; }
    updateHistoryButtons();
  }
  function updateHistoryButtons() { $('undoBtn').disabled = !undoStack.length; $('redoBtn').disabled = !redoStack.length; }
  function travelHistory(back) {
    commitHistoryIfPending(); const from = back ? undoStack : redoStack, to = back ? redoStack : undoStack;
    if (!from.length) return;
    to.push(historySnapshot()); const restored = JSON.parse(from.pop());
    data.notes[data.notes.findIndex(n => n.id === data.activeId)] = restored;
    historyBase = historySnapshot(); syncInputs(); changed({ history: false }); updateHistoryButtons();
  }
  function commitHistoryIfPending() { if (historySnapshot() !== historyBase) commitHistory(); }
  function updateCounts() {
    const chars = [...note().body.replace(/\s/g, '')].length;
    $('charCount').textContent = `${chars.toLocaleString()} 字`;
  }
  const ranges = { titleSize: 'titleSize', bodySize: 'bodySize', lineHeight: 'lineHeight', paragraphGap: 'paragraphGap', padding: 'padding', paddingTop: 'paddingTop', paddingBottom: 'paddingBottom' };
  const textOpacities = { titleOpacity: 'titleOpacity', titleOpacityInline: 'titleOpacity', bodyOpacity: 'bodyOpacity', bodyOpacityInline: 'bodyOpacity' };
  const checks = { showTitle: 'showTitle', repeatTitle: 'repeatTitle', autoPaginate: 'autoPaginate', showPageNumber: 'showPageNumber', titleDecor: 'titleDecor' };
  const colors = { bgColor: 'bg', titleColor: 'title', titleColorInline: 'title', textColor: 'text', textColorInline: 'text', accentColor: 'accent' };
  const backgroundRanges = { bgOpacity: 'opacity', bgOverlay: 'overlay', bgColorOpacity: 'colorOpacity', bgPatternOpacity: 'patternOpacity', bgX: 'x', bgY: 'y' };
  function syncInputs() {
    const n = note(); $('titleInput').value = n.title; $('bodyInput').value = n.body;
    $('watermarkInput').value = n.watermark;
    Object.entries(ranges).forEach(([id, key]) => { $(id).value = n[key]; updateRange(id); });
    updateTitleSizeControls(); updateBodySizeControls();
    Object.entries(checks).forEach(([id, key]) => $(id).checked = n[key]);
    syncColorControls(); syncTextOpacityControls();
    Object.entries(backgroundRanges).forEach(([id, key]) => { $(id).value = n.background[key]; updateRange(id); });
    $('alignSelect').value = n.align; syncFontControls(); $('bgFit').value = n.background.fit;
    $('bgPreview').hidden = !n.background.dataUrl;
    if (n.background.dataUrl) $('bgPreview').src = n.background.dataUrl; else $('bgPreview').removeAttribute('src');
    $('removeBgBtn').disabled = !n.background.dataUrl;
    updateCounts(); highlightTemplate();
  }
  const fontControls = { fontSelect: 'body', bodyFontInline: 'body', titleFontSelect: 'title', titleFontInline: 'title' };
  function syncFontControls() {
    Object.entries(fontControls).forEach(([id, target]) => {
      const select = $(id), isTitle = target === 'title';
      const options = isTitle ? [['inherit', '跟随正文字体']] : [];
      options.push(['wenkai', '霞鹜文楷 · 手写文艺'], ['smiley', '得意黑 · 活力封面'], ['kuaile', '站酷快乐体 · 俏皮可爱'], ['mashan', '马善政毛笔楷书 · 书法'], ['sans', '简洁黑体'], ['serif', '优雅宋体'], ['hand', '手写楷体']);
      data.fonts.forEach(font => options.push([`custom:${font.family}`, font.name]));
      select.replaceChildren(...options.map(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; }));
      const key = isTitle ? 'titleFont' : 'font', customKey = isTitle ? 'titleCustomFont' : 'customFont';
      select.value = note()[key] === 'custom' ? `custom:${note()[customKey]}` : note()[key];
    });
    $$('[data-text-style]').forEach(button => button.setAttribute('aria-pressed', String(note()[button.dataset.textStyle])));
  }
  function setTextFont(target, value) {
    const key = target === 'title' ? 'titleFont' : 'font', customKey = target === 'title' ? 'titleCustomFont' : 'customFont';
    if (value.startsWith('custom:')) { note()[key] = 'custom'; note()[customKey] = value.slice(7); }
    else note()[key] = value;
    syncFontControls(); changed();
  }
  function updateRange(id) {
    const output = document.querySelector(`[data-value-for="${id}"]`);
    if (output) output.textContent = ['bgOpacity', 'bgOverlay', 'bgColorOpacity', 'bgPatternOpacity', ...Object.keys(textOpacities)].includes(id) ? `${Math.round(Number($(id).value) * 100)}%` : ['bgX', 'bgY'].includes(id) ? `${$(id).value}%` : $(id).value;
  }
  function updateTitleSizeControls() {
    const size = Math.max(24, Math.min(120, Math.round(note().titleSize)));
    $('titleSize').value = size; $('titleSizeInline').value = size; $('titleSizeNumber').value = size;
    $('titleSizeDecrease').disabled = size <= 24; $('titleSizeIncrease').disabled = size >= 120;
    updateRange('titleSize');
  }
  function setTitleSize(value) {
    if (!Number.isFinite(Number(value)) || String(value).trim() === '') { updateTitleSizeControls(); return; }
    note().titleSize = Math.max(24, Math.min(120, Math.round(Number(value))));
    updateTitleSizeControls(); changed();
  }
  function updateBodySizeControls() {
    const size = Math.max(16, Math.min(72, Math.round(note().bodySize)));
    $('bodySize').value = size; $('bodySizeInline').value = size; $('bodySizeNumber').value = size;
    $('bodySizeDecrease').disabled = size <= 16; $('bodySizeIncrease').disabled = size >= 72;
    updateRange('bodySize');
  }
  function setBodySize(value) {
    if (!Number.isFinite(Number(value)) || String(value).trim() === '') { updateBodySizeControls(); return; }
    note().bodySize = Math.max(16, Math.min(72, Math.round(Number(value))));
    updateBodySizeControls(); changed();
  }
  function syncColorControls() {
    Object.entries(colors).forEach(([id, key]) => $(id).value = note().colors[key]);
    $$('[data-color-value]').forEach(el => el.textContent = note().colors[el.dataset.colorValue].toUpperCase());
    $$('[data-bg-color]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.bgColor.toLowerCase() === note().colors.bg.toLowerCase())));
  }
  function syncTextOpacityControls() {
    Object.entries(textOpacities).forEach(([id, key]) => { $(id).value = note()[key]; updateRange(id); });
  }
  async function renderPreview() {
    const ticket = ++renderTicket;
    try {
      const next = await CardRenderer.layout(clone(note()));
      if (ticket !== renderTicket) return;
      currentPage = Math.min(currentPage, next.pages.length - 1); currentPage = Math.max(0, currentPage);
      layout = next; await paintCurrent(ticket);
      if (ticket !== renderTicket) return;
      $('pageCount').textContent = `${currentPage + 1} / ${next.pages.length} 页`;
      $('previewMessage').textContent = next.warnings?.join('；') || '画布比例 3:4 · 导出清晰度不受预览缩放影响';
      $('previewMessage').classList.toggle('warning', !!next.warnings?.length);
      $('prevPage').disabled = currentPage === 0; $('nextPage').disabled = currentPage === next.pages.length - 1;
      renderStrip(next, ticket);
    } catch (error) { if (ticket === renderTicket) { $('previewMessage').textContent = `预览失败：${error.message}`; toast('预览暂时失败，请检查图片或重新载入工程。', true); } }
  }
  async function paintCurrent(ticket = renderTicket) {
    if (!layout) return;
    const canvas = document.createElement('canvas');
    await CardRenderer.render(canvas, layout, currentPage, 900);
    if (ticket !== renderTicket) return;
    const target = $('previewCanvas'); target.width = canvas.width; target.height = canvas.height;
    target.getContext('2d').drawImage(canvas, 0, 0); setZoom();
  }
  async function renderStrip(next, ticket) {
    const container = $('pageStrip'); container.replaceChildren();
    for (let i = 0; i < next.pages.length; i++) {
      if (ticket !== renderTicket) return;
      const button = document.createElement('button'); button.type = 'button'; button.className = `page-thumb${i === currentPage ? ' is-active' : ''}`;
      button.setAttribute('aria-label', `查看第 ${i + 1} 页`); button.setAttribute('aria-current', i === currentPage ? 'page' : 'false');
      const canvas = document.createElement('canvas'), span = document.createElement('span'); span.textContent = `${i + 1}`;
      button.append(canvas, span); button.addEventListener('click', () => switchPage(i)); container.append(button);
      await CardRenderer.render(canvas, next, i, 135);
    }
  }
  async function switchPage(index) {
    if (!layout) return; currentPage = Math.max(0, Math.min(index, layout.pages.length - 1));
    await paintCurrent(); $('pageCount').textContent = `${currentPage + 1} / ${layout.pages.length} 页`;
    $('prevPage').disabled = currentPage === 0; $('nextPage').disabled = currentPage === layout.pages.length - 1;
    $$('#pageStrip .page-thumb').forEach((b, i) => { b.classList.toggle('is-active', i === currentPage); b.setAttribute('aria-current', i === currentPage ? 'page' : 'false'); });
  }
  function setZoom() {
    const value = $('zoomSelect').value, canvas = $('previewCanvas');
    const stage = $('canvasStage');
    const fitWidth = stage.clientWidth && stage.clientHeight ? Math.max(48, Math.min(450, stage.clientWidth - 8, (stage.clientHeight - 8) * .75)) : 450;
    canvas.style.width = value === 'fit' ? `${fitWidth}px` : `${450 * Number(value)}px`;
    canvas.style.maxWidth = value === 'fit' ? '100%' : 'none';
    canvas.style.maxHeight = 'none';
    canvas.style.height = 'auto';
  }
  function highlightTemplate() { $$('#templateGrid .template-card').forEach(button => { const active = button.dataset.templateId === note().templateId; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); }); }
  function applyTemplate(template) {
    commitHistoryIfPending(); note().templateId = template.id; note().colors = clone(template.colors); note().font = template.font || 'sans'; note().titleFont = 'inherit';
    currentPage = 0; syncInputs(); changed(); toast(`已应用「${template.name}」`);
  }
  let templateTicket = 0;
  async function drawTemplates() {
    const ticket = ++templateTicket;
    const ordered = [...CARD_TEMPLATES.filter(t => t.category === '柔美'), ...CARD_TEMPLATES.filter(t => t.category !== '柔美')];
    const list = ordered.filter(t => (currentFilter === '全部' || (currentFilter === '新增' ? t.isNew : t.category === currentFilter)) && `${t.name}${t.description || ''}`.includes(currentSearch));
    $('templateGrid').replaceChildren();
    if (!list.length) { $('templateGrid').innerHTML = '<p class="empty-state">没有找到模板，试试其他关键词。</p>'; return; }
    for (const t of list) {
      if (ticket !== templateTicket) return;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'template-card'; button.dataset.templateId = t.id;
      button.title = t.description || t.name;
      const canvas = document.createElement('canvas'); canvas.className = 'template-thumb';
      const label = document.createElement('span'); label.className = 'template-name'; label.textContent = t.name;
      button.append(canvas, label); button.addEventListener('click', () => applyTemplate(t)); $('templateGrid').append(button);
      if (t.isNew) { const badge = document.createElement('span'); badge.className = 'template-new-badge'; badge.textContent = '新'; badge.setAttribute('aria-label', '新增模板'); button.append(badge); }
      try {
        const demo = { ...freshNote(), templateId: t.id, colors: clone(t.colors), font: t.font || 'sans', title: '记录生活\n珍藏灵感', body: '一页文字，一种心情。\n\n**让表达，自有风格。**', titleSize: 70, bodySize: 35 };
        const result = await CardRenderer.layout(demo); if (ticket !== templateTicket) return;
        await CardRenderer.render(canvas, result, 0, 204);
      } catch (error) { canvas.style.background = t.colors.bg; }
    }
    highlightTemplate();
  }
  function buildFilters() {
    const categories = ['全部', '新增', '柔美', ...new Set(CARD_TEMPLATES.map(t => t.category).filter(category => category !== '柔美'))];
    $('templateTotal').textContent = `${CARD_TEMPLATES.length} 套 · 全部免费`;
    $('templateFilters').replaceChildren();
    for (const category of categories) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `filter-chip${category === currentFilter ? ' is-active' : ''}`;
      button.textContent = category; button.setAttribute('aria-pressed', String(category === currentFilter));
      button.addEventListener('click', () => { currentFilter = category; buildFilters(); drawTemplates(); }); $('templateFilters').append(button);
    }
  }
  function formatText(kind) {
    const input = $('bodyInput'), start = input.selectionStart, end = input.selectionEnd, value = input.value, selected = value.slice(start, end);
    if (kind === 'image') { $('imageUpload').click(); return; }
    let insertion, cursorStart = 0, cursorEnd;
    const wrap = { bold: ['**', '**', '重点文字'], highlight: ['==', '==', '标记文字'], italic: ['*', '*', '斜体文字'] }[kind];
    if (wrap) { const text = selected || wrap[2]; insertion = wrap[0] + text + wrap[1]; cursorStart = wrap[0].length; cursorEnd = cursorStart + text.length; }
    else if (kind === 'break') { insertion = `${start && value[start - 1] !== '\n' ? '\n' : ''}\n---\n\n`; cursorStart = insertion.length; cursorEnd = cursorStart; }
    else {
      const prefix = { h2: '## ', quote: '> ', list: '- ' }[kind] || '';
      insertion = `${start && value[start - 1] !== '\n' ? '\n' : ''}${(selected || '输入文字').split('\n').map(line => prefix + line).join('\n')}`;
      cursorStart = insertion.length - (selected || '输入文字').length; cursorEnd = insertion.length;
    }
    commitHistoryIfPending(); input.setRangeText(insertion, start, end, 'end');
    note().body = input.value; changed(); commitHistory(); input.focus(); input.setSelectionRange(start + cursorStart, start + cursorEnd);
  }
  function readAsDataURL(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
  }
  async function importImage(file, background = false) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) { toast('请选择 PNG、JPG 或 WebP 图片。', true); return; }
    if (file.size > 25 * 1024 * 1024) { toast('单张图片请小于 25MB。', true); return; }
    const noteId = data.activeId;
    try {
      const source = await readAsDataURL(file), img = new Image(); img.src = source; await img.decode();
      // Bound decoded pixel memory, while retaining enough detail for 2160px output.
      const ratio = Math.min(1, 3200 / Math.max(img.width, img.height));
      let dataUrl = source;
      if (ratio < 1) {
        const canvas = document.createElement('canvas'); canvas.width = Math.round(img.width * ratio); canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', .94);
      }
      if (data.activeId !== noteId) { toast('笔记已切换，请重新选择图片。'); return; }
      commitHistoryIfPending();
      if (background) { note().background.dataUrl = dataUrl; syncInputs(); }
      else {
        const id = uid(); note().assets[id] = { dataUrl, name: file.name };
        const input = $('bodyInput'), position = input.selectionStart;
        input.setRangeText(`\n\n![${file.name.replace(/[\[\]\r\n]/g, '').replace(/\.[^.]+$/, '')}](asset:${id})\n\n`, position, input.selectionEnd, 'end');
        note().body = input.value;
      }
      changed(); toast(background ? '底图已添加，可以在设置中调整文字区域和底图位置。' : '图片已插入正文。');
    } catch (error) { toast('这张图片无法读取，请换一张 PNG 或 JPG 图片。', true); }
  }
  async function registerFont(font) {
    const face = new FontFace(font.family, `url(${font.dataUrl})`); await face.load(); document.fonts.add(face);
  }
  async function uploadFont(file) {
    if (!file) return;
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name) || file.size > 30 * 1024 * 1024) { toast('请选择小于 30MB 的 TTF、OTF、WOFF 或 WOFF2 字体。', true); return; }
    const noteId = data.activeId, uploadTarget = $('fontUploadTarget').value;
    try {
      const font = { family: `userfont-${uid()}`, name: file.name, dataUrl: await readAsDataURL(file) };
      await registerFont(font); data.fonts.push(font);
      const target = data.notes.find(n => n.id === noteId);
      if (uploadTarget !== 'title') { target.customFont = font.family; target.font = 'custom'; }
      if (uploadTarget !== 'body') { target.titleCustomFont = font.family; target.titleFont = 'custom'; }
      if (noteId === data.activeId) { syncInputs(); changed(); } else saveNow();
      toast(`已加载字体「${file.name}」`);
    } catch (error) { toast('字体加载失败，请检查文件格式。', true); }
  }
  let modalTrigger;
  function showModal(title, content, footer = '') {
    closeModal(); modalTrigger = document.activeElement;
    const root = $('dialogRoot'); root.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="dialogTitle" tabindex="-1"><div class="modal-header"><h2 id="dialogTitle">${escapeHTML(title)}</h2><button type="button" class="icon-button close-dialog" aria-label="关闭">×</button></div><div class="modal-body">${content}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</section></div>`;
    root.querySelector('.close-dialog').onclick = closeModal;
    root.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target.classList.contains('modal-backdrop') && !exportBusy) closeModal(); });
    root.querySelector('.modal').focus(); document.body.classList.add('modal-open');
  }
  function closeModal() {
    if (exportBusy) return;
    exportUrls.forEach(url => URL.revokeObjectURL(url)); exportUrls = [];
    $('dialogRoot').replaceChildren(); document.body.classList.remove('modal-open'); modalTrigger?.focus?.();
  }
  function showNotes() {
    commitHistoryIfPending();
    showModal('我的笔记', '<p class="muted">草稿保存在当前设备的这个浏览器中。跨设备继续编辑，请导出并导入工程。</p><div id="notesList" class="notes-list"></div>', '<button type="button" class="btn primary" id="newFromNotes">＋ 新建笔记</button>');
    const sorted = [...data.notes].sort((a, b) => b.updatedAt - a.updatedAt);
    sorted.forEach(n => {
      const row = document.createElement('div'); row.className = 'note-row';
      const info = document.createElement('button'); info.className = 'note-open'; info.type = 'button';
      const title = document.createElement('strong'); title.textContent = n.title.replace(/\n/g, ' ') || '未命名笔记';
      const sub = document.createElement('span'); sub.textContent = `${new Date(n.updatedAt).toLocaleString('zh-CN')} · ${[...n.body].length} 字${n.id === data.activeId ? ' · 当前笔记' : ''}`;
      info.append(title, sub); info.onclick = () => { data.activeId = n.id; currentPage = 0; resetHistory(); syncInputs(); changed({ history: false }); closeModal(); };
      const duplicate = document.createElement('button'); duplicate.type = 'button'; duplicate.className = 'btn secondary small'; duplicate.textContent = '复制';
      duplicate.onclick = () => { const copy = clone(n); copy.id = uid(); copy.title = `${copy.title || '未命名笔记'}（副本）`; copy.updatedAt = Date.now(); data.notes.push(copy); saveNow(); showNotes(); };
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn danger small'; remove.textContent = '删除';
      remove.onclick = () => {
        showModal('删除这篇笔记？', `<p>「${escapeHTML(n.title || '未命名笔记')}」将从此浏览器中删除。需要保留时，请先关闭弹窗并导出工程。</p>`, '<button type="button" class="btn secondary" id="cancelDelete">返回</button><button type="button" class="btn danger" id="confirmDelete">删除笔记</button>');
        $('cancelDelete').onclick = showNotes;
        $('confirmDelete').onclick = () => {
          data.notes = data.notes.filter(item => item.id !== n.id); if (!data.notes.length) data.notes.push(freshNote());
          if (!data.notes.some(item => item.id === data.activeId)) data.activeId = data.notes[0].id;
          currentPage = 0; resetHistory(); syncInputs(); changed({ history: false }); showNotes();
        };
      };
      row.append(info, duplicate, remove); $('notesList').append(row);
    });
    $('newFromNotes').onclick = newNote;
  }
  function newNote() {
    commitHistoryIfPending(); const n = freshNote(); data.notes.push(n); data.activeId = n.id;
    currentPage = 0; resetHistory(); syncInputs(); changed({ history: false }); closeModal(); activatePanel('editor'); $('titleInput').focus();
  }
  const PRESET_KEYS = ['templateId', 'colors', 'font', 'customFont', 'titleFont', 'titleCustomFont', 'titleBold', 'titleItalic', 'bodyBold', 'bodyItalic', 'titleSize', 'bodySize', 'titleOpacity', 'bodyOpacity', 'lineHeight', 'paragraphGap', 'padding', 'paddingTop', 'paddingBottom', 'align', 'showTitle', 'repeatTitle', 'autoPaginate', 'showPageNumber', 'watermark', 'titleDecor', 'background'];
  function showSavePreset() {
    showModal('保存我的模板', '<label class="field">模板名称<input id="presetName" type="text" maxlength="30" placeholder="例如：我的奶油色手记"></label><p class="muted">保存配色、字体、排版设置和底图，不包含本篇正文。</p>', '<button type="button" class="btn primary" id="confirmPreset">保存模板</button>');
    $('presetName').focus(); $('confirmPreset').onclick = () => {
      const name = $('presetName').value.trim(); if (!name) { $('presetName').focus(); return; }
      const style = {}; PRESET_KEYS.forEach(key => style[key] = clone(note()[key]));
      data.presets.push({ id: uid(), name, style }); saveNow(); drawCustomTemplates(); closeModal(); toast('专属模板已保存在当前浏览器。');
    };
  }
  function drawCustomTemplates() {
    $('customTemplates').replaceChildren();
    if (!data.presets.length) { $('customTemplates').innerHTML = '<p class="muted small">上传底图、调好样式后，保存成你的专属模板。</p>'; return; }
    data.presets.forEach(p => {
      const row = document.createElement('div'); row.className = 'custom-preset';
      const button = document.createElement('button'); button.className = 'btn secondary'; button.type = 'button'; button.textContent = p.name;
      button.onclick = () => { commitHistoryIfPending(); Object.assign(note(), clone(p.style)); currentPage = 0; syncInputs(); changed(); toast(`已应用「${p.name}」`); };
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button'; remove.textContent = '×'; remove.title = '删除自定义模板'; remove.setAttribute('aria-label', `删除模板 ${p.name}`);
      remove.onclick = () => {
        showModal('删除自定义模板？', `<p>将删除「${escapeHTML(p.name)}」，已应用此模板的笔记不受影响。</p>`, '<button id="deletePreset" type="button" class="btn danger">删除模板</button>');
        $('deletePreset').onclick = () => { data.presets = data.presets.filter(item => item.id !== p.id); saveNow(); drawCustomTemplates(); closeModal(); };
      };
      row.append(button, remove); $('customTemplates').append(row);
    });
  }
  function safeFilename(value) { return (value || '纸间笔记').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 50) || '纸间笔记'; }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function exportProject() {
    commitHistoryIfPending();
    const n = clone(note());
    const presetFonts = new Set(data.presets.flatMap(p => [p.style.customFont, p.style.titleCustomFont]).filter(Boolean));
    [n.customFont, n.titleCustomFont].filter(Boolean).forEach(family => presetFonts.add(family));
    const payload = { app: 'zhijian-card-studio', version: 1, exportedAt: new Date().toISOString(), note: n, presets: clone(data.presets), fonts: clone(data.fonts.filter(f => presetFonts.has(f.family))) };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (blob.size > 120 * 1024 * 1024) { toast('工程超过 120MB，请减少大图或不再需要的自定义模板后导出。', true); return; }
    downloadBlob(blob, `${safeFilename(n.title)}.zhijian.json`); toast('工程已导出，包含此笔记、底图和你的自定义模板。');
  }
  function normalizeNote(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.body !== 'string') throw new Error('不是有效的笔记工程');
    const out = freshNote();
    out.title = safeText(raw.title, 2000); out.body = raw.body;
    if (CARD_TEMPLATES.some(t => t.id === raw.templateId)) out.templateId = raw.templateId;
    if (['sans', 'serif', 'hand', 'wenkai', 'smiley', 'kuaile', 'mashan', 'custom'].includes(raw.font)) out.font = raw.font;
    out.customFont = safeText(raw.customFont, 100);
    if (['inherit', 'sans', 'serif', 'hand', 'wenkai', 'smiley', 'kuaile', 'mashan', 'custom'].includes(raw.titleFont)) out.titleFont = raw.titleFont;
    out.titleCustomFont = safeText(raw.titleCustomFont, 100);
    for (const key of ['titleBold', 'titleItalic', 'bodyBold', 'bodyItalic']) if (typeof raw[key] === 'boolean') out[key] = raw[key];
    const bounds = { titleSize: [24, 120], bodySize: [16, 72], titleOpacity: [0, 1], bodyOpacity: [0, 1], lineHeight: [1.2, 2.2], paragraphGap: [0, 40], padding: [32, 120], paddingTop: [32, 200], paddingBottom: [32, 200] };
    Object.entries(bounds).forEach(([key, [min, max]]) => { if (Number.isFinite(raw[key])) out[key] = Math.max(min, Math.min(max, raw[key])); });
    Object.keys(checks).forEach(key => { if (typeof raw[key] === 'boolean') out[key] = raw[key]; });
    if (raw.align === 'center') out.align = 'center';
    out.author = ''; out.watermark = safeText(raw.watermark, 100);
    for (const key of ['bg', 'text', 'title', 'accent', 'muted']) if (/^#[0-9a-f]{6}$/i.test(raw.colors?.[key])) out.colors[key] = raw.colors[key];
    if (!/^#[0-9a-f]{6}$/i.test(raw.colors?.title || '')) out.colors.title = out.colors.text;
    const bg = raw.background;
    if (bg && typeof bg === 'object') {
      if (validImage(bg.dataUrl)) out.background.dataUrl = bg.dataUrl;
      if (bg.fit === 'contain') out.background.fit = 'contain';
      for (const key of ['x', 'y', 'opacity', 'overlay', 'colorOpacity', 'patternOpacity']) if (Number.isFinite(bg[key])) out.background[key] = Math.max(0, Math.min(['x', 'y'].includes(key) ? 100 : 1, bg[key]));
    }
    if (raw.assets && typeof raw.assets === 'object') for (const [key, asset] of Object.entries(raw.assets)) {
      if (/^[\w-]{1,100}$/.test(key) && validImage(asset?.dataUrl)) out.assets[key] = { dataUrl: asset.dataUrl, name: safeText(asset.name, 200) };
    }
    return out;
  }
  function validImage(value) { return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value); }
  async function importProject(file) {
    if (!file) return;
    if (file.size > 120 * 1024 * 1024) { toast('工程文件超过 120MB，请减少图片后重试。', true); return; }
    try {
      const payload = JSON.parse(await file.text());
      if (payload.app !== 'zhijian-card-studio' || payload.version !== 1) throw new Error('请选择纸间导出的 .zhijian.json 工程');
      const imported = normalizeNote(payload.note);
      const incomingFonts = Array.isArray(payload.fonts) ? payload.fonts : [];
      for (const font of incomingFonts) {
        if (!/^userfont-[\w-]+$/.test(font?.family || '') || !/^data:[^,]*;base64,[a-z0-9+/=\r\n]+$/i.test(font?.dataUrl || '')) continue;
        if (!data.fonts.some(f => f.family === font.family)) { try { await registerFont(font); data.fonts.push(font); } catch {} }
      }
      if (imported.font === 'custom' && !data.fonts.some(f => f.family === imported.customFont)) { imported.font = 'sans'; imported.customFont = ''; }
      if (imported.titleFont === 'custom' && !data.fonts.some(f => f.family === imported.titleCustomFont)) { imported.titleFont = 'inherit'; imported.titleCustomFont = ''; }
      data.notes.push(imported); data.activeId = imported.id;
      if (Array.isArray(payload.presets)) for (const p of payload.presets) {
        if (!p || typeof p.name !== 'string' || !p.style) continue;
        if (data.presets.some(existing => existing.name === p.name)) continue;
        const normalized = normalizeNote({ ...p.style, body: '' }); const style = {}; PRESET_KEYS.forEach(key => style[key] = clone(normalized[key]));
        if (style.font === 'custom' && !data.fonts.some(f => f.family === style.customFont)) { style.font = 'sans'; style.customFont = ''; }
        if (style.titleFont === 'custom' && !data.fonts.some(f => f.family === style.titleCustomFont)) { style.titleFont = 'inherit'; style.titleCustomFont = ''; }
        data.presets.push({ id: uid(), name: p.name.slice(0, 30), style });
      }
      currentPage = 0; resetHistory(); syncInputs(); drawCustomTemplates(); changed({ history: false }); toast('工程已导入为一篇新笔记。');
    } catch (error) { toast(`导入失败：${error.message}`, true); }
  }
  // ZIP writer: uncompressed entries, UTF-8 filenames; PNG/JPG are already compressed.
  const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
  function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }
  async function createZip(files) {
    const chunks = [], central = [], encoder = new TextEncoder(); let offset = 0, centralSize = 0;
    for (const file of files) {
      const name = encoder.encode(file.name), bytes = new Uint8Array(await file.blob.arrayBuffer()), crc = crc32(bytes);
      const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true); lv.setUint32(14, crc, true); lv.setUint32(18, bytes.length, true); lv.setUint32(22, bytes.length, true); lv.setUint16(26, name.length, true); local.set(name, 30);
      const entry = new Uint8Array(46 + name.length), ev = new DataView(entry.buffer);
      ev.setUint32(0, 0x02014b50, true); ev.setUint16(4, 20, true); ev.setUint16(6, 20, true); ev.setUint16(8, 0x800, true); ev.setUint32(16, crc, true); ev.setUint32(20, bytes.length, true); ev.setUint32(24, bytes.length, true); ev.setUint16(28, name.length, true); ev.setUint32(42, offset, true); entry.set(name, 46);
      chunks.push(local, bytes); central.push(entry); offset += local.length + bytes.length; centralSize += entry.length;
    }
    const end = new Uint8Array(22), view = new DataView(end.buffer); view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
  }
  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('浏览器未能生成图片，请改用标准清晰度')), type, quality));
  }
  function openExport(currentOnly = false) {
    if (exportBusy) return;
    showModal('导出你的好看笔记', `<div class="export-options"><label class="field">清晰度<select id="exportResolution"><option value="1080">高清 · 1080 × 1440</option><option value="2160">超清 · 2160 × 2880</option></select></label><label class="field">图片格式<select id="exportFormat"><option value="image/png">PNG · 无损画质</option><option value="image/jpeg">JPG · 文件更小</option></select></label><label class="field">导出范围<select id="exportRange"><option value="all">全部页面</option><option value="current"${currentOnly ? ' selected' : ''}>当前第 ${currentPage + 1} 页</option></select></label></div><p class="muted">生成后可一次下载全部 PNG / JPG 图片，无需解压。若浏览器询问，请允许下载多个文件；手机也可长按单张图片，或使用支持的系统批量分享。</p><div id="exportProgress" role="status" aria-live="polite"></div><div id="exportResults" class="export-grid"></div>`, '<button type="button" class="btn primary" id="downloadAllImages" hidden>逐张下载全部图片</button><button type="button" class="btn secondary" id="shareAllImages" hidden>分享全部图片</button><button type="button" class="btn secondary" id="downloadZip" hidden>下载全部 ZIP</button><button type="button" class="btn primary" id="generateExport">生成高清图片</button>');
    $('generateExport').onclick = generateExports;
  }
  async function generateExports() {
    if (exportBusy) return;
    const button = $('generateExport'); button.disabled = true; exportBusy = true;
    const close = document.querySelector('.close-dialog'); close.disabled = true;
    const width = Number($('exportResolution').value), type = $('exportFormat').value, all = $('exportRange').value === 'all';
    const progress = $('exportProgress'), results = $('exportResults'); results.replaceChildren(); $('downloadZip').hidden = true; $('downloadAllImages').hidden = true; $('shareAllImages').hidden = true;
    exportUrls.forEach(url => URL.revokeObjectURL(url)); exportUrls = [];
    const snapshot = clone(note()), pageAtStart = currentPage, files = [];
    try {
      progress.textContent = '正在准备字体与图片…';
      const ready = await CardRenderer.layout(snapshot), indexes = all ? ready.pages.map((_, i) => i) : [Math.min(pageAtStart, ready.pages.length - 1)];
      for (let i = 0; i < indexes.length; i++) {
        progress.textContent = `正在生成第 ${i + 1} / ${indexes.length} 张…`;
        await new Promise(resolve => requestAnimationFrame(resolve));
        const canvas = document.createElement('canvas'); await CardRenderer.render(canvas, ready, indexes[i], width);
        const blob = await canvasBlob(canvas, type, .96); canvas.width = canvas.height = 1;
        const name = `${safeFilename(snapshot.title)}-${String(indexes[i] + 1).padStart(2, '0')}.${type === 'image/png' ? 'png' : 'jpg'}`;
        const url = URL.createObjectURL(blob); exportUrls.push(url); files.push({ name, blob });
        const card = document.createElement('div'); card.className = 'export-card';
        const image = document.createElement('img'); image.src = url; image.alt = `第 ${indexes[i] + 1} 页导出图片，可长按保存`;
        await image.decode();
        const label = document.createElement('p'); label.textContent = `第 ${indexes[i] + 1} 页 · ${width} × ${width * 4 / 3}`;
        const download = document.createElement('a'); download.className = 'btn secondary'; download.href = url; download.download = name; download.textContent = '保存图片';
        card.append(image, label, download);
        const file = new File([blob], name, { type });
        if (navigator.canShare?.({ files: [file] })) {
          const share = document.createElement('button'); share.className = 'btn secondary'; share.type = 'button'; share.textContent = '系统分享 / 存储';
          share.onclick = async () => { try { await navigator.share({ files: [file], title: snapshot.title || '纸间笔记' }); } catch (e) { if (e.name !== 'AbortError') toast('分享未完成，可以用保存图片按钮或长按图片。', true); } }; card.append(share);
        }
        results.append(card);
      }
      progress.textContent = `已生成 ${files.length} 张图片，点击下方按钮保存，或在手机上长按图片。`;
      const batchButton = $('downloadAllImages'); batchButton.hidden = false;
      batchButton.textContent = files.length > 1 ? `逐张下载全部 ${files.length} 张图片` : '下载图片';
      const batchLabel = batchButton.textContent;
      batchButton.onclick = async () => {
        batchButton.disabled = true;
        const generateButton = $('generateExport'); generateButton.disabled = true;
        try {
          for (let i = 0; i < files.length; i++) {
            if (!batchButton.isConnected) break;
            batchButton.textContent = `正在下载 ${i + 1} / ${files.length}…`;
            downloadBlob(files[i].blob, files[i].name);
            if (i < files.length - 1) await new Promise(resolve => setTimeout(resolve, 350));
          }
          if (batchButton.isConnected) progress.textContent = `已发起 ${files.length} 张独立图片的下载。若只收到一张，请允许浏览器下载多个文件后重试，也可点击每张图片的「保存图片」。`;
        } catch (error) { toast('批量下载未完成，请点击每张图片的「保存图片」。', true); }
        finally { batchButton.disabled = false; batchButton.textContent = batchLabel; generateButton.disabled = false; }
      };
      const sharedFiles = files.map(file => new File([file.blob], file.name, { type }));
      const shareButton = $('shareAllImages');
      if (navigator.canShare?.({ files: sharedFiles })) {
        shareButton.hidden = false;
        shareButton.onclick = async () => {
          try { await navigator.share({ files: sharedFiles, title: snapshot.title || '纸间笔记' }); }
          catch (error) { if (error.name !== 'AbortError') toast('系统分享未完成，可以下载图片或长按保存。', true); }
        };
      }
      const zipButton = $('downloadZip'); zipButton.hidden = files.length < 2;
      zipButton.onclick = async () => {
        zipButton.disabled = true; zipButton.textContent = '正在打包…';
        try { downloadBlob(await createZip(files), `${safeFilename(snapshot.title)}.zip`); toast('ZIP 已开始下载。'); }
        catch (error) { toast('打包失败，请逐张保存图片。', true); }
        finally { zipButton.disabled = false; zipButton.textContent = '下载全部 ZIP'; }
      };
    } catch (error) { progress.textContent = `生成失败：${error.message}。请尝试 1080 × 1440 或导出当前页。`; }
    finally { exportBusy = false; button.disabled = false; button.textContent = '重新生成'; close.disabled = false; }
  }
  function showHelp() {
    showModal('第一次使用纸间', `<ol class="help-list"><li><strong>写标题和正文</strong><p>在「笔记标题」框输入标题，回车可换行。下方用滑块、A− / A＋按钮或数值框调整标题字号（24～120），也可以一键恢复默认。正文上方也可调整全文字号（16～72）、颜色与不透明度，标题的字号、颜色与不透明度均可独立设置。标题和正文可分别选字体、加粗或斜体，上传的字体也可分别应用。长文会自动分页；单独输入一行 <code>---</code> 可以手动换页。</p></li><li><strong>选模板与调样式</strong><p>在模板库「柔美」中挑选新增的花卉、蝴蝶结、蕾丝等风格；「自定义」中可修改字体、独立文字颜色、字号、行距和留白。全部模板均可调整背景色、底图与纹样不透明度（0% 隐藏，100% 完整显示）。上传底图后，调整顶部与底部留白，让文字避开装饰区域。</p></li><li><strong>导出高清卡片</strong><p>点击右上角导出，生成 PNG 或 JPG。生成后点击「逐张下载全部图片」，直接保存多张 PNG / JPG；如有提示，请允许浏览器下载多个文件。支持的手机可分享全部图片，也可长按单张保存。ZIP 作为可选方式保留。</p></li><li><strong>保存与跨设备</strong><p>草稿自动保存在当前浏览器。清理浏览器数据会清除本地草稿；请用「导出工程」备份。在另一台设备打开同一网址后，导入工程即可继续。</p></li></ol><div class="help-markdown"><strong>正文快捷写法</strong><p><code>## 小标题</code>　<code>**加粗**</code>　<code>==荧光标记==</code><br><code>*斜体*</code>　<code>> 引用</code>　<code>- 列表</code></p></div><p class="muted">模板底图是平面图片，图片中已有的文字不会变成可编辑文字。高清底图建议至少 2160 × 2880，避免放大后模糊。上传素材和字体请使用你有权使用的文件。</p>`);
  }
  function activatePanel(panel) {
    $$('[data-tab]').forEach(b => { const active = b.dataset.tab === panel; b.classList.toggle('is-active', active); b.setAttribute('aria-selected', String(active)); });
    $$('[data-panel]').forEach(p => p.classList.toggle('is-mobile-active', p.dataset.panel === panel));
    if (panel === 'preview') requestAnimationFrame(setZoom);
  }
  function bind() {
    $('titleInput').addEventListener('input', () => { note().title = $('titleInput').value; changed(); });
    $('bodyInput').addEventListener('input', () => { note().body = $('bodyInput').value; changed(); });
    $('watermarkInput').addEventListener('input', () => { note().watermark = $('watermarkInput').value; changed(); });
    Object.entries(ranges).forEach(([id, key]) => $(id).addEventListener('input', () => { if (key === 'titleSize') { setTitleSize($(id).value); return; } if (key === 'bodySize') { setBodySize($(id).value); return; } note()[key] = Number($(id).value); updateRange(id); changed(); }));
    $('titleSizeInline').addEventListener('input', () => setTitleSize($('titleSizeInline').value));
    $('titleSizeNumber').addEventListener('change', () => setTitleSize($('titleSizeNumber').value));
    $('titleSizeNumber').addEventListener('blur', () => setTitleSize($('titleSizeNumber').value));
    $('titleSizeNumber').addEventListener('keydown', event => { if (event.key === 'Enter') { setTitleSize($('titleSizeNumber').value); $('titleSizeNumber').blur(); } });
    $('titleSizeDecrease').onclick = () => setTitleSize(note().titleSize - 2);
    $('titleSizeIncrease').onclick = () => setTitleSize(note().titleSize + 2);
    $('titleSizeReset').onclick = () => setTitleSize(64);
    $('bodySizeInline').addEventListener('input', () => setBodySize($('bodySizeInline').value));
    $('bodySizeNumber').addEventListener('change', () => setBodySize($('bodySizeNumber').value));
    $('bodySizeNumber').addEventListener('blur', () => setBodySize($('bodySizeNumber').value));
    $('bodySizeNumber').addEventListener('keydown', event => { if (event.key === 'Enter') { setBodySize($('bodySizeNumber').value); $('bodySizeNumber').blur(); } });
    $('bodySizeDecrease').onclick = () => setBodySize(note().bodySize - 2);
    $('bodySizeIncrease').onclick = () => setBodySize(note().bodySize + 2);
    $('bodySizeReset').onclick = () => setBodySize(32);
    Object.entries(checks).forEach(([id, key]) => $(id).addEventListener('change', () => { note()[key] = $(id).checked; changed(); }));
    Object.entries(colors).forEach(([id, key]) => $(id).addEventListener('input', () => { note().colors[key] = $(id).value; syncColorControls(); changed(); }));
    Object.entries(textOpacities).forEach(([id, key]) => $(id).addEventListener('input', () => { note()[key] = Number($(id).value); syncTextOpacityControls(); changed(); }));
    Object.entries(backgroundRanges).forEach(([id, key]) => $(id).addEventListener('input', () => { note().background[key] = Number($(id).value); updateRange(id); changed(); }));
    $$('[data-bg-color]').forEach(button => button.onclick = () => { note().colors.bg = button.dataset.bgColor; syncColorControls(); changed(); });
    $('resetBackgroundBtn').onclick = () => {
      commitHistoryIfPending();
      const template = CARD_TEMPLATES.find(t => t.id === note().templateId) || first;
      note().colors.bg = template.colors.bg; note().background.colorOpacity = 1; note().background.patternOpacity = 1;
      syncInputs(); changed();
    };
    $('alignSelect').onchange = () => { note().align = $('alignSelect').value; changed(); };
    Object.entries(fontControls).forEach(([id, target]) => $(id).onchange = () => setTextFont(target, $(id).value));
    $$('[data-text-style]').forEach(button => button.onclick = () => { note()[button.dataset.textStyle] = !note()[button.dataset.textStyle]; syncFontControls(); changed(); });
    $('bgFit').onchange = () => { note().background.fit = $('bgFit').value; changed(); };
    $('fontUpload').onchange = async () => { await uploadFont($('fontUpload').files[0]); $('fontUpload').value = ''; };
    $('bgUpload').onchange = async () => { await importImage($('bgUpload').files[0], true); $('bgUpload').value = ''; };
    $('imageUpload').onchange = async () => { await importImage($('imageUpload').files[0]); $('imageUpload').value = ''; };
    $('removeBgBtn').onclick = () => { note().background.dataUrl = ''; syncInputs(); changed(); };
    $$('[data-format]').forEach(button => { button.addEventListener('mousedown', event => event.preventDefault()); button.onclick = () => formatText(button.dataset.format); });
    $('undoBtn').onclick = () => travelHistory(true); $('redoBtn').onclick = () => travelHistory(false);
    $('newNote').onclick = newNote; $('notesBtn').onclick = showNotes; $('exportProjectBtn').onclick = exportProject;
    $('importProjectBtn').onclick = () => $('projectUpload').click();
    $('projectUpload').onchange = async () => { await importProject($('projectUpload').files[0]); $('projectUpload').value = ''; };
    $('saveTemplateBtn').onclick = showSavePreset;
    $('exportBtn').onclick = () => openExport(false); $('exportCurrentBtn').onclick = () => openExport(true);
    $('helpBtn').onclick = showHelp;
    $('prevPage').onclick = () => switchPage(currentPage - 1); $('nextPage').onclick = () => switchPage(currentPage + 1);
    $('zoomSelect').onchange = setZoom;
    $('templateSearch').oninput = () => { currentSearch = $('templateSearch').value.trim(); drawTemplates(); };
    $$('[data-tab]').forEach(b => b.onclick = () => activatePanel(b.dataset.tab));
    $$('[data-style-tab]').forEach(b => b.onclick = () => {
      $$('[data-style-tab]').forEach(item => { const active = item === b; item.classList.toggle('is-active', active); item.setAttribute('aria-selected', String(active)); });
      $('templatesPane').hidden = b.dataset.styleTab !== 'templates'; $('settingsPane').hidden = b.dataset.styleTab !== 'settings';
    });
    document.addEventListener('keydown', async event => {
      if (event.key === 'Escape') closeModal();
      const modal = $('dialogRoot').querySelector('.modal');
      if (event.key === 'Tab' && modal) {
        const focusable = [...modal.querySelectorAll('button:not([disabled]), a[href], input, select, textarea, [tabindex="0"]')].filter(el => !el.hidden && el.getClientRects().length);
        if (!focusable.length) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === focusable[0] || document.activeElement === modal)) { event.preventDefault(); focusable.at(-1).focus(); }
        else if (!event.shiftKey && (document.activeElement === focusable.at(-1) || document.activeElement === modal)) { event.preventDefault(); focusable[0].focus(); }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); const saved = await saveNow(); toast(saved ? '已保存到当前浏览器，跨设备请导出工程。' : '保存未完成，请导出工程备份。', !saved); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && document.activeElement === $('bodyInput')) { event.preventDefault(); formatText('bold'); }
    });
    window.addEventListener('pagehide', () => { if (storageAvailable) saveNow(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && storageAvailable) saveNow(); });
    window.addEventListener('resize', () => requestAnimationFrame(setZoom));
    if (window.ResizeObserver) new ResizeObserver(() => { if ($('zoomSelect').value === 'fit') setZoom(); }).observe($('canvasStage'));
  }
  async function init() {
    try {
      database = await openDB(); const saved = await dbGet();
      if (saved?.version === 1 && Array.isArray(saved.notes) && saved.notes.length) {
        data = saved; data.presets ||= []; data.fonts ||= [];
        if (!data.notes.some(n => n.id === data.activeId)) data.activeId = data.notes[0].id;
        data.notes = data.notes.map(n => ({ ...n, ...normalizeNote(n), id: n.id, updatedAt: n.updatedAt }));
        data.presets.forEach(p => {
          if (!p.style) return;
          const normalized = normalizeNote({ ...p.style, body: '' });
          PRESET_KEYS.forEach(key => p.style[key] = clone(normalized[key]));
          delete p.style.author;
        });
      }
    } catch (error) { storageAvailable = false; $('saveStatus').textContent = '浏览器存储不可用'; }
    for (const font of data.fonts) try { await registerFont(font); } catch {}
    bind(); syncInputs(); resetHistory(); buildFilters(); drawCustomTemplates(); activatePanel('editor');
    await renderPreview(); drawTemplates();
    if (storageAvailable) saveNow(); else toast('本次可以正常排版，请用「导出工程」保存草稿。', true);
  }
  init().catch(error => { console.error(error); $('saveStatus').textContent = '加载失败'; toast(`加载失败：${error.message}`, true); });
})();
