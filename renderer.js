/*
 * Every page is measured once in a 900 × 1200 coordinate system. Preview and
 * export replay the very same positioned items, so changing export resolution
 * cannot change pagination. All background artwork is generated locally.
 */
(function () {
  'use strict';
  var W = 900, H = 1200;
  var imageCache = new Map();
  var measureCanvas = document.createElement('canvas');
  var measure = measureCanvas.getContext('2d');
  var segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;
  var fontFamilies = {
    sans: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif',
    serif: '"Songti SC", "Noto Serif CJK SC", "SimSun", Georgia, serif',
    hand: '"KaiTi", "STKaiti", "Kaiti SC", "FangSong", serif',
    wenkai: '"Zhijian WenKai", "KaiTi", serif',
    smiley: '"Zhijian Smiley", "Microsoft YaHei", sans-serif',
    kuaile: '"Zhijian KuaiLe", "Microsoft YaHei", sans-serif',
    mashan: '"Zhijian MaShan", "KaiTi", serif'
  };
  function clamp(value, min, max, fallback) { value = Number(value); return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
  function family(n, role) {
    var isTitle = role === 'title' || role === 'heading';
    var separate = isTitle && n.titleFont && n.titleFont !== 'inherit';
    var selected = separate ? n.titleFont : n.font, custom = separate ? n.titleCustomFont : n.customFont;
    return selected === 'custom' && custom ? '"' + String(custom).replace(/["\\]/g, '') + '", ' + fontFamilies.sans : (fontFamilies[selected] || fontFamilies.sans);
  }
  function font(n, size, bold, italic, role) {
    var isTitle = role === 'title' || role === 'heading';
    bold = bold || (role && (isTitle ? n.titleBold : n.bodyBold));
    italic = italic || (role && (isTitle ? n.titleItalic : n.bodyItalic));
    return (italic ? 'italic ' : '') + (bold ? '700 ' : '400 ') + size + 'px ' + family(n, role);
  }
  function graphemes(s) { return segmenter ? Array.from(segmenter.segment(s), function (x) { return x.segment; }) : Array.from(s); }
  function imageFor(src) {
    if (!src) return Promise.resolve(null);
    // Imported projects must keep the same local-only behavior as fresh uploads.
    // Never fetch a remote URL, which could leak content or taint PNG export.
    if (!/^(?:data:image\/|blob:)/i.test(String(src))) return Promise.resolve(null);
    if (imageCache.has(src)) return imageCache.get(src);
    var p = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
    imageCache.set(src, p);
    return p;
  }
  function normalize(input) {
    var templates = window.CARD_TEMPLATES || [];
    var t = templates.find(function (x) { return x.id === input.templateId; }) || templates[0] || { id: 'grid', name: '简单格子', pattern: 'grid', font: 'sans', colors: { bg: '#FAFAF7', text: '#242D32', accent: '#698779', muted: '#77827D' } };
    var n = Object.assign({ title: '', body: '', font: t.font, titleFont: 'inherit', titleCustomFont: '', titleBold: true, titleItalic: false, bodyBold: false, bodyItalic: false, titleSize: 64, bodySize: 32, titleOpacity: 1, bodyOpacity: 1, lineHeight: 1.65, paragraphGap: 18, padding: 68, align: 'left', showTitle: true, repeatTitle: false, autoPaginate: true, showPageNumber: true, titleDecor: true, watermark: '' }, input);
    // Older saved drafts can contain an author. The card footer intentionally
    // has no left-hand text, including when such a draft is imported.
    delete n.author;
    n.title = String(n.title || ''); n.body = String(n.body || '');
    n.templateId = t.id; n.colors = Object.assign({}, t.colors, input.colors || {});
    n.colors.title = input.colors && input.colors.title || n.colors.text;
    n.padding = clamp(n.padding, 32, 180, 68);
    n.paddingTop = clamp(input.paddingTop, 32, 200, n.padding);
    n.paddingBottom = clamp(input.paddingBottom, 32, 200, n.padding);
    n.titleSize = clamp(n.titleSize, 24, 120, 64); n.bodySize = clamp(n.bodySize, 16, 72, 32);
    n.titleOpacity = clamp(n.titleOpacity, 0, 1, 1); n.bodyOpacity = clamp(n.bodyOpacity, 0, 1, 1);
    n.lineHeight = clamp(n.lineHeight, 1.1, 2.5, 1.65); n.paragraphGap = clamp(n.paragraphGap, 0, 80, 18);
    n.background = Object.assign({ dataUrl: '', fit: 'cover', opacity: 1, overlay: 0, colorOpacity: 1, patternOpacity: 1, x: 50, y: 50 }, input.background || {});
    n.background.opacity = clamp(n.background.opacity, 0, 1, 1); n.background.overlay = clamp(n.background.overlay, 0, 1, 0);
    n.background.colorOpacity = clamp(n.background.colorOpacity, 0, 1, 1); n.background.patternOpacity = clamp(n.background.patternOpacity, 0, 1, 1);
    n.assets = input.assets || {};
    return { note: n, template: t };
  }
  // A compact rich-text parser. Unmatched markers remain ordinary text.
  function rich(text, forceBold) {
    var out = [], pattern = /(\*\*([^*]+)\*\*|==([^=]+)==|\*([^*]+)\*)/g, at = 0, m;
    while ((m = pattern.exec(text))) {
      if (m.index > at) out.push({ text: text.slice(at, m.index), bold: !!forceBold });
      out.push({ text: m[2] || m[3] || m[4], bold: !!(forceBold || m[2]), highlight: !!m[3], italic: !!m[4] });
      at = pattern.lastIndex;
    }
    if (at < text.length) out.push({ text: text.slice(at), bold: !!forceBold });
    return out.length ? out : [{ text: '', bold: !!forceBold }];
  }
  function runsFrom(chars) {
    var runs = [];
    chars.forEach(function (c) {
      var last = runs[runs.length - 1];
      if (last && last.bold === c.bold && last.italic === c.italic && last.highlight === c.highlight) last.text += c.text;
      else runs.push({ text: c.text, bold: c.bold, italic: c.italic, highlight: c.highlight });
    });
    return runs;
  }
  function runWidth(runs, n, size, role) {
    return runs.reduce(function (sum, r) { measure.font = font(n, size, r.bold, r.italic, role); return sum + measure.measureText(r.text).width; }, 0);
  }
  function wrap(text, n, size, maxWidth, forceBold, role) {
    var chars = [];
    rich(text, forceBold).forEach(function (r) {
      measure.font = font(n, size, r.bold, r.italic, role);
      graphemes(r.text).forEach(function (s) { chars.push({ text: s, bold: r.bold, italic: r.italic, highlight: r.highlight, width: measure.measureText(s).width }); });
    });
    var result = [], start = 0;
    var closing = /^[，。！？、；：）》】」』〉〕］｝,.!?;:%]/;
    var opening = /[（《【「『〈〔［｛(]$/;
    while (start < chars.length) {
      var end = start, used = 0, whitespace = -1;
      while (end < chars.length && (used + chars[end].width <= maxWidth + 0.1 || end === start)) {
        used += chars[end].width;
        if (/\s/.test(chars[end].text)) whitespace = end;
        end++;
      }
      // Keep ordinary Latin words together where a recent space permits it.
      if (end < chars.length && /^[a-z0-9]/i.test(chars[end].text) && /^[a-z0-9]/i.test(chars[end - 1].text) && whitespace > start && whitespace > start + (end - start) / 2) end = whitespace + 1;
      if (end < chars.length && end - start > 1 && opening.test(chars[end - 1].text)) end--;
      if (end < chars.length && end - start > 1 && closing.test(chars[end].text)) end--;
      if (end <= start) end = start + 1;
      var slice = chars.slice(start, end);
      while (slice.length && /^\s+$/.test(slice[slice.length - 1].text)) slice.pop();
      var runs = runsFrom(slice);
      result.push({ runs: runs, width: runWidth(runs, n, size, role) });
      start = end;
      while (start < chars.length && /^[ \t]+$/.test(chars[start].text)) start++;
    }
    return result.length ? result : [{ runs: [], width: 0 }];
  }
  function parseBody(body) {
    var blocks = [];
    body.replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      if (!line.trim()) { if (blocks.length) blocks[blocks.length - 1].extraGap = true; return; }
      if (/^\s*---+\s*$/.test(line)) { blocks.push({ kind: 'break' }); return; }
      var img = /^\s*!\[([^\]]*)\]\(asset:([^\s)]+)\)\s*$/.exec(line);
      if (img) { blocks.push({ kind: 'image', caption: img[1], assetId: img[2] }); return; }
      var heading = /^\s*(#{1,3})\s+(.+)$/.exec(line);
      if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] }); return; }
      var list = /^\s*(?:([-*•])|(\d+[.)、]))\s+(.+)$/.exec(line);
      if (list) { blocks.push({ kind: 'list', marker: list[2] || '•', text: list[3] }); return; }
      var quote = /^\s*>\s?(.*)$/.exec(line);
      if (quote) { blocks.push({ kind: 'quote', text: quote[1] }); return; }
      blocks.push({ kind: 'paragraph', text: line });
    });
    return blocks;
  }
  async function layout(input) {
    var normalized = normalize(input || {}), n = normalized.note, t = normalized.template;
    var warnings = [], pages = [], contentWidth = W - n.padding * 2;
    if (document.fonts && document.fonts.load) {
      try {
        await Promise.all([
          document.fonts.load(font(n, n.bodySize, false, false, 'paragraph'), '纸间生活灵感'),
          document.fonts.load(font(n, n.titleSize, false, false, 'title'), '纸间生活灵感')
        ]);
        await document.fonts.ready;
      } catch (error) { warnings.push('所选字体未能加载，已使用备用字体；请检查 fonts 文件夹是否完整。'); }
    }
    var top = n.paddingTop + 8, bottom = H - n.paddingBottom - 38;
    var page, y, automaticOverflow = false;
    var titleSize = n.titleSize;
    function wrapTitle() {
      if (!n.showTitle || !n.title.trim()) return [];
      return n.title.replace(/\r\n?/g, '\n').split('\n').reduce(function (all, part) { return all.concat(wrap(part, n, titleSize, contentWidth, n.titleBold, 'title')); }, []);
    }
    var titleLines = wrapTitle();
    // Keep the chosen title size in both preview and export. Overflow is handled
    // by the same measured page breaks as the rest of the note.
    if (titleLines.length * titleSize * 1.23 > bottom - top) warnings.push('标题较长，已按所选字号跨页显示；可调小标题字号以减少页数。');
    var repeatedTitle = !!(n.repeatTitle && titleLines.length && titleLines.length * titleSize * 1.23 + n.bodySize * n.lineHeight + 46 < bottom - top);
    if (n.repeatTitle && titleLines.length && !repeatedTitle) warnings.push('标题过长，仅在开头显示完整标题，后续页面优先保留正文。');
    function textItem(line, role, size, x, width, align, extra) {
      return Object.assign({ kind: 'text', role: role, runs: line.runs, textWidth: line.width, x: x, y: y, width: width, size: size, lineHeight: role === 'title' ? size * 1.23 : size * n.lineHeight, align: align || 'left' }, extra || {});
    }
    function repeatHeader() {
      titleLines.forEach(function (line, i) {
        page.items.push(textItem(line, 'title', titleSize, n.padding, contentWidth, n.align, { titleFirst: i === 0, titleLast: i === titleLines.length - 1 }));
        y += titleSize * 1.23;
      });
      y += 34;
    }
    function newPage(isAutomatic, skipRepeat) {
      if (isAutomatic) automaticOverflow = true;
      page = { index: pages.length, items: [], hasContent: false }; pages.push(page); y = top;
      if (pages.length > 1 && repeatedTitle && !skipRepeat) repeatHeader();
    }
    function ensure(height, skipRepeat) {
      if (y + height <= bottom + 0.1 || !page.items.length) return;
      var headerHeight = repeatedTitle ? titleLines.length * titleSize * 1.23 + 34 : 0;
      var omitHeader = skipRepeat || (repeatedTitle && height > bottom - top - headerHeight);
      // A large heading or illustration can need more room than a repeated title
      // leaves. Omit that optional repeat instead of creating an empty page or
      // allowing the body to overrun the footer.
      if (!page.hasContent) { page.items = []; y = top; if (!omitHeader && repeatedTitle) repeatHeader(); return; }
      newPage(true, omitHeader);
    }
    newPage(false);
    titleLines.forEach(function (line, i) {
      ensure(titleSize * 1.23, true);
      page.items.push(textItem(line, 'title', titleSize, n.padding, contentWidth, n.align, { titleFirst: i === 0, titleLast: i === titleLines.length - 1 }));
      page.hasContent = true;
      y += titleSize * 1.23;
    });
    if (titleLines.length) y += 34;
    var blocks = parseBody(n.body);
    for (var bi = 0; bi < blocks.length; bi++) {
      var block = blocks[bi];
      if (block.kind === 'break') { if (page.hasContent) newPage(false); continue; }
      if (block.kind === 'image') {
        var asset = n.assets[block.assetId], src = typeof asset === 'string' ? asset : asset && asset.dataUrl;
        var img = await imageFor(src);
        if (!img) {
          warnings.push('正文图片未能读取：' + (block.caption || block.assetId));
          block = { kind: 'paragraph', text: '[图片未载入：' + (block.caption || block.assetId) + ']' };
        } else {
          var iw = Math.min(contentWidth, img.naturalWidth), ih = iw * img.naturalHeight / img.naturalWidth;
          var capSize = Math.max(16, n.bodySize * 0.64);
          var caps = block.caption ? wrap(block.caption, n, capSize, contentWidth, false, 'caption') : [];
          var capReserve = caps.length ? capSize * 1.5 + 12 : 0;
          var maxImageH = Math.max(90, bottom - top - (repeatedTitle ? titleLines.length * titleSize * 1.23 + 34 : 0) - capReserve - 8);
          if (ih > Math.min(600, maxImageH)) { iw *= Math.min(600, maxImageH) / ih; ih = Math.min(600, maxImageH); }
          ensure(ih + capReserve);
          page.items.push({ kind: 'image', src: src, x: (W - iw) / 2, y: y, width: iw, height: ih });
          page.hasContent = true;
          y += ih;
          if (caps.length) {
            y += 12;
            caps.forEach(function (line) { ensure(capSize * 1.5); page.items.push(textItem(line, 'caption', capSize, n.padding, contentWidth, 'center', { lineHeight: capSize * 1.5 })); page.hasContent = true; y += capSize * 1.5; });
          }
          y += n.paragraphGap + (block.extraGap ? n.paragraphGap * 0.5 : 0);
          continue;
        }
      }
      var headingSize = n.bodySize * (block.level === 1 ? 1.4 : block.level === 2 ? 1.2 : 1.08);
      var size = block.kind === 'heading' ? headingSize : n.bodySize;
      var indent = block.kind === 'quote' ? 27 : block.kind === 'list' ? Math.max(32, n.bodySize * 1.05) : 0;
      var lineWidth = contentWidth - indent;
      var lines = wrap(block.text, n, size, lineWidth, block.kind === 'heading' && n.titleBold, block.kind);
      var lh = size * n.lineHeight;
      if (block.kind === 'heading') { ensure(lh + n.bodySize * n.lineHeight + 8); y += page.items.length ? 8 : 0; }
      for (var li = 0; li < lines.length; li++) {
        ensure(lh);
        page.items.push(textItem(lines[li], block.kind, size, n.padding + indent, lineWidth, block.kind === 'quote' || block.kind === 'list' ? 'left' : n.align, { marker: block.kind === 'list' && li === 0 ? block.marker : '', markerX: n.padding, quoteX: n.padding, lineHeight: lh }));
        page.hasContent = true;
        y += lh;
      }
      y += (block.kind === 'heading' ? n.paragraphGap * 0.75 : n.paragraphGap) + (block.extraGap ? n.paragraphGap * 0.5 : 0);
    }
    if (pages.length > 1 && !pages[pages.length - 1].hasContent) pages.pop();
    if (!n.autoPaginate && automaticOverflow) warnings.push('内容超过单页可容纳范围，已继续分页，确保文字完整。可调小字号、行距，或使用 --- 手动分页。');
    if (n.background.dataUrl && !(await imageFor(n.background.dataUrl))) warnings.push('底图未能读取，已使用当前模板背景。');
    return { note: n, template: t, colors: n.colors, pages: pages, warnings: Array.from(new Set(warnings)), width: W, height: H };
  }
  function rounded(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  }
  function rng(seed) { var a = seed || 29; return function () { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
  function line(ctx, x1, y1, x2, y2, color, width, opacity) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width || 1; ctx.globalAlpha = opacity == null ? 1 : opacity;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }
  function ellipse(ctx, x, y, rx, ry, color, opacity, rotation) {
    ctx.save(); ctx.globalAlpha = opacity == null ? 1 : opacity; ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rotation || 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function border(ctx, c, inset, width, opacity) {
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = width || 1; ctx.globalAlpha = opacity == null ? 0.4 : opacity; ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2); ctx.restore();
  }
  function star(ctx, x, y, radius, color, opacity) {
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = opacity || 0.6; ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, -radius); ctx.quadraticCurveTo(radius * .15, -radius * .15, radius, 0); ctx.quadraticCurveTo(radius * .15, radius * .15, 0, radius); ctx.quadraticCurveTo(-radius * .15, radius * .15, -radius, 0); ctx.quadraticCurveTo(-radius * .15, -radius * .15, 0, -radius); ctx.fill(); ctx.restore();
  }
  function leaf(ctx, x, y, scale, angle, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = .34;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(25, -50, 0, -118); ctx.stroke();
    for (var i = 0; i < 5; i++) { ellipse(ctx, i % 2 ? 14 : -10, -17 - i * 19, 8, 21, color, .7, i % 2 ? .65 : -.65); }
    ctx.restore();
  }
  function paw(ctx, x, y, scale, c) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-.25); ctx.scale(scale, scale);
    ellipse(ctx, 0, 9, 15, 12, c, .20); ellipse(ctx, -18, -8, 6, 8, c, .2, -.5); ellipse(ctx, -6, -17, 6, 8, c, .2); ellipse(ctx, 8, -16, 6, 8, c, .2); ellipse(ctx, 20, -6, 6, 8, c, .2, .5); ctx.restore();
  }
  function block(ctx, x, y, w, h, color, opacity, radius) {
    ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = opacity == null ? 1 : opacity;
    if (radius) { rounded(ctx, x, y, w, h, radius); ctx.fill(); } else ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  function arcLine(ctx, x, y, radius, start, end, color, width, opacity) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width || 1; ctx.globalAlpha = opacity == null ? 1 : opacity;
    ctx.beginPath(); ctx.arc(x, y, radius, start, end); ctx.stroke(); ctx.restore();
  }
  function cloud(ctx, x, y, s, color, opacity) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha = opacity; ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(-45, 12); ctx.bezierCurveTo(-65, 10, -56, -17, -34, -13); ctx.bezierCurveTo(-27, -43, 12, -40, 20, -13); ctx.bezierCurveTo(47, -30, 66, 9, 42, 12); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function fruit(ctx, x, y, color, leafColor, peach) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = color; ctx.globalAlpha = .55;
    ctx.beginPath(); ctx.moveTo(0, 14); ctx.bezierCurveTo(-28, -2, -16, -22, 0, -10); ctx.bezierCurveTo(16, -22, 28, -2, 0, 14); ctx.fill();
    if (!peach) { [-8, 0, 8].forEach(function (sx, j) { ellipse(ctx, sx, j === 1 ? 5 : -2, 1, 1.5, '#FFFFFF', .9); }); }
    ellipse(ctx, 4, -15, 8, 3, leafColor, .75, -.5); ctx.restore();
  }
  function ribbon(ctx, x, y, scale, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
    [-1, 1].forEach(function (side) {
      ctx.save(); ctx.scale(side, 1);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(19, -29, 51, -25, 44, -5); ctx.bezierCurveTo(41, 10, 15, 9, 0, 0);
      ctx.fillStyle = color; ctx.globalAlpha = .16; ctx.fill(); ctx.globalAlpha = .65; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(3, 4); ctx.bezierCurveTo(9, 19, 25, 23, 24, 40); ctx.lineTo(15, 35); ctx.lineTo(9, 41); ctx.bezierCurveTo(12, 23, 1, 20, 0, 5); ctx.stroke();
      ctx.restore();
    });
    ellipse(ctx, 0, 0, 5, 6, color, .6); ctx.restore();
  }
  function blossom(ctx, x, y, scale, color, center) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    for (var j = 0; j < 5; j++) { var angle = j * Math.PI * 2 / 5; ellipse(ctx, Math.cos(angle) * 9, Math.sin(angle) * 9, 9, 6, color, .38, angle); }
    ellipse(ctx, 0, 0, 3, 3, center, .7); ctx.restore();
  }
  function butterfly(ctx, x, y, scale, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-.25); ctx.scale(scale, scale);
    [-1, 1].forEach(function (side) {
      ellipse(ctx, side * 12, -10, 15, 21, color, .2, side * .55);
      ellipse(ctx, side * 11, 12, 12, 13, color, .3, -side * .4);
      line(ctx, 0, 9, side * 17, -18, color, 1, .35);
      line(ctx, 0, -11, side * 6, -22, color, 1, .5);
    });
    line(ctx, 0, -13, 0, 22, color, 2, .55); ctx.restore();
  }
  function rose(ctx, x, y, scale, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    for (var j = 0; j < 6; j++) { var a = j * Math.PI / 3; ellipse(ctx, Math.cos(a) * 7, Math.sin(a) * 7, 10, 7, color, .22, a); }
    for (j = 0; j < 3; j++) arcLine(ctx, j - 2, j, 4 + j * 3, j * 2, j * 2 + Math.PI * 1.4, color, 1, .65);
    ctx.restore();
  }

  function drawSoftPattern(ctx, p, c) {
    var i, x, y, a, g;
    switch (p) {
      case 'roseribbon':
        line(ctx, 25, 32, W / 2 - 51, 32, c.accent, 1, .35); line(ctx, W / 2 + 51, 32, W - 25, 32, c.accent, 1, .35);
        ribbon(ctx, W / 2, 30, .7, c.accent);
        border(ctx, c.accent, 23, .8, .18);
        for (i = 0; i < 7; i++) ellipse(ctx, W / 2 - 36 + i * 12, H - 22, 1.5, 1.5, c.accent, .45);
        break;
      case 'lacelily':
        border(ctx, c.accent, 34, .7, .4);
        for (x = 38; x < W - 26; x += 22) {
          arcLine(ctx, x, 17, 10, 0, Math.PI, c.accent, .9, .35); arcLine(ctx, x, H - 17, 10, Math.PI, Math.PI * 2, c.accent, .9, .35);
          ellipse(ctx, x, 18, 1.5, 1.5, c.accent, .4); ellipse(ctx, x, H - 18, 1.5, 1.5, c.accent, .4);
        }
        for (y = 40; y < H - 26; y += 22) {
          arcLine(ctx, 17, y, 10, -Math.PI / 2, Math.PI / 2, c.accent, .9, .35); arcLine(ctx, W - 17, y, 10, Math.PI / 2, Math.PI * 1.5, c.accent, .9, .35);
        }
        ribbon(ctx, W / 2, 28, .45, c.accent);
        break;
      case 'tulipmorning':
        [[25, H - 145, -.2], [45, H - 172, .15], [W - 24, 43, .2]].forEach(function (point) {
          ctx.save(); ctx.translate(point[0], point[1]); ctx.rotate(point[2]);
          line(ctx, 0, 0, 0, 110, c.accent, 1.5, .6); ellipse(ctx, -7, 66, 5, 23, c.accent, .22, -.5); ellipse(ctx, 7, 88, 5, 23, c.accent, .22, .5);
          ctx.beginPath(); ctx.moveTo(-13, -9); ctx.lineTo(-5, -2); ctx.lineTo(0, -15); ctx.lineTo(5, -2); ctx.lineTo(13, -9); ctx.bezierCurveTo(19, 22, -19, 22, -13, -9); ctx.fillStyle = c.accent; ctx.globalAlpha = .55; ctx.fill(); ctx.restore();
        });
        line(ctx, 22, 27, W - 52, 27, c.accent, 1, .25); break;
      case 'sakurabreeze':
        ctx.save(); ctx.strokeStyle = c.accent; ctx.lineWidth = 1; ctx.globalAlpha = .45; ctx.beginPath(); ctx.moveTo(W - 210, 0); ctx.quadraticCurveTo(W - 116, 15, W, 70); ctx.stroke(); ctx.restore();
        [[W - 185, 8, .7], [W - 135, 25, .9], [W - 76, 44, .8], [W - 20, 63, .6], [19, H - 49, .8], [52, H - 21, .65]].forEach(function (point) { blossom(ctx, point[0], point[1], point[2], c.accent, c.muted); });
        [[18, 225], [W - 22, 345], [20, 675], [W - 31, 900]].forEach(function (point) { ellipse(ctx, point[0], point[1], 3, 7, c.accent, .23, -.5); }); break;
      case 'pearlglow':
        for (i = 0; i < 29; i++) {
          a = i * Math.PI / 28; x = W / 2 + Math.cos(a) * (W / 2 - 38); y = 16 + Math.sin(a) * 27;
          ellipse(ctx, x + 1, y + 1, 4, 4, c.accent, .25); ellipse(ctx, x, y, 3.4, 3.4, '#FFFFFF', .8); ellipse(ctx, x - 1, y - 1, 1, 1, c.accent, .15);
        }
        border(ctx, c.accent, 24, .7, .18); star(ctx, W - 28, H - 41, 7, c.accent, .5); star(ctx, W - 47, H - 28, 4, c.accent, .35); break;
      case 'balletdiary':
        ellipse(ctx, W, H, 210, 150, c.accent, .06);
        for (i = 0; i < 11; i++) { y = 42 + i * 24; line(ctx, 10, y, 34, y + 24, c.accent, 1.3, .25); line(ctx, 34, y, 10, y + 24, c.accent, 1.3, .25); }
        ribbon(ctx, 22, 26, .38, c.accent); ribbon(ctx, W - 30, H - 45, .45, c.accent);
        for (i = 0; i < 4; i++) arcLine(ctx, W + 48, H + 24, 95 + i * 13, Math.PI, Math.PI * 1.5, c.accent, 1, .14); break;
      case 'butterflydream':
        butterfly(ctx, W - 47, 38, .75, c.accent); butterfly(ctx, 24, H - 58, .55, c.accent);
        ctx.save(); ctx.strokeStyle = c.accent; ctx.lineWidth = 1; ctx.globalAlpha = .22; ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.moveTo(W - 40, 74); ctx.bezierCurveTo(W - 9, 100, W - 50, 123, W - 24, 160); ctx.stroke(); ctx.restore();
        [[32, 30], [W - 21, 193], [60, H - 23]].forEach(function (point) { star(ctx, point[0], point[1], 4, c.accent, .4); }); break;
      case 'pinkgingham':
        for (x = 0; x < W; x += 24) { block(ctx, x, 0, 12, 28, c.accent, .12); block(ctx, x, H - 28, 12, 28, c.accent, .12); }
        for (y = 0; y < H; y += 24) { block(ctx, 0, y, 28, 12, c.accent, .12); block(ctx, W - 28, y, 28, 12, c.accent, .12); }
        block(ctx, 0, 8, W, 12, c.accent, .12); block(ctx, 0, H - 20, W, 12, c.accent, .12); block(ctx, 8, 0, 12, H, c.accent, .12); block(ctx, W - 20, 0, 12, H, c.accent, .12);
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .3; ctx.setLineDash([3, 6]); rounded(ctx, 37, 37, W - 74, H - 74, 12); ctx.stroke(); ctx.restore(); break;
      case 'rosestory':
        border(ctx, c.accent, 25, 1, .28); border(ctx, c.accent, 30, .5, .16);
        rose(ctx, W - 42, 36, 1.2, c.accent); rose(ctx, 28, H - 43, .85, c.accent);
        ellipse(ctx, W - 66, 27, 12, 4, c.accent, .26, .35); ellipse(ctx, W - 26, 57, 12, 4, c.accent, .26, .8);
        line(ctx, 32, H - 30, 52, H - 15, c.accent, 1, .4); ellipse(ctx, 48, H - 24, 8, 3, c.accent, .3, -.5); break;
      case 'butterflower':
        [[30, 31, .8], [W - 30, H - 32, 1], [W - 25, 105, .55], [22, H - 148, .6]].forEach(function (point) {
          ctx.save(); ctx.translate(point[0], point[1]); ctx.scale(point[2], point[2]);
          for (var j = 0; j < 8; j++) { a = j * Math.PI / 4; ellipse(ctx, Math.cos(a) * 11, Math.sin(a) * 11, 8, 4, '#FFFFFF', .9, a); }
          ellipse(ctx, 0, 0, 5, 5, c.accent, .7); ctx.restore();
        });
        line(ctx, 70, 26, W - 40, 26, c.accent, 1, .22); line(ctx, 27, 71, 27, H - 186, c.accent, .7, .18); break;
      case 'watercolorblush':
        [[0, 0, 220], [W, H, 250], [W + 60, 180, 150]].forEach(function (point) {
          g = ctx.createRadialGradient(point[0], point[1], 0, point[0], point[1], point[2]); g.addColorStop(0, c.accent); g.addColorStop(1, 'transparent');
          ctx.save(); ctx.globalAlpha = .2; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
        });
        for (i = 0; i < 16; i++) ellipse(ctx, 24 + i * 8, 16 + Math.sin(i) * 5, 1, 1.5, c.muted, .4);
        line(ctx, W - 100, H - 26, W - 20, H - 26, c.accent, 1, .4); break;
      case 'pinknotebook':
        block(ctx, 0, 0, 24, H, c.accent, .08); line(ctx, 37, 0, 37, H, c.accent, 1, .2);
        for (y = 125; y < H - 50; y += 53) line(ctx, 53, y, W - 35, y, c.accent, .6, .08);
        for (y = 42; y < H - 20; y += 62) { ellipse(ctx, 14, y, 3.5, 3.5, c.accent, .3); line(ctx, 0, y, 12, y, c.accent, 2, .4); }
        line(ctx, 65, 25, 175, 25, c.accent, 2, .32); break;
    }
  }

  function drawPattern(ctx, template, c, index) {
    var p = template.pattern, random = rng(73), x, y, i, g;
    var originalBg = c.bg.toLowerCase() === template.colors.bg.toLowerCase();
    var paperColor = originalBg ? '#FFFFFF' : c.bg;
    if (template.category === '柔美') { drawSoftPattern(ctx, p, c); return; }
    switch (p) {
      case 'grid':
        for (x = 0; x <= W; x += 40) line(ctx, x, 0, x, H, c.accent, 1, .11);
        for (y = 0; y <= H; y += 40) line(ctx, 0, y, W, y, c.accent, 1, .11);
        ctx.fillStyle = c.accent; ctx.fillRect(29, 29, 12, 12); ctx.fillRect(W - 41, H - 41, 12, 12); break;
      case 'wine':
        border(ctx, c.accent, 25, 1.3, .7); border(ctx, c.accent, 33, 1, .24);
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .24; ctx.lineWidth = 2;
        [0, 1].forEach(function (side) { ctx.beginPath(); ctx.arc(side ? W : 0, side ? H : 0, 150, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(side ? W : 0, side ? H : 0, 170, 0, Math.PI * 2); ctx.stroke(); }); ctx.restore();
        line(ctx, 54, 52, 158, 52, c.accent, 4, .8); break;
      case 'newyear':
        border(ctx, c.accent, 23, 2, .75);
        for (i = 0; i < 6; i++) { ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .19; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W - 4, 0, 80 + i * 29, 0, Math.PI); ctx.stroke(); ctx.beginPath(); ctx.arc(0, H, 60 + i * 30, Math.PI, 0); ctx.stroke(); ctx.restore(); }
        [[45, 45], [W - 45, H - 45]].forEach(function (a) { ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(Math.PI / 4); ctx.fillStyle = c.accent; ctx.globalAlpha = .85; ctx.fillRect(-10, -10, 20, 20); ctx.restore(); }); break;
      case 'travel':
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .17; ctx.lineWidth = 2;
        for (i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(610 + i * 45, 0); ctx.bezierCurveTo(590 + i * 38, 45, 730 + i * 28, 120, W, 140 + i * 25); ctx.stroke(); }
        ctx.setLineDash([4, 9]); ctx.beginPath(); ctx.moveTo(0, H - 64); ctx.bezierCurveTo(120, H - 170, 230, H - 35, 355, H - 32); ctx.stroke(); ctx.restore();
        ctx.save(); ctx.translate(W - 95, H - 82); ctx.rotate(-.16); ctx.strokeStyle = c.accent; ctx.globalAlpha = .4; ctx.lineWidth = 2; ctx.strokeRect(-45, -25, 90, 50); ctx.font = '12px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = c.accent; ctx.fillText('TAKE A NOTE', 0, 4); ctx.restore(); break;
      case 'magazine':
        line(ctx, 30, 34, W - 30, 34, c.text, 2, .8); line(ctx, 30, H - 34, W - 30, H - 34, c.text, 1, .55);
        ctx.fillStyle = c.accent; ctx.fillRect(31, 37, 38, 6); ctx.save(); ctx.font = '10px Arial'; ctx.letterSpacing = '3px'; ctx.fillStyle = c.muted; ctx.fillText('THE EVERYDAY JOURNAL', 82, 52); ctx.restore(); break;
      case 'herbal':
        border(ctx, c.accent, 29, 1, .28); leaf(ctx, W - 21, 137, 1.3, -.6, c.accent); leaf(ctx, 27, H - 40, 1.1, .6, c.accent);
        for (i = 0; i < 250; i++) ellipse(ctx, random() * W, random() * H, .6, .6, c.accent, .07); break;
      case 'pet':
        paw(ctx, W - 65, 82, 1.35, c.accent); paw(ctx, 48, H - 93, 1.1, c.accent); paw(ctx, W - 42, H / 2, .65, c.accent);
        for (i = 0; i < 11; i++) ellipse(ctx, 20 + i * 85, 24, 4, 4, c.accent, .35); border(ctx, c.accent, 28, 1, .12); break;
      case 'parenting':
        ellipse(ctx, W - 5, 0, 165, 145, c.accent, .14); ellipse(ctx, 15, H, 150, 170, c.accent, .13);
        ellipse(ctx, W - 85, 49, 19, 19, c.accent, .3); ellipse(ctx, W - 37, 74, 7, 7, c.accent, .4);
        line(ctx, 27, 26, 135, 26, c.accent, 7, .4); line(ctx, 27, 45, 89, 45, c.accent, 7, .18); break;
      case 'reading':
        ctx.save(); ctx.fillStyle = c.accent; ctx.globalAlpha = .075; ctx.fillRect(0, 0, 38, H); ctx.restore();
        line(ctx, 40, 0, 40, H, c.accent, 1, .27); border(ctx, c.accent, 23, 1, .16); line(ctx, W - 80, 33, W - 33, 33, c.accent, 2, .5); break;
      case 'sticky':
        ctx.save(); ctx.fillStyle = paperColor; ctx.globalAlpha = .18; rounded(ctx, 25, 32, W - 50, H - 60, 4); ctx.fill(); ctx.restore();
        ctx.save(); ctx.translate(W / 2, 22); ctx.rotate(-.035); ctx.fillStyle = c.accent; ctx.globalAlpha = .24; ctx.fillRect(-88, -18, 176, 37); ctx.restore();
        line(ctx, 31, H - 31, W - 31, H - 31, c.accent, 2, .17); break;
      case 'colorpages':
        ctx.save(); ctx.fillStyle = c.accent; ctx.globalAlpha = .12; rounded(ctx, 34, 40, W - 52, H - 59, 19); ctx.fill(); ctx.restore();
        ctx.save(); ctx.fillStyle = paperColor; ctx.globalAlpha = .72; rounded(ctx, 23, 23, W - 59, H - 60, 15); ctx.fill(); ctx.restore();
        for (i = 0; i < 3; i++) ellipse(ctx, W - 127 + i * 25, 45, 4, 4, c.accent, .5); break;
      case 'paper':
        for (i = 0; i < 3500; i++) { var px = random() * W, py = random() * H; line(ctx, px, py, px + random() * 4, py + random() * 2, c.accent, .65, .07 + random() * .08); }
        border(ctx, c.accent, 24, .8, .16); break;
      case 'memo':
        for (y = 115; y < H; y += 53) line(ctx, 31, y, W - 31, y, c.accent, .8, .13);
        line(ctx, 42, 34, 42, H - 34, c.accent, 1, .3);
        for (i = 0; i < 3; i++) ellipse(ctx, 26, 20 + i * 13, 2, 2, c.accent, .55); break;
      case 'magic':
        ellipse(ctx, W + 30, -40, 230, 220, c.accent, .09); ellipse(ctx, -15, H + 20, 200, 170, c.accent, .08);
        [[W - 70, 67, 22], [W - 123, 40, 7], [35, 173, 10], [41, H - 72, 18], [W - 37, H - 190, 8]].forEach(function (a) { star(ctx, a[0], a[1], a[2], c.accent, .55); }); border(ctx, c.accent, 25, 1, .15); break;
      case 'chinesecolor':
        border(ctx, c.accent, 26, 1.4, .45); border(ctx, c.accent, 32, .6, .2);
        ctx.save(); ctx.fillStyle = c.accent; ctx.globalAlpha = .8; ctx.fillRect(W - 59, 40, 18, 26); ctx.font = '14px serif'; ctx.fillStyle = c.bg; ctx.fillText('笺', W - 57, 59); ctx.restore();
        line(ctx, 25, H - 38, 150, H - 38, c.accent, 3, .45); break;
      case 'torn':
        ctx.save(); ctx.fillStyle = paperColor; ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(25, 23);
        for (x = 25; x < W - 25; x += 13) ctx.lineTo(x, 23 + random() * 8);
        ctx.lineTo(W - 25, H - 29); for (x = W - 25; x > 25; x -= 13) ctx.lineTo(x, H - 29 - random() * 9); ctx.closePath(); ctx.shadowColor = 'rgba(0,0,0,.06)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 5; ctx.fill(); ctx.restore();
        ctx.save(); ctx.translate(W - 100, 29); ctx.rotate(.18); ctx.fillStyle = c.accent; ctx.globalAlpha = .25; ctx.fillRect(-65, -12, 130, 25); ctx.restore(); break;
      case 'letter':
        border(ctx, c.accent, 27, 1, .35);
        for (i = 0; i < 17; i++) { line(ctx, 31 + i * 52, 32, 47 + i * 52, 32, c.accent, 3, .25); line(ctx, 31 + i * 52, H - 32, 47 + i * 52, H - 32, c.accent, 3, .25); }
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .33; ctx.setLineDash([3, 4]); ctx.strokeRect(W - 84, 43, 40, 45); ctx.restore(); break;
      case 'pixel':
        g = ctx.createLinearGradient(0, H, W, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, c.accent); ctx.save(); ctx.globalAlpha = .16; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
        for (i = 0; i < 90; i++) { x = Math.floor(random() * 17) * 20 + 580; y = Math.floor(random() * 12) * 20; ctx.save(); ctx.globalAlpha = .08 + random() * .2; ctx.fillStyle = c.accent; ctx.fillRect(x, y, 14, 14); ctx.restore(); }
        for (i = 0; i < 16; i++) { ctx.save(); ctx.globalAlpha = .07 + random() * .16; ctx.fillStyle = c.accent; ctx.fillRect(random() * 230, H - random() * 115, 9, 9); ctx.restore(); } break;
      case 'cool':
        line(ctx, 27, 29, 180, 29, c.accent, 9, .9); line(ctx, W - 180, H - 29, W - 27, H - 29, c.accent, 9, .9);
        for (i = 0; i < 12; i++) line(ctx, W - 147 + i * 15, 0, W - 42 + i * 15, 100, c.accent, 2, .15);
        border(ctx, c.accent, 26, 1, .2); break;
      case 'texture':
        ctx.save(); ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.globalAlpha = .15;
        for (i = 0; i < 12; i++) { ctx.beginPath(); ctx.moveTo(W - 150 + i * 17, -40); ctx.bezierCurveTo(W - 250 + i * 20, 70, W - 35 + i * 10, 82, W + 30, 190 + i * 18); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-30, H - 180 + i * 15); ctx.bezierCurveTo(65, H - 215 + i * 18, 70, H - 36 + i * 12, 210 + i * 15, H + 30); ctx.stroke(); }
        ctx.restore(); break;
      case 'retro':
        border(ctx, c.accent, 23, 2, .55); border(ctx, c.accent, 30, .8, .4);
        [[42, 42], [W - 42, 42], [42, H - 42], [W - 42, H - 42]].forEach(function (a) { star(ctx, a[0], a[1], 8, c.accent, .7); });
        for (i = 0; i < 1000; i++) ellipse(ctx, random() * W, random() * H, .5, .5, c.text, .04); break;
      case 'narrative':
        ctx.save(); ctx.fillStyle = c.accent; ctx.globalAlpha = .09; ctx.fillRect(0, 0, 29, H); ctx.fillRect(W - 29, 0, 29, H); ctx.restore();
        for (y = 25; y < H; y += 46) { ctx.save(); ctx.fillStyle = c.accent; ctx.globalAlpha = .25; rounded(ctx, 8, y, 12, 22, 3); ctx.fill(); rounded(ctx, W - 20, y, 12, 22, 3); ctx.fill(); ctx.restore(); }
        line(ctx, 45, 35, 145, 35, c.accent, 2, .4); break;
      case 'tech':
        for (x = 0; x <= W; x += 45) line(ctx, x, 0, x, H, c.accent, .6, .045);
        for (y = 0; y <= H; y += 45) line(ctx, 0, y, W, y, c.accent, .6, .045);
        for (i = 0; i < 6; i++) { var dy = 25 + i * 20; line(ctx, W - 180 + i * 15, 0, W - 180 + i * 15, dy, c.accent, 1.5, .27); line(ctx, W - 180 + i * 15, dy, W - 120 + i * 15, dy + 60, c.accent, 1.5, .27); line(ctx, W - 120 + i * 15, dy + 60, W, dy + 60, c.accent, 1.5, .27); ellipse(ctx, W - 180 + i * 15, dy, 3, 3, c.accent, .5); }
        line(ctx, 27, H - 29, 150, H - 29, c.accent, 3, .6); break;
      case 'blackjump':
        ctx.save(); ctx.fillStyle = c.accent; ctx.fillRect(28, 28, 85, 9); ctx.fillRect(28, 28, 9, 60); ctx.fillRect(W - 113, H - 37, 85, 9); ctx.fillRect(W - 37, H - 88, 9, 60); ctx.globalAlpha = .12; ctx.translate(W - 30, 14); ctx.rotate(.5); ctx.fillRect(0, 0, 85, 200); ctx.restore();
        line(ctx, W - 91, 30, W - 42, 79, c.accent, 7, .7); break;
      case 'techminimal':
        for (x = W - 165; x < W - 20; x += 16) for (y = 25; y < 136; y += 16) ellipse(ctx, x, y, 1.8, 1.8, c.accent, .28);
        line(ctx, 28, 28, 170, 28, c.accent, 2, .55); line(ctx, 28, 28, 28, 170, c.accent, 2, .55);
        line(ctx, W - 28, H - 28, W - 170, H - 28, c.accent, 2, .55); line(ctx, W - 28, H - 28, W - 28, H - 170, c.accent, 2, .55); break;
      // These thirty original edge treatments share the same content rectangle.
      // Motifs are kept in the margin so long notes remain readable on every page.
      case 'creamjournal':
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .28; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(22, 0); for (y = 0; y < H; y += 36) { ctx.quadraticCurveTo(40, y + 9, 22, y + 18); ctx.quadraticCurveTo(4, y + 27, 22, y + 36); } ctx.stroke(); ctx.restore();
        for (x = 58; x < W - 38; x += 17) { ellipse(ctx, x, 18, 1.4, 1.4, c.accent, .4); ellipse(ctx, x, H - 18, 1.4, 1.4, c.accent, .32); }
        block(ctx, W - 24, 115, 17, 73, c.accent, .28, 8); block(ctx, W - 24, 201, 17, 43, c.accent, .13, 8); break;
      case 'butterchecker':
        for (i = 0; i < 2; i++) for (x = 0; x < W; x += 15) if ((x / 15 + i) % 2 === 0) { block(ctx, x, i * 15, 15, 15, c.accent, .28); block(ctx, x, H - 30 + i * 15, 15, 15, c.accent, .2); }
        line(ctx, 16, 43, 16, H - 43, c.accent, 1, .16); line(ctx, W - 16, 43, W - 16, H - 43, c.accent, 1, .16); break;
      case 'strawberrynote':
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .29; ctx.setLineDash([3, 9]); rounded(ctx, 22, 23, W - 44, H - 46, 20); ctx.stroke(); ctx.restore();
        fruit(ctx, 111, 14, c.accent, '#7E986C', false); fruit(ctx, W - 111, 14, c.accent, '#7E986C', false);
        [[15, 117], [W - 15, 238], [W - 16, H - 72]].forEach(function (a) { ellipse(ctx, a[0], a[1], 3, 3, c.accent, .35); }); break;
      case 'blueberrymilk':
        [[95, 14, 9], [114, 17, 8], [132, 11, 10], [W - 29, 142, 8]].forEach(function (a) { ellipse(ctx, a[0], a[1], a[2], a[2], c.accent, .47); star(ctx, a[0], a[1], 3, c.bg, .7); });
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .24; ctx.lineWidth = 3;
        for (i = 0; i < 2; i++) { ctx.beginPath(); ctx.moveTo(0, H - 11 - i * 13); for (x = 0; x < W; x += 90) ctx.bezierCurveTo(x + 25, H - 31 - i * 8, x + 65, H + 6 - i * 13, x + 90, H - 11 - i * 13); ctx.stroke(); } ctx.restore();
        line(ctx, W - 17, 214, W - 17, H - 72, c.accent, 1, .13); break;
      case 'matchadiary':
        ctx.save(); ctx.beginPath(); ctx.rect(W - 28, 0, 28, 260); ctx.clip();
        for (i = 0; i < 5; i++) arcLine(ctx, W + 30 + i, 131, 73 + i * 2, -.9, 2.9, c.accent, 2, .12); ctx.restore();
        leaf(ctx, 11, H - 28, .4, .08, c.accent); leaf(ctx, 22, H - 78, .36, -.17, c.accent);
        for (i = 0; i < 45; i++) ellipse(ctx, 55 + random() * 650, 8 + random() * 16, 1, .5, c.accent, .16); break;
      case 'lattetime':
        block(ctx, W - 143, 8, 44, 18, c.accent, .23, 7); arcLine(ctx, W - 96, 16, 8, -Math.PI / 2, Math.PI / 2, c.accent, 2, .5); line(ctx, W - 150, 29, W - 90, 29, c.accent, 2, .45);
        for (i = 0; i < 3; i++) { ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .3; ctx.beginPath(); ctx.moveTo(W - 132 + i * 12, 6); ctx.bezierCurveTo(W - 143 + i * 12, -3, W - 123 + i * 12, -4, W - 134 + i * 12, -15); ctx.stroke(); ctx.restore(); }
        ctx.save(); ctx.beginPath(); ctx.rect(0, H - 96, 29, 96); ctx.clip(); arcLine(ctx, -16, H - 42, 55, 0, Math.PI * 2, c.accent, 4, .15); arcLine(ctx, -16, H - 42, 47, 0, Math.PI * 2, c.accent, 1, .23); ctx.restore(); break;
      case 'peachmood':
        fruit(ctx, W - 127, 13, c.accent, '#A5A477', true); fruit(ctx, 87, H - 12, c.accent, '#A5A477', true);
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .22; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(12, 90); ctx.bezierCurveTo(35, 170, -4, 245, 14, 325); ctx.stroke(); ctx.beginPath(); ctx.moveTo(W - 12, H - 90); ctx.bezierCurveTo(W - 35, H - 170, W + 4, H - 245, W - 14, H - 325); ctx.stroke(); ctx.restore();
        ellipse(ctx, W - 169, 15, 4, 4, c.accent, .3); ellipse(ctx, 124, H - 15, 2, 2, c.accent, .4); break;
      case 'lavenderletter':
        [0, 1].forEach(function (side) { var lx = side ? W - 14 : 14, ly = side ? 76 : H - 84; line(ctx, lx, ly - 49, lx, ly + 39, c.accent, 1.2, .4); for (var k = 0; k < 6; k++) { ellipse(ctx, lx + (k % 2 ? 4 : -4), ly - 35 + k * 7, 3, 6, c.accent, .35, k % 2 ? .5 : -.5); } });
        line(ctx, 35, 15, W - 35, 15, c.accent, 1, .16); line(ctx, W - 150, H - 12, W - 99, H - 28, c.accent, 1, .32); line(ctx, W - 99, H - 28, W - 48, H - 12, c.accent, 1, .32); line(ctx, W - 150, H - 12, W - 48, H - 12, c.accent, 1, .32); break;
      case 'mintchecklist':
        for (y = 90; y < H - 70; y += 150) { ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .45; rounded(ctx, 10, y, 13, 13, 3); ctx.stroke(); ctx.restore(); }
        for (x = 65; x < W - 65; x += 14) ellipse(ctx, x, 18, 1.1, 1.1, c.accent, .32);
        block(ctx, W - 151, H - 23, 115, 7, c.accent, .15, 4); block(ctx, W - 151, H - 23, 74, 7, c.accent, .52, 4); break;
      case 'seasaltbubble':
        [[14, 104, 14], [W - 9, 190, 22], [17, H - 145, 9], [W - 25, H - 90, 8], [W - 102, 13, 11]].forEach(function (a) { arcLine(ctx, a[0], a[1], a[2], 0, Math.PI * 2, c.accent, 1.2, .28); arcLine(ctx, a[0] - 1, a[1] - 1, a[2] - 4, 3.5, 4.5, '#FFFFFF', 2.5, .9); });
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .22; ctx.beginPath(); ctx.moveTo(100, H - 15); ctx.bezierCurveTo(260, H - 29, 386, H - 1, 530, H - 15); ctx.bezierCurveTo(665, H - 28, 754, H - 8, 810, H - 13); ctx.stroke(); ctx.restore(); break;
      case 'tomatomagazine':
        block(ctx, 0, 0, 219, 15, c.accent, .9); block(ctx, W - 146, H - 15, 146, 15, c.accent, .86); line(ctx, 244, 14, W - 31, 14, c.text, 1, .4);
        arcLine(ctx, W + 13, 15, 94, 1.6, 3.0, c.accent, 14, .23); line(ctx, 15, 60, 15, 156, c.accent, 4, .65);
        for (i = 0; i < 3; i++) block(ctx, 40 + i * 17, H - 25, 9, 9, c.text, .28); break;
      case 'kleinblue':
        block(ctx, 0, 0, 28, 114, c.accent, .85); block(ctx, 28, 0, 126, 13, c.accent, .85); block(ctx, W - 92, H - 23, 92, 23, c.accent, .85);
        line(ctx, W - 149, 16, W - 31, 16, c.accent, 2, .7); line(ctx, W - 31, 16, W - 31, 30, c.accent, 2, .7);
        [0, 1, 2].forEach(function (j) { line(ctx, 14, H - 143 + j * 23, 28, H - 157 + j * 23, c.accent, 2, .55); }); break;
      case 'monomanifest':
        block(ctx, 0, 0, 100, 21, c.text, .92); block(ctx, 0, 21, 21, 74, c.text, .92); block(ctx, W - 22, H - 127, 22, 127, c.text, .92);
        [[W - 32, 20], [22, H - 28]].forEach(function (a) { line(ctx, a[0] - 7, a[1], a[0] + 7, a[1], c.text, 1, .6); line(ctx, a[0], a[1] - 7, a[0], a[1] + 7, c.text, 1, .6); });
        line(ctx, 110, 20, 274, 20, c.text, 1, .35); line(ctx, W - 197, H - 16, W - 46, H - 16, c.text, 4, .7); break;
      case 'neoninspiration':
        ctx.save(); ctx.translate(146, 14); ctx.rotate(-.018); block(ctx, -105, -7, 210, 14, c.accent, .46, 3); ctx.restore();
        ctx.save(); ctx.strokeStyle = c.text; ctx.globalAlpha = .24; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(W - 180, H - 13); for (i = 0; i < 12; i++) ctx.lineTo(W - 180 + i * 12, H - 13 + (i % 2 ? -5 : 2)); ctx.stroke(); ctx.restore();
        line(ctx, W - 16, 92, W - 16, 238, c.accent, 9, .2); ellipse(ctx, 17, H - 95, 2, 2, c.text, .4); break;
      case 'orangeenergy':
        for (i = 0; i < 13; i++) { var ra = Math.PI * i / 12; line(ctx, 161 + Math.cos(ra) * 11, -5 + Math.sin(ra) * 11, 161 + Math.cos(ra) * 31, -5 + Math.sin(ra) * 31, c.accent, 2, .6); }
        for (i = 0; i < 6; i++) line(ctx, W - 22, H - 161 + i * 24, W - 5, H - 178 + i * 24, c.accent, 5, .46);
        block(ctx, 0, H - 16, 165, 16, c.accent, .38); line(ctx, 14, 72, 14, 159, c.accent, 2, .4); break;
      case 'skyplan':
        cloud(ctx, 134, 13, .65, c.accent, .2); cloud(ctx, W - 111, 10, .45, c.accent, .16); cloud(ctx, W - 143, H - 9, .5, c.accent, .2);
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .3; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(12, 146); ctx.bezierCurveTo(34, 136, 29, 125, 16, 131); ctx.bezierCurveTo(4, 136, 7, 166, 18, 178); ctx.stroke(); ctx.restore();
        line(ctx, 68, H - 16, 138, H - 16, c.accent, 1, .25); line(ctx, 91, H - 23, 158, H - 23, c.accent, 1, .18); break;
      case 'weekjournal':
        for (i = 0; i < 7; i++) { block(ctx, W - 22, 92 + i * 121, 22, 81, c.accent, .15 + (i % 3) * .1, 5); line(ctx, 71 + i * 31, 12, 71 + i * 31, 25, c.accent, 2, i === index % 7 ? .75 : .2); }
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .25; ctx.setLineDash([2, 5]); line(ctx, 18, 61, 18, H - 61, c.accent, 1, .28); ctx.restore();
        line(ctx, 65, H - 17, 220, H - 17, c.accent, 2, .3); break;
      case 'bookexcerpt':
        [0, 1].forEach(function (j) { block(ctx, 72 + j * 13, 10, 7, 11, c.accent, .48, 2); line(ctx, 72 + j * 13, 21, 69 + j * 13, 27, c.accent, 2, .48); block(ctx, W - 101 + j * 13, H - 25, 7, 11, c.accent, .35, 2); line(ctx, W - 94 + j * 13, H - 14, W - 97 + j * 13, H - 8, c.accent, 2, .35); });
        line(ctx, 18, 70, 18, 250, c.accent, 1, .24); line(ctx, W - 18, H - 70, W - 18, H - 250, c.accent, 1, .24); break;
      case 'reviewlist':
        for (y = 74; y < H - 40; y += 110) { ellipse(ctx, 14, y + 1, 6, 6, c.accent, .17); ellipse(ctx, 14, y, 3.5, 3.5, c.bg, 1); }
        for (i = 0; i < 8; i++) block(ctx, 65 + i * 20, 13, 13, 9, c.accent, i < 5 ? .52 : .12, 2);
        line(ctx, 29, 38, 29, H - 38, c.accent, 1, .18); line(ctx, W - 22, 49, W - 22, 182, c.accent, 1, .25); break;
      case 'polaroidmemory':
        ctx.save(); ctx.shadowColor = 'rgba(70,45,25,.10)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 5; block(ctx, 23, 24, W - 46, H - 48, originalBg ? '#FFFCF6' : c.bg, 1, 2); ctx.restore();
        ctx.save(); ctx.translate(W / 2, 15); ctx.rotate(.026); block(ctx, -65, -9, 130, 18, c.accent, .26); ctx.restore();
        line(ctx, 25, 28, 42, 28, c.accent, 3, .45); line(ctx, W - 25, H - 28, W - 42, H - 28, c.accent, 3, .45); line(ctx, 28, H - 15, W - 28, H - 15, c.accent, 1, .22); break;
      case 'bookmarkpage':
        for (i = 0; i < 3; i++) { line(ctx, W - 9 - i * 5, 47, W - 9 - i * 5, H - 27 - i * 4, c.accent, 1, .18); line(ctx, 51, H - 9 - i * 5, W - 27 - i * 4, H - 9 - i * 5, c.accent, 1, .18); }
        ctx.save(); ctx.fillStyle = c.accent; ctx.globalAlpha = .62; ctx.beginPath(); ctx.moveTo(W - 151, 0); ctx.lineTo(W - 123, 0); ctx.lineTo(W - 123, 30); ctx.lineTo(W - 137, 22); ctx.lineTo(W - 151, 30); ctx.closePath(); ctx.fill(); ctx.restore();
        line(ctx, 15, 60, 15, H - 60, c.accent, 2, .15); break;
      case 'ticketdiary':
        ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .34; ctx.setLineDash([3, 6]); ctx.strokeRect(22, 21, W - 44, H - 42); ctx.restore();
        for (y = 73; y < H - 50; y += 47) { arcLine(ctx, 0, y, 13, -Math.PI / 2, Math.PI / 2, c.accent, 1, .23); arcLine(ctx, W, y, 13, Math.PI / 2, Math.PI * 1.5, c.accent, 1, .23); }
        for (i = 0; i < 46; i++) { x = W / 2 - 63 + i * 3; line(ctx, x, H - 21, x, H - 8 - (i % 3) * 2, c.accent, i % 4 ? 1 : 2, .42); } break;
      case 'graphstudy':
        for (x = 0; x < W; x += 22) line(ctx, x, 0, x, H, c.accent, .5, x % 110 ? .055 : .1);
        for (y = 0; y < H; y += 22) line(ctx, 0, y, W, y, c.accent, .5, y % 110 ? .055 : .1);
        line(ctx, 15, 22, 15, 145, c.accent, 1.5, .5); line(ctx, 15, 22, 137, 22, c.accent, 1.5, .5);
        for (i = 0; i < 8; i++) line(ctx, 34 + i * 13, 19, 34 + i * 13, 25, c.accent, 1, .4); line(ctx, W - 20, H - 55, W - 45, H - 12, c.accent, 3, .3); break;
      case 'tapecollage':
        [[144, 14, -.08], [W - 118, H - 14, .09]].forEach(function (a) { ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(a[2]); block(ctx, -60, -8, 120, 16, c.accent, .22); for (var j = -60; j <= 60; j += 12) line(ctx, j, -8, j, 8, c.bg, 2, .5); line(ctx, -60, 0, 60, 0, c.bg, 2, .5); ctx.restore(); });
        ctx.save(); ctx.fillStyle = c.accent; ctx.globalAlpha = .12; ctx.beginPath(); ctx.moveTo(0, 174); ctx.lineTo(25, 185); ctx.lineTo(20, 270); ctx.lineTo(0, 262); ctx.closePath(); ctx.fill(); ctx.restore();
        line(ctx, W - 17, 80, W - 17, 204, c.accent, 1, .23); break;
      case 'sunlitarch':
        ctx.save(); ctx.beginPath(); ctx.rect(W - 29, 0, 29, H); ctx.clip();
        for (i = 0; i < 5; i++) { arcLine(ctx, W + 42, 185, 87 + i * 12, Math.PI, Math.PI * 1.5, c.accent, 1.5, .22); line(ctx, W - 45 - i * 12, 185, W - 45 - i * 12, 305, c.accent, 1.5, .22); } ctx.restore();
        for (i = 0; i < 4; i++) line(ctx, 47 + i * 25, H - 5, 79 + i * 25, H - 28, c.accent, 9, .14);
        line(ctx, 41, 17, 214, 17, c.accent, 1, .28); break;
      case 'midnightmonologue':
        block(ctx, W - 23, 76, 15, 151, c.accent, .09); line(ctx, W - 27, 70, W - 27, 235, c.accent, 1.5, .48); line(ctx, W - 27, 150, W - 3, 150, c.accent, 1, .4);
        for (i = 0; i < 18; i++) { x = 65 + random() * 690; line(ctx, x, 5, x - 5, 19 + random() * 10, c.accent, .7, .12 + random() * .13); }
        ellipse(ctx, 18, H - 65, 8, 15, c.accent, .15); line(ctx, 18, H - 49, 18, H - 16, c.accent, 1, .3); line(ctx, 8, H - 16, 28, H - 16, c.accent, 1, .4); break;
      case 'moonmemo':
        ellipse(ctx, W - 123, 14, 15, 15, c.accent, .72); ellipse(ctx, W - 116, 9, 14, 14, c.bg, 1);
        [[W - 154, 20, 3], [W - 178, 12, 2], [61, H - 17, 4], [20, 148, 3]].forEach(function (a) { star(ctx, a[0], a[1], a[2], c.accent, .65); });
        ctx.save(); ctx.beginPath(); ctx.rect(0, H - 28, W, 28); ctx.clip(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .2; ctx.beginPath(); ctx.ellipse(W / 2, H + 25, 340, 45, -.03, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); break;
      case 'sunsetletter':
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 30); ctx.clip(); ellipse(ctx, 148, 31, 32, 32, c.accent, .42); ctx.restore();
        for (i = 0; i < 4; i++) line(ctx, 190 + i * 25, 9 + i * 5, W - 39, 9 + i * 5, c.accent, 1, .12 + i * .04);
        line(ctx, 61, H - 13, 402, H - 13, c.accent, 1, .3); line(ctx, 61, H - 22, 241, H - 22, c.accent, 2, .23); arcLine(ctx, W + 12, H - 94, 34, 2.1, 4.3, c.accent, 1, .25); break;
      case 'vintagefilm':
        block(ctx, 0, 0, 24, H, '#000000', .18); block(ctx, W - 24, 0, 24, H, '#000000', .18);
        for (y = 22; y < H; y += 42) { block(ctx, 7, y, 10, 19, c.accent, .28, 2); block(ctx, W - 17, y, 10, 19, c.accent, .28, 2); }
        line(ctx, 28, 12, W - 28, 12, c.accent, 1, .4); line(ctx, 28, H - 12, W - 28, H - 12, c.accent, 1, .4);
        for (i = 0; i < 80; i++) { x = random() * W; ellipse(ctx, x, random() < .5 ? random() * 25 : H - random() * 25, .6, .6, c.accent, .18); } break;
      case 'gallerynotes':
        [[111, 8, 23, 19], [154, 11, 17, 15], [W - 95, H - 27, 31, 19]].forEach(function (a, j) { line(ctx, a[0] + a[2] / 2, j < 2 ? 0 : H - 33, a[0] + a[2] / 2, a[1], c.accent, .8, .4); ctx.save(); ctx.strokeStyle = c.accent; ctx.globalAlpha = .6; ctx.strokeRect(a[0], a[1], a[2], a[3]); ctx.restore(); if (j !== 1) block(ctx, a[0] + 4, a[1] + 4, a[2] - 8, a[3] - 8, c.accent, .13); else line(ctx, a[0] + 4, a[1] + a[3] - 4, a[0] + a[2] - 4, a[1] + 4, c.accent, 1, .45); });
        line(ctx, 17, 94, 17, H - 94, c.accent, 1, .12); line(ctx, W - 17, 94, W - 17, H - 94, c.accent, 1, .12); break;
    }
  }
  function drawRich(ctx, item, n, c) {
    var x = item.align === 'center' ? item.x + (item.width - item.textWidth) / 2 : item.x;
    if (item.role === 'quote') {
      ctx.save(); ctx.globalAlpha = .075; ctx.fillStyle = c.accent; rounded(ctx, item.quoteX + 9, item.y - 3, W - n.padding - item.quoteX - 9, item.lineHeight + 4, 3); ctx.fill(); ctx.restore();
      line(ctx, item.quoteX + 2, item.y, item.quoteX + 2, item.y + item.lineHeight - 4, c.accent, 3, .6);
    }
    if (item.marker) { ctx.save(); ctx.globalAlpha = n.bodyOpacity; ctx.font = font(n, item.size, false, false, item.role); ctx.fillStyle = c.text; ctx.fillText(item.marker, item.markerX, item.y); ctx.restore(); }
    if (item.titleFirst && n.titleDecor) { line(ctx, n.padding - 20, item.y + 7, n.padding - 20, item.y + item.size * .9, c.accent, 5, .9); }
    item.runs.forEach(function (r) {
      ctx.font = font(n, item.size, r.bold, r.italic, item.role);
      var rw = ctx.measureText(r.text).width;
      if (r.highlight) { ctx.save(); ctx.globalAlpha = .24; ctx.fillStyle = c.accent; rounded(ctx, x - 2, item.y + item.size * .17, rw + 4, item.size * .95, 3); ctx.fill(); ctx.restore(); }
      ctx.fillStyle = item.role === 'title' || item.role === 'heading' ? c.title : c.text;
      ctx.save(); ctx.globalAlpha = item.role === 'title' || item.role === 'heading' ? n.titleOpacity : n.bodyOpacity;
      ctx.fillText(r.text, x, item.y); ctx.restore();
      x += rw;
    });
    if (item.titleLast && n.titleDecor) { var start = item.align === 'center' ? W / 2 - 27 : item.x; line(ctx, start, item.y + item.lineHeight + 13, start + 54, item.y + item.lineHeight + 13, c.accent, 3, .7); }
  }
  async function render(canvas, result, pageIndex, width) {
    width = Math.round(clamp(width, 60, 6000, 900));
    var page = result.pages[pageIndex || 0];
    if (!page) throw new Error('页面不存在');
    var n = result.note, c = result.colors || n.colors;
    canvas.width = width; canvas.height = Math.round(width * H / W);
    var ctx = canvas.getContext('2d');
    ctx.scale(width / W, canvas.height / H);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    // Composite decorative artwork as one layer: helpers set their own alpha.
    // A separate canvas keeps the user's opacity consistent for every pattern.
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    if (n.background.colorOpacity > 0) {
      var baseLayer, base = ctx;
      if (n.background.colorOpacity < 1) {
        baseLayer = document.createElement('canvas'); baseLayer.width = canvas.width; baseLayer.height = canvas.height;
        base = baseLayer.getContext('2d'); base.scale(width / W, canvas.height / H); base.textBaseline = 'top';
      }
      base.fillStyle = c.bg; base.fillRect(0, 0, W, H);
      if (n.background.patternOpacity === 1) drawPattern(base, result.template, c, pageIndex || 0);
      else if (n.background.patternOpacity > 0) {
        var artwork = document.createElement('canvas'); artwork.width = canvas.width; artwork.height = canvas.height;
        var art = artwork.getContext('2d'); art.scale(width / W, canvas.height / H); art.textBaseline = 'top';
        drawPattern(art, result.template, c, pageIndex || 0);
        base.save(); base.globalAlpha = n.background.patternOpacity; base.drawImage(artwork, 0, 0, W, H); base.restore();
      }
      if (baseLayer) { ctx.save(); ctx.globalAlpha = n.background.colorOpacity; ctx.drawImage(baseLayer, 0, 0, W, H); ctx.restore(); }
    }
    if (n.background && n.background.dataUrl) {
      var bg = await imageFor(n.background.dataUrl);
      if (bg) {
        var fit = n.background.fit === 'contain' ? Math.min(W / bg.naturalWidth, H / bg.naturalHeight) : Math.max(W / bg.naturalWidth, H / bg.naturalHeight);
        var bw = bg.naturalWidth * fit, bh = bg.naturalHeight * fit;
        var bx = (W - bw) * clamp(n.background.x, 0, 100, 50) / 100, by = (H - bh) * clamp(n.background.y, 0, 100, 50) / 100;
        ctx.save(); ctx.globalAlpha = n.background.opacity; ctx.drawImage(bg, bx, by, bw, bh); ctx.restore();
        ctx.save(); ctx.globalAlpha = n.background.overlay; ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H); ctx.restore();
      }
    }
    for (var i = 0; i < page.items.length; i++) {
      var item = page.items[i];
      if (item.kind === 'image') {
        var img = await imageFor(item.src);
        if (img) { ctx.save(); rounded(ctx, item.x, item.y, item.width, item.height, 7); ctx.clip(); ctx.drawImage(img, item.x, item.y, item.width, item.height); ctx.restore(); }
      } else drawRich(ctx, item, n, c);
    }
    // Footer stays outside the measured content rectangle on every page.
    var footerY = H - n.paddingBottom + 8;
    line(ctx, n.padding, footerY - 18, W - n.padding, footerY - 18, c.accent, 1, .22);
    ctx.font = font(n, 16, false, false); ctx.fillStyle = c.muted;
    if (n.showPageNumber) { var pageText = String((pageIndex || 0) + 1).padStart(2, '0') + ' / ' + String(result.pages.length).padStart(2, '0'); ctx.textAlign = 'right'; ctx.fillText(pageText, W - n.padding, footerY); ctx.textAlign = 'left'; }
    if (n.watermark) { ctx.save(); ctx.globalAlpha = .23; ctx.font = font(n, 14, false, false); ctx.textAlign = 'center'; ctx.fillStyle = c.text; ctx.fillText(String(n.watermark), W / 2, H - 23); ctx.restore(); }
    return canvas;
  }
  window.CardRenderer = Object.freeze({ layout: layout, render: render, clearCaches: function () { imageCache.clear(); }, baseWidth: W, baseHeight: H });
})();
