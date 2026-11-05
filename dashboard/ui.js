// 시안 3개가 같이 쓰는 7개 기능 화면. 데이터는 robot.js(Sortbot), 색은 각 시안의 CSS 변수(--panel, --line, --ink, --mute, --accent, --ok, --warn, --danger)를 따른다.
// UI.mount({ camera: '#id', ai, robot, stats, records, alerts, control }) — 필요한 것만 넘기면 된다.
const UI = (() => {
  const S = Sortbot, L = S.LABELS;
  const $ = (root, s) => root.querySelector(s);
  const card = 'rounded-[var(--r,16px)] border border-[var(--line)] bg-[var(--panel)]';
  const mix = (v, p) => `color-mix(in srgb, var(${v}) ${p}%, transparent)`;
  const lvl = {
    danger: ['var(--danger)', 'solar:danger-triangle-bold', '위험'],
    warn: ['var(--warn)', 'solar:bell-bing-bold', '주의'],
    info: ['var(--mute)', 'solar:info-circle-linear', '정보'],
  };
  const resultCol = { done: 'var(--ok)', failed: 'var(--danger)', cancelled: 'var(--mute)' };

  function toast(msg, ok) {
    let t = document.getElementById('ui-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ui-toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.className = 'fixed z-50 left-1/2 -translate-x-1/2 bottom-24 lg:bottom-6 max-w-[92vw] px-4 py-3 rounded-xl text-sm shadow-lg border '
      + (ok ? 'bg-[var(--panel)] border-[var(--line)] text-[var(--ink)]' : 'bg-[var(--danger)] border-transparent text-white');
    t.textContent = msg;
    clearTimeout(t._h); t._h = setTimeout(() => t.remove(), 4000);
  }

  // 누르고 있어야 실행 (홀드 투 런): 실수로 한 번 눌러 로봇이 출발하는 것을 막는다
  function hold(el, ms, fire) {
    let t0 = 0, raf = 0;
    const stop = () => { cancelAnimationFrame(raf); t0 = 0; el.style.setProperty('--p', 0); };
    const step = now => {
      const p = Math.min((now - t0) / ms, 1);
      el.style.setProperty('--p', p);
      if (p >= 1) { stop(); fire(); } else raf = requestAnimationFrame(step);
    };
    const start = e => { if (el.disabled || t0) return; if (e.type === 'keydown' && !['Enter', ' '].includes(e.key)) return; e.preventDefault(); t0 = performance.now(); raf = requestAnimationFrame(step); };
    el.addEventListener('pointerdown', start); el.addEventListener('keydown', start);
    ['pointerup', 'pointerleave', 'keyup', 'blur'].forEach(ev => el.addEventListener(ev, stop));
  }

  // ── 1. 로봇 카메라 (앞을 보며 통의 마커를 찾는 카메라) ──
  function camera(el) {
    const live = S.state.source === 'live';
    el.innerHTML = `
      <div class="relative overflow-hidden rounded-[var(--r,16px)] bg-[#57524f] aspect-[4/3]">
        <svg class="sc absolute inset-0 w-full h-full" viewBox="0 0 100 75" preserveAspectRatio="none"></svg>
        ${live ? `<img src="${S.state.base}/api/stream" alt="로봇 카메라 영상" class="absolute inset-0 w-full h-full object-fill" onerror="this.remove()">` : ''}
        <svg class="bx absolute inset-0 w-full h-full" viewBox="0 0 100 75" preserveAspectRatio="none" aria-hidden="true"></svg>
        <div class="ns hidden absolute inset-0 grid place-items-center bg-black/70 text-sm text-white text-center p-4">
          <span><iconify-icon icon="solar:videocamera-slash-linear" class="text-3xl"></iconify-icon><br><span class="nst"></span></span></div>
        <div class="absolute top-0 inset-x-0 p-2.5 flex flex-wrap gap-1.5 text-[11px]">
          <span class="cs rounded-full px-2.5 py-1 bg-black/55 text-white flex items-center gap-1.5"></span>
          <span class="rounded-full px-2.5 py-1 bg-black/55 text-white/80">로봇 앞 카메라</span>
        </div>
        <div class="absolute bottom-0 inset-x-0 px-3 py-2 flex flex-wrap justify-between gap-2 text-[11px] text-white/90 bg-gradient-to-t from-black/70 to-transparent">
          <span>갱신 <b class="shot tabular-nums">—</b></span><span class="mk text-white/75"></span>
        </div>
      </div>`;
    return s => {
      const cam = s.robot?.camera, ok = s.connected && cam !== 'none';
      if (!live) $(el, '.sc').innerHTML = S.scene(ok ? s.seen : [], { box: false });
      else if (!$(el, '.sc').innerHTML) $(el, '.sc').innerHTML = S.scene([], { box: false });
      $(el, '.bx').innerHTML = S.scene(ok ? s.seen : [], { bg: false, obj: false });
      $(el, '.ns').classList.toggle('hidden', ok);
      $(el, '.nst').textContent = !s.connected ? '로봇 서버 연결 끊김' : '로봇 카메라 없음 — 케이블과 CAMERA 설정 확인';
      $(el, '.cs').innerHTML = !s.connected
        ? '<i class="w-1.5 h-1.5 rounded-full bg-[var(--warn)]"></i>연결 끊김'
        : cam === 'none' ? '<i class="w-1.5 h-1.5 rounded-full bg-[var(--danger)]"></i>카메라 없음'
        : `<i class="w-1.5 h-1.5 rounded-full bg-[var(--ok)]"></i>카메라 연결됨 · ${cam === 'sim' ? '가짜 세계' : cam}`;
      $(el, '.shot').textContent = S.fmtTime(s.frameAt, true);
      $(el, '.mk').textContent = s.seen.length ? `보이는 마커 ${s.seen.map(m => m.id).join(', ')}번` : s.mission?.running ? '마커 찾는 중' : '박스: 로봇이 찾은 통 마커';
    };
  }

  // ── 2. ESP32 판정 화면: 트레이를 내려다보는 분류 보드(엣지 AI)가 무엇을 보고 어떻게 확정하는지 ──
  // 데이터는 GET /api/sort — 프레임 줄 {event:'frame', probs, box, streak, state, ms} 와 확정 판정 {class, conf, ms, result}
  function ai(el) {
    const STEPS = [['ready', '빈 트레이 대기'], ['detecting', '인식 중'], ['decided', '확정'], ['wait_empty', '비우기 기다림']];
    const ROWS = [...S.CLASSES, 'empty'];
    const name = c => c == null ? '판정 없음' : c === 'empty' ? '빈 트레이' : L[c] || c;
    el.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-[var(--mute)]"><b class="text-[var(--ink)]">ESP32S3</b> · 쓰레기 판정 (보드 안 AI)</p>
        <span class="bs rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[11px] flex items-center gap-1.5"></span>
      </div>
      <div class="mt-3 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <div class="relative">
          <svg class="tray w-full rounded-[calc(var(--r,16px)-6px)]" viewBox="0 0 100 100" role="img" aria-label="위에서 본 트레이와 감지한 물체"></svg>
          <p class="nf hidden absolute inset-x-2 bottom-2 rounded-lg bg-black/65 text-white text-[11px] p-2">프레임 정보가 아직 안 와요. 보드가 확정 판정만 보내는 중이라 마지막 확정만 표시합니다.</p>
        </div>
        <div>
          <p class="text-[11px] text-[var(--mute)]">종류별 확률 <span class="opacity-70">(세로선 = 확정 기준)</span></p>
          <ul class="pb mt-2 space-y-2.5"></ul>
          <p class="text-[11px] text-[var(--mute)] mt-4">확정 조건</p>
          <ul class="ck mt-1.5 space-y-1 text-xs"></ul>
        </div>
      </div>
      <ol class="sp mt-4 grid grid-cols-4 gap-1 text-center text-[11px]"></ol>
      <div class="mt-4 rounded-xl border border-[var(--line)] p-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
        <span class="text-[11px] text-[var(--mute)] row-span-2">마지막<br>확정</span>
        <p class="dc font-bold" aria-live="polite">—</p>
        <p class="dr text-xs text-[var(--mute)]">—</p>
      </div>
      <p class="mt-2 text-[11px] text-[var(--mute)] flex flex-wrap gap-x-3"><span>판단 시간 <b class="ms text-[var(--ink)] tabular-nums">—</b></span><span>자동 출발 <b class="au">—</b></span><span class="bd"></span></p>`;
    return s => {
      const f = s.connected ? s.frame : null, d = s.decision, m = s.mission, b = s.sort?.board, min = s.sort?.min_confidence ?? 0.8;
      $(el, '.tray').innerHTML = S.trayScene(f, d);
      $(el, '.nf').classList.toggle('hidden', !!f?.probs || !s.connected);
      $(el, '.nf').textContent = f?.n != null
        ? `트레이 위 물체 ${f.n}개 감지 중. 확률·위치는 보드가 프레임 정보를 보내면 그림으로 표시합니다.`
        : '프레임 정보가 아직 안 와요. 보드가 확정 판정만 보내는 중이라 마지막 확정만 표시합니다.';
      $(el, '.bs').innerHTML = !s.connected ? '<i class="w-1.5 h-1.5 rounded-full bg-[var(--warn)]"></i>로봇 연결 끊김'
        : b?.error ? '<i class="w-1.5 h-1.5 rounded-full bg-[var(--danger)]"></i>보드 연결 문제'
        : `<i class="w-1.5 h-1.5 rounded-full bg-[var(--ok)]"></i>USB ${b?.port || '찾는 중'}`;

      const probs = f?.probs || {};
      const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]), [t1, t2] = sorted;
      $(el, '.pb').innerHTML = ROWS.map(c => {
        const v = probs[c], top = t1 && t1[0] === c;
        return `<li><div class="flex justify-between text-xs"><span class="${top ? 'font-bold' : 'text-[var(--mute)]'}">${name(c)}</span><b class="tabular-nums">${S.pct(v)}</b></div>
          <div class="relative mt-1 h-2 rounded-full bg-[var(--line)] overflow-hidden"><i class="block h-full origin-left transition-transform duration-300" style="transform:scaleX(${v ?? 0});background:${top ? 'var(--accent)' : 'var(--mute)'}"></i>
          <i class="absolute inset-y-0 w-px bg-[var(--ink)]" style="left:${min * 100}%"></i></div></li>`;
      }).join('');

      const streak = f?.streak ?? 0;
      const checks = !t1 ? [] : [
        [`1등 ${S.pct(min)} 이상`, t1[0] !== 'empty' && t1[1] >= min],
        ['1·2등 차이 20% 이상', t1[1] - (t2?.[1] ?? 0) >= 0.2],
        [`같은 결과 3번 연속 (${Math.min(streak, 3)}/3)`, streak >= 3],
      ];
      $(el, '.ck').innerHTML = checks.map(([t, ok]) => `<li class="flex items-center gap-1.5"><iconify-icon icon="${ok ? 'solar:check-circle-bold' : 'solar:close-circle-linear'}" style="color:${ok ? 'var(--ok)' : 'var(--mute)'}"></iconify-icon>${t}</li>`).join('')
        || '<li class="text-[var(--mute)]">프레임 정보가 오면 표시합니다</li>';

      // 보드 상태: 확정 직후 2초는 '확정'으로 보여 준다 (보드는 바로 wait_empty 로 넘어가므로)
      const justDecided = d && Date.now() - new Date(d.time) < 2000;
      const cur = justDecided ? 'decided' : f?.state;
      $(el, '.sp').innerHTML = STEPS.map(([k, label]) => `<li class="rounded-lg px-1 py-1.5 ${k === cur ? 'font-bold text-white' : 'text-[var(--mute)]'}" style="background:${k === cur ? 'var(--accent)' : 'var(--line)'}" ${k === cur ? 'aria-current="step"' : ''}>${label}</li>`).join('');

      const going = m?.running && m.station in L;
      $(el, '.dc').textContent = d ? `${name(d.class)} ${S.pct(d.conf)} · ${S.fmtTime(new Date(d.time))}` : '아직 없음';
      $(el, '.dr').textContent = !d ? '트레이에 물건을 올리면 판정합니다'
        : d.result === '출발' ? `→ ${name(d.class)} 통(마커 ${S.MARKERS[d.class]})으로 출발${going && m.by === 'ai' ? ' · 가는 중' : ''}`
        : `→ 출발 안 함: ${d.result}`;
      $(el, '.dr').style.color = d?.result === '출발' ? 'var(--accent)' : d ? 'var(--warn)' : '';
      $(el, '.ms').textContent = (f || d)?.ms != null ? (f || d).ms + ' ms' : '—';
      $(el, '.au').textContent = !s.sort ? '—' : s.sort.auto ? '켜짐' : '꺼짐';
      $(el, '.au').style.color = s.sort && !s.sort.auto ? 'var(--warn)' : '';
      $(el, '.bd').textContent = b?.error ? `보드 오류: ${b.error}` : b?.last_line_at ? `마지막 수신 ${S.fmtTime(new Date(b.last_line_at))}` : '';
    };
  }

  // ── 3. 로봇 상태 + 임무 단계 ──
  function robot(el) {
    el.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs text-[var(--mute)]">임무 단계</p>
        <span class="md rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[11px]"></span>
      </div>
      <ol class="steps mt-3 grid grid-cols-3 sm:grid-cols-6 gap-y-4"></ol>
      <div class="bn hidden mt-4 rounded-xl px-4 py-3 text-sm font-bold flex items-center gap-2"><iconify-icon class="bi text-xl"></iconify-icon><span class="bt"></span></div>
      <dl class="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-3 text-sm">
        <div><dt class="text-xs text-[var(--mute)]">지금 목표</dt><dd class="tg font-bold">—</dd></div>
        <div><dt class="text-xs text-[var(--mute)]">움직임</dt><dd class="mv font-bold">—</dd></div>
        <div><dt class="text-xs text-[var(--mute)]">앞 장애물</dt><dd class="ob font-bold">—</dd></div>
        <div><dt class="text-xs text-[var(--mute)]">걸음 수</dt><dd class="sp font-bold tabular-nums">—</dd></div>
        <div class="col-span-2 sm:col-span-4"><dt class="text-xs text-[var(--mute)]">로봇 메시지</dt><dd class="ms text-[var(--ink)]">—</dd></div>
      </dl>`;
    return s => {
      const r = s.robot, m = s.mission, stage = s.stage;
      const cur = S.STAGES.findIndex(([k]) => k === stage);
      const bad = stage === 'failed' || stage === 'cancelled';
      $(el, '.steps').innerHTML = S.STAGES.map(([, label], i) => {
        const st = cur < 0 ? 'off' : i < cur ? 'done' : i === cur ? (stage === 'done' ? 'done' : 'now') : 'off';
        const style = { done: `background:${mix('--accent', 40)}`, now: `background:var(--accent);color:#fff;box-shadow:0 0 0 4px ${mix('--accent', 25)}`, off: 'background:var(--line);color:var(--mute)' }[st];
        return `<li class="flex flex-col items-center text-center gap-1.5" ${st === 'now' ? 'aria-current="step"' : ''}>
          <span class="w-8 h-8 rounded-full grid place-items-center text-xs font-bold transition-colors" style="${style}">${i + 1}</span>
          <span class="text-[11px] ${st === 'now' ? 'font-bold' : 'text-[var(--mute)]'}">${label}</span></li>`;
      }).join('');
      const bn = $(el, '.bn');
      bn.classList.toggle('hidden', !bad && !r?.blocked);
      const danger = stage === 'failed' || r?.blocked;
      bn.style.background = danger ? 'var(--danger)' : 'var(--line)'; bn.style.color = danger ? '#fff' : '';
      $(el, '.bi').setAttribute('icon', danger ? 'solar:danger-triangle-bold' : 'solar:stop-circle-linear');
      $(el, '.bt').textContent = r?.blocked && !bad ? `앞 장애물 때문에 멈춤 (${r.obstacle_cm}cm 이내)` : `${S.RESULT[stage] || ''} — ${m?.message || ''}`;
      $(el, '.md').textContent = !s.connected ? '연결 끊김' : r?.mode === 'real' ? '실제 로봇' : '가짜 모드';
      const home = m?.target === 'home';
      $(el, '.tg').textContent = m?.running ? (home ? '출발점' : L[m.target] || '—') : '—';
      $(el, '.mv').textContent = r?.moving ? `이동 중 · 속도 ${r.speed}` : '멈춤';
      $(el, '.ob').textContent = r?.blocked ? '막힘' : '없음';
      $(el, '.ob').style.color = r?.blocked ? 'var(--danger)' : '';
      $(el, '.sp').textContent = m?.steps ?? '—';
      $(el, '.ms').textContent = m?.message || (m?.running ? '…' : '대기 중');
    };
  }

  // ── 4. 통계 ──
  function stats(el) {
    el.innerHTML = `
      <div class="kp grid grid-cols-2 lg:grid-cols-4 gap-3"></div>
      <div class="mt-4 grid lg:grid-cols-[1fr_1.4fr] gap-3">
        <div class="${card} p-4"><p class="text-xs text-[var(--mute)]">통별 (오늘 완료)</p><ul class="bc mt-3 space-y-3"></ul></div>
        <div class="${card} p-4"><p class="text-xs text-[var(--mute)]">시간대별 처리량</p>
          <div class="hr mt-3 h-36 flex items-end gap-1.5"></div><div class="hl mt-1 flex gap-1.5 text-[10px] text-[var(--mute)]"></div></div>
      </div>
      `;
    return s => {
      const st = s.stats, tries = st.done + st.failed;
      const kpi = [
        ['오늘 처리량', s.today, '개'],
        ['임무 성공률', tries ? Math.round(st.done / tries * 100) : '—', tries ? '%' : ''],
        ['평균 임무 시간', st.done ? (st.timeSum / st.done / 1000).toFixed(0) : '—', st.done ? '초' : ''],
        ['평균 확신도', st.confN ? Math.round(st.confSum / st.confN * 100) : '—', st.confN ? '%' : ''],
      ];
      $(el, '.kp').innerHTML = kpi.map(([k, v, u]) => `<div class="${card} p-4"><p class="text-xs text-[var(--mute)]">${k}</p>
        <p class="font-wide font-bold text-3xl mt-2 tabular-nums">${v}<span class="text-sm font-sans font-normal text-[var(--mute)]"> ${u}</span></p></div>`).join('');
      const max = Math.max(1, ...Object.values(st.byClass));
      $(el, '.bc').innerHTML = S.CLASSES.map(c => `<li><div class="flex justify-between text-sm"><span>${L[c]}</span><b class="tabular-nums">${st.byClass[c]}</b></div>
        <div class="mt-1 h-2 rounded-full bg-[var(--line)] overflow-hidden"><i class="block h-full bg-[var(--accent)] origin-left transition-transform duration-500" style="transform:scaleX(${st.byClass[c] / max})"></i></div></li>`).join('');
      const hmax = Math.max(1, ...st.hourly), h0 = new Date().getHours() - st.hourly.length + 1;
      $(el, '.hr').innerHTML = st.hourly.map((v, i) => `<div class="flex-1 rounded-t ${i === st.hourly.length - 1 ? 'bg-[var(--accent)]' : 'bg-[var(--line)]'}" style="height:${Math.max(4, v / hmax * 100)}%" title="${(h0 + i + 24) % 24}시 ${v}개"></div>`).join('');
      $(el, '.hl').innerHTML = st.hourly.map((_, i) => `<span class="flex-1 text-center">${i % 3 === 2 || i === st.hourly.length - 1 ? (h0 + i + 24) % 24 : ''}</span>`).join('');
    };
  }

  // ── 5. 분류 기록 + 도착 사진 ──
  function records(el) {
    let filter = 'all', sig = '';
    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        <div class="fl flex flex-wrap gap-1.5" role="group" aria-label="기록 필터"></div>
        <button class="dl ml-auto rounded-full border border-[var(--line)] px-3.5 py-2 text-xs flex items-center gap-1.5 hover:border-[var(--accent)]"><iconify-icon icon="solar:download-minimalistic-linear"></iconify-icon>CSV 내보내기</button>
      </div>
      <ul class="ls mt-3 divide-y divide-[var(--line)]"></ul>
      <p class="mt-3 text-[11px] text-[var(--mute)]">사진: 로봇이 통 앞에 도착했을 때 로봇 카메라로 찍은 한 장입니다 (어느 통에 갔는지 확인용). 지금은 이 브라우저에만 있고 새로고침하면 사라집니다. 로봇 서버에 기록 API 가 생기면 그쪽에 저장합니다.</p>`;
    const opts = [['all', '전체'], ...S.CLASSES.map(c => [c, L[c]]), ['failed', '실패·취소'], ['web', '웹에서 보냄']];
    const drawFilter = () => $(el, '.fl').innerHTML = opts.map(([k, t]) =>
      `<button data-f="${k}" aria-pressed="${k === filter}" class="rounded-full px-3 py-1.5 text-xs border ${k === filter ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-[var(--line)]'}">${t}</button>`).join('');
    drawFilter();
    $(el, '.fl').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; sig = ''; drawFilter(); draw(S.state); };
    $(el, '.dl').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([S.csv()], { type: 'text/csv' }));
      a.download = `분류기록_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(a.href);
    };
    const thumb = r => r.img && r.img !== 'demo'
      ? `<a href="${r.img}" download="도착사진_${r.id}.jpg" title="사진 저장"><img src="${r.img}" alt="${L[r.cls] || "출발점"} 도착 사진" class="w-16 aspect-[4/3] object-cover rounded-md"></a>`
      : r.img === 'demo'
        ? `<svg viewBox="0 0 100 75" class="w-16 rounded-md shrink-0" role="img" aria-label="${L[r.cls] || "출발점"} 도착 사진">${S.scene([{ id: S.MARKERS[r.cls], cx: 0, size: 0.32 }])}</svg>`
        : '<span class="w-16 aspect-[4/3] rounded-md bg-[var(--line)] grid place-items-center text-[10px] text-[var(--mute)]">사진 없음</span>';
    const draw = s => {
      const rows = s.log.filter(r => filter === 'all' || r.cls === filter || (filter === 'failed' && r.result !== 'done') || (filter === 'web' && r.by === 'web')).slice(0, 12);
      const k = filter + (rows[0]?.id ?? '') + rows.length + rows.filter(r => r.img).length;
      if (k === sig) return; sig = k;
      $(el, '.ls').innerHTML = rows.map(r => `<li class="py-2.5 flex items-center gap-3">
        ${thumb(r)}
        <div class="flex-1 min-w-0"><p class="text-sm font-bold">${L[r.cls] || "출발점"} <span class="font-normal" style="color:${resultCol[r.result]}">· ${S.RESULT[r.result]}</span> <span class="font-normal text-[var(--mute)]">· ${r.by === 'web' ? '웹에서 보냄' : 'AI 판정'}</span></p>
          <p class="text-xs text-[var(--mute)] tabular-nums">${S.fmtTime(r.t)} · ${S.secs(r.ms)} · ${r.steps}걸음 · 확신도 ${S.pct(r.conf)}</p>
          ${r.result !== 'done' && r.message ? `<p class="text-xs mt-0.5" style="color:${resultCol[r.result]}">${r.message}</p>` : ''}</div>
        <span class="text-[11px] text-[var(--mute)]">#${r.id}</span></li>`).join('')
        || '<li class="py-8 text-sm text-[var(--mute)] text-center">아직 기록이 없습니다. 로봇이 임무를 마치면 여기에 쌓입니다.</li>';
    };
    return draw;
  }

  // ── 6. 오류·알림 센터 ──
  function alerts(el) {
    let only = false, sig = '';
    el.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" class="on accent-[var(--accent)] w-4 h-4"> 확인 안 한 것만</label>
        <button class="all ml-auto rounded-full border border-[var(--line)] px-3.5 py-2 text-xs hover:border-[var(--accent)]">모두 확인</button>
      </div>
      <ul class="ls mt-3 space-y-2"></ul>`;
    $(el, '.on').onchange = e => { only = e.target.checked; sig = ''; draw(S.state); };
    $(el, '.all').onclick = () => S.ackAll();
    $(el, '.ls').onclick = e => { const b = e.target.closest('[data-ack]'); if (b) S.ack(+b.dataset.ack); };
    const draw = s => {
      const list = s.alerts.filter(a => !only || !a.ack);
      const k = only + list.map(a => a.id + (a.ack ? 'a' : '')).join();
      if (k === sig) return; sig = k;
      $(el, '.ls').innerHTML = list.map(a => {
        const [col, icon, name] = lvl[a.level];
        return `<li class="${card} p-3.5 flex gap-3 ${a.ack ? 'opacity-55' : ''}" style="${a.ack ? '' : `border-color:${col}`}">
          <iconify-icon icon="${icon}" class="text-xl shrink-0" style="color:${col}"></iconify-icon>
          <div class="flex-1 min-w-0"><p class="text-sm font-bold">${a.title} <span class="ml-1 text-[11px] font-normal" style="color:${col}">${name}</span></p>
            <p class="text-xs text-[var(--mute)] mt-0.5">${a.msg}</p><p class="text-[11px] text-[var(--mute)] mt-1 tabular-nums">${S.fmtTime(a.t)}</p></div>
          ${a.ack ? '' : `<button data-ack="${a.id}" class="self-start rounded-full border border-[var(--line)] px-3 py-1.5 text-xs whitespace-nowrap">확인</button>`}</li>`;
      }).join('') || '<li class="py-8 text-sm text-[var(--mute)] text-center">알림이 없습니다.</li>';
    };
    return draw;
  }

  // ── 7. 수동 제어 + 관리자 ──
  function control(el) {
    const live = S.state.source === 'live';
    const btn = 'relative overflow-hidden rounded-xl border border-[var(--line)] py-4 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed';
    const fill = '<i class="absolute inset-0 bg-[var(--accent)] origin-left pointer-events-none" style="transform:scaleX(var(--p,0))"></i>';
    el.innerHTML = `
      <div class="grid lg:grid-cols-2 gap-3">
        <section class="${card} p-4">
          <p class="text-xs text-[var(--mute)]">정지</p>
          <div class="mt-3 flex items-center gap-4">
            <button data-estop class="w-24 h-24 shrink-0 rounded-full bg-[var(--danger)] text-white font-bold text-base border-4 border-[#f3d34a] active:scale-95 transition-transform">정지</button>
            <div class="text-xs text-[var(--mute)] space-y-1.5">
              <p><b class="text-[var(--ink)]">웹 정지</b>: 바퀴를 세우고 진행 중인 임무를 취소합니다 (POST /api/stop).</p>
              <p><b class="text-[var(--ink)]">연결이 끊기면</b>: 웹에서 보낸 이동 명령은 최대 3초 뒤 로봇이 스스로 멈춥니다. 단, 로봇이 스스로 하는 임무는 계속되므로 <b class="text-[var(--ink)]">로봇 본체 전원 스위치</b>로 끕니다.</p>
            </div>
          </div>
          <button class="cn mt-3 w-full rounded-xl border border-[var(--line)] py-3 text-sm disabled:opacity-40">임무만 취소 (바퀴는 원래 멈춰 있을 때)</button>
        </section>
        <section class="${card} p-4">
          <p class="text-xs text-[var(--mute)]">로봇이 지키는 안전장치 (로봇 서버)</p>
          <ul class="mt-2 space-y-1.5 text-xs">
            <li>· 이동 명령은 최대 3초 뒤 자동 정지</li>
            <li>· 속도 상한 <b class="mx">—</b></li>
            <li>· 앞 <b class="oc">—</b> 안에 물체가 있으면 정지, 앞쪽 이동 거절</li>
            <li>· 수동 조종·정지를 누르면 임무 바로 취소</li>
          </ul>
          <p class="text-xs text-[var(--mute)] mt-4">인터록 (모두 만족해야 웹에서 보낼 수 있음)</p>
          <ul class="il mt-2 grid grid-cols-2 gap-1.5 text-xs"></ul>
        </section>
      </div>
      <section class="${card} p-4 mt-3">
        <div class="flex items-center justify-between gap-2"><p class="text-xs text-[var(--mute)]">수동으로 보내기 (AI 판정이 안 될 때)</p><span class="text-[11px] text-[var(--mute)]">1초 동안 누르고 있으면 실행</span></div>
        <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          ${S.CLASSES.map(c => `<button data-send="${c}" class="${btn}">${fill}<span class="relative">${L[c]} 통으로</span></button>`).join('')}
          <button data-send="home" class="${btn}">${fill}<span class="relative">출발점으로</span></button>
        </div>
        <p class="msg mt-3 text-sm min-h-[1.25rem]" aria-live="polite"></p>
        <a class="dr inline-flex items-center gap-1.5 text-xs underline underline-offset-4 ${live ? '' : 'pointer-events-none opacity-40'}" ${live ? `href="${S.state.base}/" target="_blank" rel="noopener"` : ''}>
          <iconify-icon icon="solar:gamepad-linear"></iconify-icon>직접 조종 화면 열기 (로봇 서버의 휴대폰 조종 화면${live ? '' : ' — 로봇에 연결했을 때'})</a>
      </section>
      <section class="${card} p-4 mt-3">
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs text-[var(--mute)]">관리자</p>
          <label class="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" class="ad accent-[var(--accent)] w-4 h-4"> 관리자 모드</label>
        </div>
        <p class="text-[11px] text-[var(--mute)] mt-1">시안에서는 체크만 하면 되지만, 실제로는 로그인한 관리자만 쓸 수 있게 해야 합니다.</p>
        <div class="mt-3 grid sm:grid-cols-2 gap-3 text-xs">
          <label class="sm:col-span-2 flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 cursor-pointer"><input type="checkbox" class="at accent-[var(--accent)] w-4 h-4 disabled:opacity-40">
            <span><b class="text-sm">AI 자동 출발</b><br><span class="text-[var(--mute)]">켜면 분류 보드 판정(확신도 기준 이상)이 오자마자 로봇이 출발합니다. 로봇 서버 기본은 꺼짐 (POST /api/sort)</span></span></label>
          <label class="flex flex-col gap-1">통 가득 참 기준(개)<input name="capacity" type="number" min="1" max="50" class="cp rounded-lg border border-[var(--line)] bg-transparent px-2.5 py-2 text-sm disabled:opacity-40"><span class="text-[10px] text-[var(--mute)]">1~50, 팀 결정 전 가정 값</span></label>
          <form class="rf flex flex-col gap-1">로봇 서버 연결 <span class="text-[10px] text-[var(--mute)]">지금: ${live ? S.state.base : '가짜 로봇 (로봇 없이 연습)'}</span>
            <span class="flex gap-2"><input name="robot" inputmode="url" placeholder="로봇 IP 예) 192.168.0.23" value="${live ? S.state.base.replace(/^http:\/\//, '').replace(/:8000$/, '') : ''}" class="flex-1 min-w-0 rounded-lg border border-[var(--line)] bg-transparent px-2.5 py-2 text-sm">
              <button class="rounded-lg bg-[var(--accent)] text-white px-3.5 text-sm font-bold">연결</button></span>
            <span class="text-[10px] text-[var(--mute)]">비우고 연결 = 가짜 로봇 · 로봇과 같은 핫스팟, 로봇 서버 CORS_ORIGINS 에 ${location.origin} 등록 필요</span></form>
        </div>
        <p class="smsg mt-2 text-xs min-h-[1rem]" aria-live="polite"></p>
        <div class="bn mt-1 flex flex-wrap gap-2"></div>
      </section>
      ${live ? '' : `<section class="rounded-[var(--r,16px)] border border-dashed border-[var(--line)] p-4 mt-3">
        <p class="text-xs text-[var(--mute)]">시뮬레이션 (가짜 로봇일 때만 — 실제 화면에는 없음)</p>
        <div class="mt-3 flex flex-wrap gap-2 text-xs">
          <label class="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-2 cursor-pointer"><input type="checkbox" class="sd accent-[var(--accent)]"> 로봇 연결 끊기</label>
          <label class="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-2 cursor-pointer"><input type="checkbox" class="sa accent-[var(--accent)]" checked> 보드 판정 흉내 (몇 초마다)</label>
          <button data-fail="blocked" class="rounded-full border border-[var(--line)] px-3 py-2">다음 임무: 장애물로 멈춤</button>
          <button data-fail="marker" class="rounded-full border border-[var(--line)] px-3 py-2">다음 임무: 마커 못 찾음</button>
        </div>
      </section>`}`;

    const say = (r, sel = '.msg') => { const m = $(el, sel); m.textContent = r.reason; m.style.color = r.ok ? 'var(--ink)' : 'var(--danger)'; };
    el.querySelectorAll('[data-send]').forEach(b => hold(b, 1000, async () => say(await S.send(b.dataset.send))));
    $(el, '.cn').onclick = async () => say(await S.stop('cancel'));
    $(el, '.rf').onsubmit = e => {               // IP 만 넣어도 되게: 192.168.0.23 → http://192.168.0.23:8000
      e.preventDefault();
      let v = e.target.robot.value.trim().replace(/\/$/, '');
      if (v && !/^https?:\/\//.test(v)) v = 'http://' + v;
      if (v && !/:\d+$/.test(v)) v += ':8000';
      location.search = v ? '?robot=' + v : '';
    };
    $(el, '.ad').onchange = e => S.setAdmin(e.target.checked);
    $(el, '.at').onchange = async e => { const r = await S.setAuto(e.target.checked); say(r, '.smsg'); if (!r.ok) e.target.checked = !e.target.checked; };
    $(el, '.cp').value = S.settings.capacity;
    $(el, '.cp').onchange = e => { const r = S.setSetting('capacity', e.target.value); say(r, '.smsg'); if (!r.ok) e.target.value = S.settings.capacity; };
    $(el, '.bn').onclick = async e => { const b = e.target.closest('[data-empty]'); if (b) say(await S.empty(b.dataset.empty), '.smsg'); };
    if (!live) {
      $(el, '.sd').onchange = e => S.sim.down(e.target.checked);
      $(el, '.sa').onchange = e => S.sim.verdicts(e.target.checked);
      el.querySelectorAll('[data-fail]').forEach(b => b.onclick = () => { S.sim.failNext(b.dataset.fail); toast('다음 임무에서 일어납니다.', true); });
    }

    let binSig = '';
    return s => {
      $(el, '.mx').textContent = s.robot ? `${s.robot.max_speed} / 255` : '—';
      $(el, '.oc').textContent = s.robot ? `${s.robot.obstacle_cm}cm` : '—';
      $(el, '.cn').disabled = !s.mission?.running;
      $(el, '.il').innerHTML = S.interlocks().map(x => `<li class="flex items-center gap-1.5 rounded-lg px-2.5 py-2" style="background:${mix(x.ok ? '--ok' : '--danger', 12)}">
        <iconify-icon icon="${x.ok ? 'solar:check-circle-bold' : 'solar:close-circle-bold'}" style="color:${x.ok ? 'var(--ok)' : 'var(--danger)'}"></iconify-icon>${x.label}</li>`).join('');
      el.querySelectorAll('[data-send]').forEach(b => b.disabled = S.interlocks(b.dataset.send).some(x => !x.ok));
      $(el, '.cp').disabled = !s.admin;
      $(el, '.ad').checked = s.admin;
      $(el, '.at').disabled = !s.admin || !s.connected;
      if (s.sort) $(el, '.at').checked = s.sort.auto;
      const bs = S.CLASSES.map(c => c + s.bins[c]).join() + s.settings.capacity;
      if (bs !== binSig) {
        binSig = bs;
        $(el, '.bn').innerHTML = S.CLASSES.map(c => `<button data-empty="${c}" class="rounded-full border px-3 py-2 text-xs ${S.isFull(c) ? 'border-[var(--warn)] text-[var(--warn)]' : 'border-[var(--line)]'}">${L[c]} 통 비웠어요 (${s.bins[c]}/${s.settings.capacity})</button>`).join('');
      }
    };
  }

  const parts = { camera, ai, robot, stats, records, alerts, control };

  function mount(map) {
    const updaters = [];
    for (const [k, sel] of Object.entries(map)) document.querySelectorAll(sel).forEach(el => updaters.push(parts[k](el)));
    // 어느 화면에서든 쓰는 공통 표시: 연결 상태, 확인 안 한 알림 수, 정지 버튼
    document.querySelectorAll('[data-estop]').forEach(b => b.addEventListener('click', async () => { const r = await S.stop('stop'); toast(r.reason, r.ok); }));
    S.on(s => {
      updaters.forEach(u => u(s));
      const n = s.alerts.filter(a => !a.ack).length;
      document.querySelectorAll('[data-alert-count]').forEach(e => { e.textContent = n; e.hidden = !n; });
      document.querySelectorAll('[data-conn]').forEach(e => e.innerHTML = !s.connected
        ? '<i class="w-2 h-2 rounded-full bg-[var(--warn)]"></i><span style="color:var(--warn)">로봇 연결 끊김</span>'
        : `<i class="w-2 h-2 rounded-full bg-[var(--ok)]"></i><span>${s.robot?.mode === 'real' ? '실제 로봇' : '가짜 로봇'} · ${s.mission?.running ? '임무 중' : '대기'}</span>`);
    });
  }

  return { mount, toast };
})();
