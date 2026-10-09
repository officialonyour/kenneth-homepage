(function () {
  'use strict';

  // This page shares the authenticated reader and period controls of app.js.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#08796b', '#5f68bd', '#c9832d', '#a54d72', '#587c8f'];
  const amountFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
  const integerFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
  let requestId = 0;
  let active = null;
  let pendingRoot = null;

  function finite(value, fallback = 0) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(n) ? n : fallback;
  }
  function money(value) { return '₩' + amountFormat.format(finite(value)); }
  function count(value) { return integerFormat.format(finite(value)); }
  function percentage(value) {
    const n = finite(value, null);
    return n === null ? '—' : `${n > 0 ? '+' : ''}${amountFormat.format(n)}%`;
  }
  function signClass(value) {
    const n = finite(value, null);
    return n > 0 ? 'at-positive' : n < 0 ? 'at-negative' : 'at-neutral';
  }
  function validMonth(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')); }
  function monthLabel(ym) {
    return validMonth(ym) ? `${String(ym).slice(0, 4)}년 ${Number(String(ym).slice(5))}월` : '—';
  }
  function scopeLabel(scope, period) {
    if (scope === 'year' && /^\d{4}$/.test(String(period))) return `${period}년`;
    if (scope === 'month' && validMonth(period)) return monthLabel(period);
    return '전체기간';
  }
  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = String(text);
    return result;
  }
  function svgNode(tag, attributes, text) {
    const result = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes || {}).forEach(([key, value]) => result.setAttribute(key, String(value)));
    if (text !== undefined) result.textContent = String(text);
    return result;
  }
  function chartEmpty(message = '이 기간에 등록된 월별 자료가 없습니다.') {
    return node('div', 'at-chart-empty', message);
  }
  function monthRows(rows, scope, period) {
    return (Array.isArray(rows) ? rows : []).filter(row => validMonth(row.ym)
      && (scope !== 'year' || String(row.ym).slice(0, 4) === String(period))
      && (scope !== 'month' || String(row.ym) === String(period)))
      .map(row => ({ ...row, ym: String(row.ym), revenue: finite(row.revenue) }))
      .sort((a, b) => a.ym.localeCompare(b.ym));
  }
  function chartRows(rows, range) {
    return range === '12' || range === '24' ? rows.slice(-Number(range)) : rows;
  }
  function compactAmount(value) {
    const n = finite(value), a = Math.abs(n);
    if (a >= 1e12) return `${amountFormat.format(n / 1e12)}조`;
    if (a >= 1e8) return `${amountFormat.format(n / 1e8)}억`;
    if (a >= 1e4) return `${amountFormat.format(n / 1e4)}만`;
    return amountFormat.format(n);
  }

  // One scale for every line; zero remains visible for negative corrections.
  function chartGeometry(values, width, height) {
    const safe = values.map(value => finite(value));
    let min = Math.min(0, ...safe), max = Math.max(0, ...safe);
    if (min === max) { min = 0; max = 1; }
    const span = max - min;
    if (min < 0) min -= span * .08;
    if (max > 0) max += span * .1;
    const margins = { left: 88, right: 24, top: 28, bottom: 46 };
    const h = height - margins.top - margins.bottom;
    return { width, height, margins, min, max,
      y: value => margins.top + h * (1 - (finite(value) - min) / (max - min)) };
  }
  function addAxes(svg, geometry, labels, x) {
    const { width, height, margins, min, max, y } = geometry;
    for (let i = 0; i <= 4; i++) {
      const value = min + (max - min) * i / 4;
      const yy = y(value);
      svg.append(svgNode('line', { class: 'at-grid-line', x1: margins.left, x2: width - margins.right, y1: yy, y2: yy }));
      svg.append(svgNode('text', { class: 'at-axis-label', x: margins.left - 12, y: yy + 4, 'text-anchor': 'end' }, compactAmount(value)));
    }
    if (min < 0 && max > 0) svg.append(svgNode('line', { class: 'at-zero-line', x1: margins.left, x2: width - margins.right, y1: y(0), y2: y(0) }));
    svg.append(svgNode('text', { class: 'at-axis-unit', x: margins.left, y: 13 }, '단위: 원'));
    const step = Math.max(1, Math.ceil((labels.length - 1) / 6));
    const indices = labels.map((_, i) => i).filter(i => i === 0 || i === labels.length - 1 || i % step === 0);
    // The last label must not overlap the preceding label on long series.
    if (indices.length > 2 && indices.at(-1) - indices.at(-2) < step * .7) indices.splice(-2, 1);
    indices.forEach(i => svg.append(svgNode('text', {
      class: 'at-axis-label', x: x(i), y: height - 17, 'text-anchor': 'middle'
    }, labels[i])));
  }
  function lineChart(months, series, title) {
    if (!months.length || !series.length) return chartEmpty();
    const width = 880, height = 310;
    const geometry = chartGeometry(series.flatMap(item => item.values), width, height);
    const { margins, y } = geometry;
    const x = i => margins.left + (width - margins.left - margins.right) * (months.length === 1 ? .5 : i / (months.length - 1));
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': title });
    svg.append(svgNode('title', {}, title));
    svg.append(svgNode('desc', {}, '모든 선은 같은 수익 축을 사용합니다. 점에 마우스를 올리면 월별 수익을 확인할 수 있습니다.'));
    addAxes(svg, geometry, months.map(ym => `${ym.slice(2, 4)}.${ym.slice(5)}`), x);
    series.forEach((item, index) => {
      const color = COLORS[index % COLORS.length];
      const points = months.map((ym, i) => ({ ym, value: finite(item.values[i]), x: x(i), y: y(item.values[i]) }));
      const path = points.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
      if (series.length === 1 && points.length > 1) {
        svg.append(svgNode('path', { class: 'at-area', d: `${path} L${points.at(-1).x.toFixed(2)},${y(0).toFixed(2)} L${points[0].x.toFixed(2)},${y(0).toFixed(2)} Z` }));
      }
      svg.append(svgNode('path', { class: 'at-series', d: path, stroke: color }));
      points.forEach(point => {
        const circle = svgNode('circle', { class: 'at-point', cx: point.x, cy: point.y, r: months.length === 1 ? 5 : 3.5, fill: color });
        circle.append(svgNode('title', {}, `${item.name} · ${monthLabel(point.ym)} · ${money(point.value)}`));
        svg.append(circle);
      });
    });
    return svg;
  }
  function yearChart(rows) {
    if (!rows.length) return chartEmpty('이 기간에 등록된 연간 자료가 없습니다.');
    const width = 880, height = 310;
    const geometry = chartGeometry(rows.map(row => row.revenue), width, height);
    const { margins, y } = geometry;
    const step = (width - margins.left - margins.right) / rows.length;
    const x = i => margins.left + step * (i + .5);
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': '선택기간 전체 음원의 연도별 합산 수익' });
    svg.append(svgNode('title', {}, '선택기간 전체 음원의 연도별 합산 수익'));
    addAxes(svg, geometry, rows.map(row => String(row.year)), x);
    rows.forEach((row, i) => {
      const value = finite(row.revenue), yy = y(value), baseline = y(0);
      const rect = svgNode('rect', {
        class: value < 0 ? 'at-year-bar at-year-bar-negative' : 'at-year-bar',
        x: x(i) - Math.min(52, step * .6) / 2, y: Math.min(yy, baseline),
        width: Math.min(52, step * .6), height: Math.max(1, Math.abs(yy - baseline)), rx: 4
      });
      rect.append(svgNode('title', {}, `${row.year}년 · ${money(value)}`));
      svg.append(rect);
    });
    return svg;
  }
  function panel(kicker, title, subtitle, chip) {
    const section = node('article', 'at-panel');
    const header = node('div', 'at-panel-head');
    const text = node('div', 'at-heading');
    text.append(node('p', 'at-kicker', kicker), node('h2', '', title));
    if (subtitle) text.append(node('p', 'at-subtitle', subtitle));
    header.append(text);
    if (chip) header.append(node('span', 'at-chip', chip));
    section.append(header);
    return section;
  }
  function kpi(label, value, sub, extraClass) {
    const card = node('article', 'at-kpi');
    card.append(node('span', 'at-kpi-label', label), node('strong', extraClass || '', value), node('p', 'at-kpi-sub', sub));
    return card;
  }
  function safeTop(rows, key) {
    return (Array.isArray(rows) ? rows : []).filter(row => row && String(row[key] || '').trim()).slice(0, 5);
  }
  function openTrackButton(title, options, className) {
    const button = node('button', className, title);
    button.type = 'button';
    button.title = `${title} 상세 분석 열기`;
    button.addEventListener('click', () => {
      if (typeof options.openTrack === 'function') options.openTrack(String(title));
    });
    return button;
  }
  function seriesFor(months, topRows, source, key) {
    const lookup = new Map();
    (Array.isArray(source) ? source : []).forEach(row => {
      if (!row || !validMonth(row.ym)) return;
      const name = String(row[key] || '');
      if (!lookup.has(name)) lookup.set(name, new Map());
      const byMonth = lookup.get(name);
      byMonth.set(String(row.ym), finite(byMonth.get(String(row.ym))) + finite(row.revenue));
    });
    return topRows.map(row => ({ name: String(row[key]), values: months.map(ym => finite(lookup.get(String(row[key]))?.get(ym))) }));
  }
  function appendTrend(section, months, topRows, source, key, options, title) {
    if (!topRows.length || !months.length) { section.append(chartEmpty()); return; }
    const legend = node('div', 'at-legend');
    topRows.forEach((row, index) => {
      const label = key === 'song_title'
        ? openTrackButton(String(row[key]), options, 'at-legend-item at-track-link')
        : node('span', 'at-legend-item', String(row[key]));
      const marker = node('i', 'at-legend-dot');
      marker.style.backgroundColor = COLORS[index % COLORS.length];
      marker.setAttribute('aria-hidden', 'true');
      label.prepend(marker);
      legend.append(label);
    });
    const chart = node('div', 'at-chart');
    chart.append(lineChart(months, seriesFor(months, topRows, source, key), title));
    section.append(legend, chart);
  }
  function render(data, options, range) {
    const scope = data.scope === 'year' || data.scope === 'month' ? data.scope : options.scope;
    const period = data.period == null ? options.period : String(data.period);
    const label = scopeLabel(scope, period);
    const summary = data.summary || {};
    const monthly = monthRows(data.monthly, scope, period);
    const shown = chartRows(monthly, scope === 'all' ? range : 'all');
    const months = shown.map(row => row.ym);
    const topTracks = safeTop(data.topTracks || data.tracks, 'song_title');
    const topPlatforms = safeTop(data.topPlatforms, 'platform');
    const yearly = (Array.isArray(data.yearly) ? data.yearly : []).filter(row => /^\d{4}$/.test(String(row.year))
      && (scope === 'all' || String(row.year) === String(period).slice(0, 4)))
      .map(row => ({ year: String(row.year), revenue: finite(row.revenue) })).sort((a, b) => a.year.localeCompare(b.year));
    const content = node('div', 'at-content');
    const intro = node('div', 'at-scope-note');
    const introText = node('div');
    introText.append(node('strong', '', `${label} · 전체 음원 합산`),
      node('p', '', '등록된 모든 음원의 수익을 합산합니다. TOP 5 비교는 아래에서 별도로 확인할 수 있습니다.'));
    intro.append(introText);
    if (validMonth(data.latestYm)) intro.append(node('span', 'at-chip', `최신 등록월 ${data.latestYm}`));
    content.append(intro);
    const latestMonth = validMonth(summary.latest_month) ? summary.latest_month : '';
    const previousMonth = validMonth(summary.previous_month) ? summary.previous_month : '';
    const covered = monthly.length ? `${monthly[0].ym} ~ ${monthly.at(-1).ym}` : '월별 자료 없음';
    const kpis = node('div', 'at-kpis');
    kpis.append(
      kpi(`${label} 합산 수익`, money(summary.revenue), `${count(summary.rows_count)}건의 정산 자료 · ${covered}`),
      kpi('선택기간 최신 등록월 수익', latestMonth ? money(summary.latest_revenue) : '—', latestMonth ? `${monthLabel(latestMonth)} · 현재 등록 자료 기준` : '선택기간에 등록된 월별 자료 없음'),
      kpi('최신 등록월 전월 대비', percentage(summary.mom_pct), latestMonth && previousMonth
        ? `${latestMonth} ↔ ${previousMonth} · 전월 ${summary.previous_revenue == null ? '자료 없음' : money(summary.previous_revenue)}` : '비교할 전월 자료 없음', signClass(summary.mom_pct)),
      kpi('선택기간 음원 · 플랫폼', `${count(summary.tracks_count)}곡`, `${count(summary.platforms_count)}개 플랫폼 · 실제 카운트 ${count(summary.actual_count)}`)
    );
    content.append(kpis);
    if (scope === 'all') {
      const tools = node('div', 'at-chart-tools');
      const explanation = node('div');
      explanation.append(node('strong', '', '차트 표시'), node('p', '', '월별 차트와 TOP 5 추이만 바뀝니다. 합계·순위·상세 내역은 전체기간 기준입니다.'));
      const buttons = node('div', 'at-range');
      buttons.setAttribute('role', 'group');
      buttons.setAttribute('aria-label', '월별 차트 표시 기간');
      [['12', '12개월'], ['24', '24개월'], ['all', '선택기간 전체']].forEach(([value, text]) => {
        const button = node('button', value === range ? 'active' : '', text);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(value === range));
        button.addEventListener('click', () => {
          if (!active || active.root !== options.root) return;
          active.range = value;
          active.root.replaceChildren(render(active.data, active.options, value));
        });
        buttons.append(button);
      });
      tools.append(explanation, buttons);
      content.append(tools);
    }
    const chartPeriod = shown.length ? `${shown[0].ym} ~ ${shown.at(-1).ym}` : label;
    const totalPanel = panel('ALL MUSIC REVENUE', '전체 음원 월별 수익 추이', '모든 음원·플랫폼의 월별 수익 합계입니다.', chartPeriod);
    const mainChart = node('div', 'at-chart at-chart-main');
    mainChart.append(lineChart(months, [{ name: '전체 음원 합산', values: shown.map(row => row.revenue) }], '전체 음원의 월별 합산 수익'));
    totalPanel.append(mainChart);
    content.append(totalPanel);

    const annualRow = node('div', 'at-grid');
    const annualPanel = panel('ANNUAL REVENUE', '연도별 합산 수익', scope === 'month' ? '선택월 수익을 해당 연도에 표시합니다.' : '상단에서 선택한 기간에 포함되는 수익만 합산합니다.', label);
    const annualChart = node('div', 'at-chart');
    annualChart.append(yearChart(yearly));
    annualPanel.append(annualChart);
    const rankingPanel = panel('TOP TRACKS', '수익 상위 음원 TOP 5', '곡명을 누르면 해당 음원의 상세 분석으로 이동합니다.', label);
    const ranks = node('ol', 'at-ranks');
    topTracks.forEach((row, index) => {
      const item = node('li', 'at-rank');
      item.append(node('span', 'at-rank-no', index + 1));
      const name = node('div', 'at-rank-main');
      name.append(openTrackButton(String(row.song_title), options, 'at-track-link'));
      const share = finite(row.share_pct, null);
      name.append(node('span', '', `${share === null ? '비중 —' : `합산 수익의 ${amountFormat.format(share)}%`}`));
      item.append(name, node('strong', 'at-rank-amount', money(row.revenue)));
      ranks.append(item);
    });
    rankingPanel.append(topTracks.length ? ranks : chartEmpty('이 기간에 등록된 음원이 없습니다.'));
    annualRow.append(annualPanel, rankingPanel);
    content.append(annualRow);

    const seriesRow = node('div', 'at-grid');
    const songsPanel = panel('TRACK COMPARISON', 'TOP 5 음원 월별 추이', `${label} 수익 상위 5곡만 비교합니다. 전체 합산 추이는 위 차트에서 확인하세요.`, chartPeriod);
    appendTrend(songsPanel, months, topTracks, data.trackMonthly, 'song_title', options, '수익 상위 5개 음원의 월별 수익 비교');
    const platformsPanel = panel('PLATFORM COMPARISON', 'TOP 5 플랫폼 월별 추이', `${label} 수익 상위 5개 플랫폼의 월별 수익입니다.`, chartPeriod);
    appendTrend(platformsPanel, months, topPlatforms, data.platformMonthly, 'platform', options, '수익 상위 5개 플랫폼의 월별 수익 비교');
    seriesRow.append(songsPanel, platformsPanel);
    content.append(seriesRow);

    const tablePanel = panel('MONTHLY DETAIL', '전체 음원 월별 상세 내역', '전월 대비는 해당 월 바로 전 달의 등록 자료와 비교합니다. 전월 자료가 없으면 —로 표시합니다.', label);
    tablePanel.classList.add('at-table-panel');
    const tableWrap = node('div', 'at-table-wrap');
    const table = node('table', 'at-table');
    const thead = node('thead'), heading = node('tr');
    ['수익월', '합산 수익', '전월 대비', '실제 카운트', '분석 카운트', '음원', '플랫폼', '정산행'].forEach((title, i) => {
      const th = node('th', i ? 'at-num' : '', title);
      th.scope = 'col';
      heading.append(th);
    });
    thead.append(heading);
    const tbody = node('tbody');
    monthly.slice().reverse().forEach(row => {
      const tr = node('tr', row.has_data === false ? 'at-no-data-row' : '');
      tr.append(node('td', '', row.ym), node('td', 'at-num', money(row.revenue)),
        node('td', `at-num ${signClass(row.mom_pct)}`, percentage(row.mom_pct)),
        node('td', 'at-num', count(row.actual_count)), node('td', 'at-num', count(row.analysis_count)),
        node('td', 'at-num', count(row.tracks_count)), node('td', 'at-num', count(row.platforms_count)),
        node('td', 'at-num', count(row.rows_count)));
      tbody.append(tr);
    });
    if (!monthly.length) {
      const row = node('tr'), cell = node('td', 'at-empty-cell', '선택기간에 월별 자료가 없습니다.');
      cell.colSpan = 8;
      row.append(cell); tbody.append(row);
    }
    table.append(thead, tbody); tableWrap.append(table); tablePanel.append(tableWrap);
    content.append(tablePanel);
    const note = node('div', 'at-footnote');
    note.append(node('p', '', '수익월 기준입니다. 월별 추이의 자료 없는 달은 0원으로 표시되며, 최신월은 현재 등록된 자료 기준입니다.'));
    if (finite(summary.undated_rows) !== 0 || finite(summary.undated_revenue) !== 0) {
      note.append(node('p', '', `수익월이 없는 자료 ${count(summary.undated_rows)}건 · ${money(summary.undated_revenue)}은 전체기간 합계에 포함되며 월별·연도별 차트에서는 제외됩니다.`));
    }
    content.append(note);
    return content;
  }
  function status(root, kind, text) {
    const card = node('div', `at-status at-status-${kind}`);
    card.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const icon = node('span', 'at-status-icon', kind === 'error' ? '!' : '');
    icon.setAttribute('aria-hidden', 'true');
    card.append(icon, node('strong', '', text));
    if (kind === 'error') card.append(node('p', '', '상단 새로고침을 눌러 다시 조회해 주세요.'));
    root.replaceChildren(card);
  }
  async function load(asyncFetch, options = {}) {
    const root = document.getElementById('allTrendsRoot');
    if (!root) return;
    const id = ++requestId;
    const normalized = { ...options, root,
      scope: options.scope === 'year' || options.scope === 'month' ? options.scope : 'all',
      period: String(options.period || '') };
    const range = active?.root === root ? active.range : 'all';
    active = null;
    pendingRoot = root;
    root.setAttribute('aria-busy', 'true');
    status(root, 'loading', '전체 음원 트렌드를 불러오는 중…');
    try {
      if (typeof asyncFetch !== 'function') throw new Error('Reader unavailable');
      const query = `scope=${encodeURIComponent(normalized.scope)}${normalized.scope === 'all' ? '' : `&period=${encodeURIComponent(normalized.period)}`}`;
      const data = await asyncFetch(`/analytics?view=all-trends&${query}`);
      if (id !== requestId || document.getElementById('allTrendsRoot') !== root || !root.isConnected) return;
      if (!data || typeof data !== 'object' || data.error) throw new Error('Invalid trend response');
      pendingRoot = null;
      active = { root, data, options: normalized, range };
      root.replaceChildren(render(data, normalized, range));
      root.setAttribute('aria-busy', 'false');
    } catch (error) {
      if (id !== requestId || document.getElementById('allTrendsRoot') !== root || !root.isConnected) return;
      active = null;
      pendingRoot = null;
      root.setAttribute('aria-busy', 'false');
      status(root, 'error', '전체 음원 트렌드를 불러오지 못했습니다.');
    }
  }
  function cancel() {
    ++requestId;
    if (pendingRoot) pendingRoot.setAttribute('aria-busy', 'false');
    if (active?.root) active.root.setAttribute('aria-busy', 'false');
    pendingRoot = null;
    active = null;
  }
  window.SettlementAllTrends = { load, cancel, lineChart, yearChart, chartGeometry, monthRows, percentage };
})();
