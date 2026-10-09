(()=>{
  "use strict";
  const API="/api/settlement";
  const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
  const state={page:"dashboard",scope:"all",periodYear:"",periodMonth:"",meta:null,recordPage:1,recordPages:1,recordTotal:0,tracks:[],selectedTrack:null,trackDetail:null,trackRange:"24",importRows:[],importMappings:[],importFile:"",lastGroupPage:{analysis:"months",settlement:"records"}};
  const titles={dashboard:["OVERVIEW","대시보드"],months:["MONTHLY","월별 분석"],platforms:["PLATFORMS","플랫폼 분석"],tracks:["TRACKS","음원 분석"],distributors:["DISTRIBUTORS","유통사 분석"],records:["SETTLEMENTS","정산내역"],quality:["DATA QUALITY","데이터 품질"],import:["IMPORT","정산서 가져오기"]};
  const groupPages={dashboard:["dashboard"],analysis:["months","platforms","tracks","distributors"],settlement:["records","import"],data:["quality"]};
  const groupDefault={dashboard:"dashboard",analysis:"months",settlement:"records",data:"quality"};
  const pageGroup={dashboard:"dashboard",months:"analysis",platforms:"analysis",tracks:"analysis",distributors:"analysis",records:"settlement",import:"settlement",quality:"data"};
  const tabLabels={months:"월별",platforms:"플랫폼",tracks:"음원",distributors:"유통사",records:"정산내역",import:"정산서 가져오기"};
  const nf=new Intl.NumberFormat("ko-KR"); const mf=new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2});
  const money=v=>`₩${mf.format(Number(v)||0)}`; const num=v=>nf.format(Number(v)||0); const pct=v=>v===null||v===undefined||!Number.isFinite(Number(v))?"-":`${Number(v)>=0?"+":""}${Number(v).toFixed(1)}%`;
  const esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const ymShort=s=>/^\d{4}-\d{2}$/.test(String(s||""))?String(s).slice(2):String(s||"-");
  function toast(msg,type="ok"){const el=document.createElement("div");el.className=`toast ${type}`;el.textContent=msg;$("#toastHost").append(el);setTimeout(()=>el.classList.add("show"),10);setTimeout(()=>{el.classList.remove("show");setTimeout(()=>el.remove(),250)},3500)}
  function debounce(fn,ms=260){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
  const getCache=new Map(); const GET_CACHE_TTL=90*1000;
  let getCacheVersion=null;
  const cloneData=d=>typeof structuredClone==="function"?structuredClone(d):JSON.parse(JSON.stringify(d));
  function clearGetCache(){
    getCache.clear();getCacheVersion=null;
    if(window.SettlementRead)SettlementRead.clear();
  }
  async function api(path,opt={}){
    const method=String(opt.method||"GET").toUpperCase(),force=!!opt.force;
    const cacheable=method==="GET"&&(path.startsWith("/analytics?")||path==="/meta");
    let observedVersion=getCacheVersion;
    if(cacheable&&!force){const hit=getCache.get(path);if(hit&&hit.version===getCacheVersion&&Date.now()-hit.t<GET_CACHE_TTL)return cloneData(hit.d)}
    const fetchOpt={headers:{"content-type":"application/json",...(opt.headers||{})},...opt};
    delete fetchOpt.force;delete fetchOpt.readRetry;
    const r=await fetch(`${API}${path}`,fetchOpt);
    let d={},raw="";try{raw=await r.text();d=JSON.parse(raw)}catch{}
    if(r.status===401){showLogin();throw new Error("로그인이 만료되었습니다.")}
    if(!r.ok||d.ok===false){
      if(String(d.error||"").includes("no such table"))throw new Error("D1에 002_settlement_analytics.sql을 먼저 실행해주세요.");
      if(raw.includes("Worker exceeded resource limits"))throw new Error("서버 처리 한도를 초과했습니다. 새 배포가 완료됐는지 확인한 뒤 Ctrl+F5로 새로고침해주세요.");
      const messages={digital_manual_entry_required:"디지털 레코즈의 오우야 정산은 [디지털 레코즈 입력]에서 저장해주세요.",manual_month_already_imported:"이 정산월은 기존 정산내역에 이미 있습니다."};
      const error=new Error(messages[d.error]||d.error||`HTTP ${r.status}`);
      error.status=r.status;error.details=d;throw error;
    }
    if(method==="GET"&&d.processing==="browser_snapshot_v1"){
      if(!window.SettlementRead)throw new Error("분석 파일을 불러오지 못했습니다. Ctrl+F5로 새로고침해주세요.");
      observedVersion=d.snapshot?.snapshotVersion;
      if(observedVersion!==getCacheVersion){getCache.clear();getCacheVersion=observedVersion}
      try{d=await SettlementRead.query(API,path,d)}catch(error){
        if(error.message==="snapshot_changed_retry"&&!opt.readRetry){clearGetCache();return api(path,{...opt,force:true,readRetry:true})}
        if(error.message==="로그인이 만료되었습니다.")showLogin();
        throw error;
      }
    }
    if(method!=="GET")clearGetCache();
    if(cacheable&&observedVersion===getCacheVersion)getCache.set(path,{t:Date.now(),version:observedVersion,d:cloneData(d)});
    return d;
  }
  function showLogin(){
    clearGetCache();clearDigitalManualAccount();digitalRecordRows.clear();
    const form=$("#digitalManualForm");if(form){form.reset();form.dataset.editing=""}
    const dialog=$("#digitalManualDialog");if(dialog?.open)dialog.close();
    $("#appView").classList.add("hidden");$("#setupView").classList.add("hidden");$("#loginView").classList.remove("hidden");
  }
  function showSetup(){ $("#appView").classList.add("hidden");$("#loginView").classList.add("hidden");$("#setupView").classList.remove("hidden") }
  async function enterApp(target="dashboard"){
    $("#loginView").classList.add("hidden");$("#setupView").classList.add("hidden");$("#appView").classList.remove("hidden");
    if(window.SettlementRead)SettlementRead.setProgressHandler(value=>{
      const el=$("#readProgress");if(!el)return;
      el.classList.toggle("hidden",!value);
      el.textContent=value?`정산 자료 불러오는 중… ${num(value.received)} / ${num(value.total)}건`:"";
    });
    try{await loadMeta();nav(target)}catch(e){
      state.meta={distributors:[],platforms:[],bounds:{}};
      nav("import");
      const message=e.message==="r2_seed_required"?"저장된 정산 자료가 없습니다. 정산 엑셀을 선택해 반영해주세요.":e.message;
      toast(message,"error");
    }
  }
  async function checkStatus(){try{const d=await api("/auth/status");if(!d.configured){showSetup();return}if(!d.authenticated){showLogin();return}await enterApp(state.page)}catch(e){showSetup();toast(e.message,"error")}}
  async function login(e){e.preventDefault();const password=$("#passwordInput").value;$("#loginMessage").textContent="확인 중…";try{await api("/auth/login",{method:"POST",body:JSON.stringify({password})});$("#passwordInput").value="";$("#loginMessage").textContent="";await enterApp("dashboard")}catch(err){$("#loginMessage").textContent=err.message}}
  async function logout(){try{await api("/auth/logout",{method:"POST",body:"{}"})}catch{}showLogin()}

  async function loadMeta(){state.meta=await api("/meta");const fill=(sel,vals)=>{const el=$(sel),cur=el.value;el.innerHTML='<option value="">전체</option>'+vals.map(v=>`<option>${esc(v)}</option>`).join("");if(vals.includes(cur))el.value=cur};fill("#recordDistributor",state.meta.distributors||[]);fill("#recordPlatform",state.meta.platforms||[]);const b=state.meta.bounds||{},min=b.occurrence_min,max=b.occurrence_max;if(max){if(!state.periodYear)state.periodYear=String(max).slice(0,4);if(!state.periodMonth)state.periodMonth=String(max);const minY=Number(String(min||max).slice(0,4)),maxY=Number(String(max).slice(0,4)),years=[];for(let y=maxY;y>=minY;y--)years.push(String(y));$("#periodYear").innerHTML=years.map(y=>`<option value="${y}">${y}년</option>`).join("");$("#periodYear").value=state.periodYear;const months=[];let ym=String(max),guard=0;while(ym&&guard<240){months.push(ym);if(ym===min)break;ym=shiftYmClient(ym,-1);guard++}$("#periodMonth").innerHTML=months.map(m=>`<option value="${m}">${m}</option>`).join("");$("#periodMonth").value=state.periodMonth}applyPeriodUi()}
  function renderSectionTabs(page){const group=pageGroup[page]||"dashboard",pages=groupPages[group]||[],host=$("#sectionTabs");if(!host)return;if(pages.length<=1){host.innerHTML="";host.classList.add("hidden");return}host.classList.remove("hidden");host.innerHTML=pages.map(p=>`<button class="section-tab${p===page?" active":""}" data-page="${p}">${esc(tabLabels[p]||titles[p]?.[1]||p)}</button>`).join("")}
  function nav(page){if(page!=="tracks"&&state.selectedTrack){closeTrackDetail()}state.page=page;const group=pageGroup[page]||"dashboard";if(group==="analysis"||group==="settlement")state.lastGroupPage[group]=page;$$(`.nav-group[data-group]`).forEach(x=>x.classList.toggle("active",x.dataset.group===group));renderSectionTabs(page);$$(`.page`).forEach(x=>x.classList.toggle("active",x.id===`page-${page}`));const t=titles[page]||titles.dashboard;$("#pageEyebrow").textContent=t[0];$("#pageTitle").textContent=t[1];$("#periodTools").classList.toggle("hidden",["quality","import"].includes(page));loadPage(page)}
  async function loadPage(page){try{if(page==="dashboard")await loadDashboard();else if(page==="months")await loadMonths();else if(page==="platforms")await loadPlatforms();else if(page==="tracks")await loadTracks();else if(page==="distributors")await loadDistributors();else if(page==="records")await loadRecords();else if(page==="quality")await loadQuality()}catch(e){toast(e.message,"error")}}
  function periodQuery(){const p=new URLSearchParams({scope:state.scope});if(state.scope==="year"&&state.periodYear)p.set("period",state.periodYear);if(state.scope==="month"&&state.periodMonth)p.set("period",state.periodMonth);return p.toString()}
  function comparisonLabel(d){const c=d?.currentWindow||[],p=d?.previousWindow||[];if(!c.length)return "기간 없음";if(d.comparisonMode==="month")return `${c[0]} vs ${p[0]||"-"}`;return `${c[0]}~${c.at(-1)} vs ${p[0]||"-"}~${p.at(-1)||"-"}`}
  // KENNETH_TRACK_PERIOD_CLARITY_V1: scope totals and comparison metrics have separate labels.
  function syncTrackPeriodUi(){
    const period=state.scope==="year"?state.periodYear+"년":state.scope==="month"?state.periodMonth:"전체기간";
    const total=$("#trackSort option[value=total]"),recent=$("#trackSort option[value=recent]"),sort=$("#trackSort");
    if(total)total.textContent=period+" 수익순";
    if(recent){recent.textContent="비교기간 수익순";recent.hidden=state.scope==="month";recent.disabled=state.scope==="month"}
    if(sort&&state.scope==="month"&&sort.value==="recent")sort.value="total";
    if($("#trackRevenueHead"))$("#trackRevenueHead").textContent=period+" 수익";
    if($("#trackCurrentHead"))$("#trackCurrentHead").textContent=state.scope==="month"?"선택월 수익":"비교기간 수익";
    if($("#trackScopeNote"))$("#trackScopeNote").textContent="조회 기간: "+period+" · 정렬은 표시 순서만 바꿉니다. 증감액·성장률은 아래 추세 비교 기간 기준입니다.";
  }

  function applyPeriodUi(){
    $$(`#periodControl button`).forEach(x=>x.classList.toggle("active",x.dataset.scope===state.scope));
    $("#periodYear").classList.toggle("hidden",state.scope!=="year");$("#periodMonth").classList.toggle("hidden",state.scope!=="month");
    const note=state.scope==="all"?"전체 수익월 데이터를 분석합니다. 엑셀 자료는 정산월 3개월 전, 직접 입력은 지정한 수익월 기준입니다.":state.scope==="year"?`${state.periodYear}년 수익월 데이터를 분석합니다.`:`${state.periodMonth} 수익월 데이터를 분석합니다.`;
    if($("#basisNote"))$("#basisNote").textContent=note;
    if($("#platformCurrentHead"))$("#platformCurrentHead").textContent=state.scope==="month"?"선택월":"최근3M";
    if($("#trackCurrentHead"))$("#trackCurrentHead").textContent=state.scope==="month"?"선택월":"최근3M";
    syncTrackPeriodUi();
  }
  async function reloadForPeriod(){state.recordPage=1;applyPeriodUi();if(state.page==="tracks"&&state.selectedTrack)await loadTrackDetail(state.selectedTrack);else await loadPage(state.page)}
  function setScope(scope){state.scope=["year","month"].includes(scope)?scope:"all";if(state.scope==="year"&&!state.periodYear&&state.meta?.bounds?.occurrence_max)state.periodYear=state.meta.bounds.occurrence_max.slice(0,4);if(state.scope==="month"&&!state.periodMonth&&state.meta?.bounds?.occurrence_max)state.periodMonth=state.meta.bounds.occurrence_max;reloadForPeriod()}

  function countBadge(b){return b==="actual"?'<span class="badge actual">실제</span>':b==="zero_adjusted"?'<span class="badge zero">0보정</span>':b==="estimated"?'<span class="badge estimated">추정</span>':'<span class="badge missing">미제공</span>'}
  function deltaHtml(v){const n=Number(v||0),cl=n>0?"positive":n<0?"negative":"muted-value";return `<span class="${cl}">${n>0?"+":""}${money(n)}</span>`}
  function growthHtml(g,cur=0,prev=0){if(Number(prev||0)===0&&Number(cur||0)>0)return '<span class="tiny-badge new">신규</span>';const n=Number(g);if(!Number.isFinite(n))return "-";return `<span class="${n>=0?"positive":"negative"}">${pct(n)}</span>`}

  function renderLineChart(host,rows,completeYm){const el=typeof host==="string"?$(host):host;if(!rows?.length){el.className="svg-chart empty-state";el.textContent="데이터가 없습니다.";return}el.classList.remove("empty-state");const W=940,H=260,M={l:28,r:18,t:20,b:38},max=Math.max(...rows.map(x=>Number(x.revenue)||0),1),min=0;const x=i=>M.l+(W-M.l-M.r)*(rows.length===1?.5:i/(rows.length-1));const y=v=>M.t+(H-M.t-M.b)*(1-(Number(v)-min)/(max-min||1));const pts=rows.map((r,i)=>[x(i),y(r.revenue)]);const line=pts.map((p,i)=>`${i?"L":"M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");const area=`M${pts[0][0]},${H-M.b} `+pts.map(p=>`L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")+` L${pts.at(-1)[0]},${H-M.b} Z`;let grid="",labels="",dots="";for(let i=0;i<5;i++){const yy=M.t+(H-M.t-M.b)*i/4;const val=max*(1-i/4);grid+=`<line class="chart-grid-line" x1="${M.l}" y1="${yy}" x2="${W-M.r}" y2="${yy}"/><text class="chart-label" x="${M.l}" y="${yy-4}">${val>=10000?(val/10000).toFixed(1)+"만":Math.round(val).toLocaleString()}</text>`}const step=Math.max(1,Math.ceil(rows.length/7));rows.forEach((r,i)=>{if(i%step===0||i===rows.length-1)labels+=`<text class="chart-label" text-anchor="middle" x="${x(i)}" y="${H-12}">${ymShort(r.ym)}</text>`;const inc=completeYm&&r.ym>completeYm;dots+=`<circle class="${inc?"chart-incomplete":"chart-dot"}" cx="${x(i)}" cy="${y(r.revenue)}" r="${i===rows.length-1?5:3.5}"><title>${r.ym} · ${money(r.revenue)}${inc?" · 미완결":""}</title></circle>`});el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}<path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>${dots}${labels}</svg>`}
  function renderRank(host,rows,labelKey,valueKey,subFn){const el=$(host);if(!rows?.length){el.className="rank-list empty-state";el.textContent="데이터가 없습니다.";return}el.className="rank-list";el.innerHTML=rows.map((r,i)=>`<div class="rank-row"><div class="rank-main"><div class="rank-title"><span class="tiny-badge">${i+1}</span>${esc(r[labelKey])}</div><div class="rank-sub">${subFn?subFn(r):""}</div></div><div class="rank-value"><strong>${money(r[valueKey])}</strong></div></div>`).join("")}
  function renderMomentum(host,rows,labelKey){const el=$(host);if(!rows?.length){el.innerHTML='<div class="empty-state">데이터가 없습니다.</div>';return}el.innerHTML=rows.map((r,i)=>{const g=Number(r.previous_revenue||0)===0?'<span class="tiny-badge new">신규</span>':`<span class="tiny-badge ${Number(r.delta)>=0?"up":"down"}">${pct(r.growth_pct)}</span>`;const sub=state.scope==="month"?`전월 ${money(r.previous_revenue)} → 선택월 ${money(r.current_revenue)}`:`직전 3M ${money(r.previous_revenue)} → 최근 3M ${money(r.current_revenue)}`;return `<div class="rank-row"><div class="rank-main"><div class="rank-title"><span class="tiny-badge">${i+1}</span>${esc(r[labelKey])}</div><div class="rank-sub">${sub}</div></div><div class="rank-value"><strong class="${Number(r.delta)>=0?"delta-up":"delta-down"}">${Number(r.delta)>=0?"+":""}${money(r.delta)}</strong>${g}</div></div>`}).join("")}
  function renderBars(host,rows,labelKey,valueKey,format=money){const el=$(host);if(!rows?.length){el.innerHTML='<div class="empty-state">데이터가 없습니다.</div>';return}const max=Math.max(...rows.map(r=>Number(r[valueKey])||0),1);el.innerHTML=rows.map(r=>`<div class="bar-row"><div class="bar-name">${esc(r[labelKey])}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1,(Number(r[valueKey])||0)/max*100)}%"></div></div><div class="bar-value">${format(r[valueKey])}</div></div>`).join("")}


  function shiftYmClient(ym,delta){if(!/^\d{4}-\d{2}$/.test(String(ym||"")))return null;const [y,m]=ym.split("-").map(Number),d=new Date(Date.UTC(y,m-1+delta,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`}
  function normalizeTrackMonths(rows,startYm,endYm){if(!startYm||!endYm)return rows||[];const map=new Map((rows||[]).map(x=>[x.ym,x])),out=[];let ym=startYm,guard=0,prev=0;while(ym&&ym<=endYm&&guard<360){const src=map.get(ym)||{};const revenue=Number(src.revenue||0);out.push({...src,ym,revenue,rows_count:Number(src.rows_count||0),platforms_count:Number(src.platforms_count||0),distributors_count:Number(src.distributors_count||0),actual_count:Number(src.actual_count||0),analysis_count:Number(src.analysis_count||0),previous_revenue:prev,mom_pct:guard?pctCalc(revenue,prev):null});prev=revenue;ym=shiftYmClient(ym,1);guard++}return out}
  function pctCalc(cur,prev){return Number(prev)>0?((Number(cur||0)/Number(prev))-1)*100:null}
  function trackTrendLabel(cur,prev){const c=Number(cur||0),p=Number(prev||0);if(p===0&&c>0)return{label:"신규 상승",cls:"up"};if(p===0&&c===0)return{label:"최근 수익 없음",cls:"neutral"};const g=(c/p-1)*100;if(g>=20)return{label:`강한 상승 ${pct(g)}`,cls:"up"};if(g>=5)return{label:`상승 ${pct(g)}`,cls:"up"};if(g<=-20)return{label:`강한 하락 ${pct(g)}`,cls:"down"};if(g<=-5)return{label:`하락 ${pct(g)}`,cls:"down"};return{label:`보합 ${pct(g)}`,cls:"neutral"}}
  function filterTrackMonths(rows){if(state.trackRange==="all")return rows||[];const n=Number(state.trackRange||24);return (rows||[]).slice(-n)}
  function renderPlatformTrend(host,monthly,platformRows){const el=$(host);const rows=filterTrackMonths(monthly||[]);const top=(platformRows||[]).slice(0,5).map(x=>x.platform);if(!rows.length||!top.length){el.innerHTML='<div class="empty-state">데이터가 없습니다.</div>';return}const months=rows.map(x=>x.ym),byKey=new Map((state.trackDetail?.platformMonthly||[]).map(x=>[`${x.ym}|${x.platform}`,Number(x.revenue)||0]));const vals=top.flatMap(p=>months.map(ym=>byKey.get(`${ym}|${p}`)||0)),max=Math.max(...vals,1);const W=940,H=290,M={l:34,r:18,t:24,b:40};const x=i=>M.l+(W-M.l-M.r)*(months.length===1?.5:i/(months.length-1));const y=v=>M.t+(H-M.t-M.b)*(1-Number(v)/(max||1));let grid="",labels="",series="";for(let i=0;i<5;i++){const yy=M.t+(H-M.t-M.b)*i/4;const val=max*(1-i/4);grid+=`<line class="chart-grid-line" x1="${M.l}" y1="${yy}" x2="${W-M.r}" y2="${yy}"/><text class="chart-label" x="${M.l}" y="${yy-4}">${val>=10000?(val/10000).toFixed(1)+"만":mf.format(val)}</text>`}const step=Math.max(1,Math.ceil(months.length/7));months.forEach((ym,i)=>{if(i%step===0||i===months.length-1)labels+=`<text class="chart-label" text-anchor="middle" x="${x(i)}" y="${H-12}">${ymShort(ym)}</text>`});top.forEach((p,si)=>{const pts=months.map((ym,i)=>[x(i),y(byKey.get(`${ym}|${p}`)||0),ym,byKey.get(`${ym}|${p}`)||0]);const path=pts.map((pt,i)=>`${i?"L":"M"}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(" ");series+=`<path class="platform-series ps-${si}" d="${path}"/>`+pts.map(pt=>`<circle class="platform-point ps-${si}" cx="${pt[0]}" cy="${pt[1]}" r="2.8"><title>${esc(p)} · ${pt[2]} · ${money(pt[3])}</title></circle>`).join("")});const legend=top.map((p,i)=>`<span><i class="legend-dot ps-bg-${i}"></i>${esc(p)}</span>`).join("");el.innerHTML=`<div class="platform-legend">${legend}</div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${series}${labels}</svg>`}
  function renderTrackDetailCharts(){const d=state.trackDetail;if(!d)return;const months=filterTrackMonths(d.monthly||[]);renderLineChart("#trackMonthlyTrend",months,d.completeYm);renderPlatformTrend("#trackPlatformTrend",d.monthly||[],d.platforms||[]);const label=state.trackRange==="all"?"전체 기간":`최근 ${state.trackRange}개월`;$("#tdMonthlyPeriod").textContent=label;$("#tdPlatformTrendPeriod").textContent=label}
  function closeTrackDetail(){state.selectedTrack=null;state.trackDetail=null;$("#trackDetailView").classList.add("hidden");$("#trackListView").classList.remove("hidden");$("#pageEyebrow").textContent="TRACKS";$("#pageTitle").textContent="음원 분석"}
  async function loadTrackDetail(song){if(!song)return;state.selectedTrack=song;$("#trackListView").classList.add("hidden");$("#trackDetailView").classList.remove("hidden");$("#pageEyebrow").textContent="TRACK DETAIL";$("#pageTitle").textContent="음원 상세 분석";$("#trackDetailTitle").textContent=song;$("#trackDetailMeta").textContent="불러오는 중…";const d=await api(`/analytics?view=track-detail&${periodQuery()}&song=${encodeURIComponent(song)}`);if(state.scope==="all")d.monthly=normalizeTrackMonths(d.monthly||[],d.summary?.first_month,d.completeYm||d.summary?.latest_month);else d.monthly=d.monthly||[];state.trackDetail=d;const s=d.summary||{},r=d.recent||{},artists=s.artists||"-",albums=s.albums||"-";if($("#tdRevenueLabel"))$("#tdRevenueLabel").textContent=state.scope==="all"?"누적 수익":state.scope==="year"?`${state.periodYear}년 수익`:`${state.periodMonth} 수익`;if($("#tdRecentLabel"))$("#tdRecentLabel").textContent=state.scope==="month"?"선택월":"최근 3개월";if($("#trackPlatformCurrentHead"))$("#trackPlatformCurrentHead").textContent=state.scope==="month"?"선택월":"최근3M";$("#trackDetailTitle").textContent=s.song_title||song;$("#trackDetailMeta").textContent=`${artists} · ${albums} · ${num(s.rows_count)}건`;$("#tdRevenue").textContent=money(s.revenue);$("#tdActivePeriod").textContent=`${s.first_month||"-"} ~ ${s.latest_month||"-"} · ${num(s.active_months)}개월`;$("#tdRecent3").textContent=money(r.recent3_revenue);$("#tdRecentGrowth").textContent=state.scope==="month"?`전월 대비 ${pct(r.recent3_growth_pct)}`:`직전 3개월 대비 ${pct(r.recent3_growth_pct)}`;$("#tdRecent12").textContent=money(r.recent12_revenue);$("#tdRecent12Share").textContent=Number(s.revenue||0)>0?`누적의 ${(Number(r.recent12_revenue||0)/Number(s.revenue)*100).toFixed(1)}%`:"누적 대비 -";$("#tdYtd").textContent=money(r.ytd_revenue);$("#tdYoy").textContent=`전년 동기간 대비 ${pct(r.ytd_yoy_pct)}`;$("#tdActualCount").textContent=num(s.actual_count);$("#tdAnalysisCount").textContent=`분석 카운트 ${num(s.analysis_count)} · 추정 ${num(s.estimated_rows)}행`;$("#tdPlatforms").textContent=`${num(s.platforms_count)}개 플랫폼`;$("#tdLatestMonth").textContent=`최근월 ${s.latest_month||"-"} · ${num(s.distributors_count)}개 유통사`;const trend=trackTrendLabel(r.recent3_revenue,r.prev3_revenue);$("#trackTrendBadge").textContent=trend.label;$("#trackTrendBadge").className=`trend-pill ${trend.cls}`;$("#tdPlatformPeriod").textContent=comparisonLabel(d);renderBars("#trackYearBars",(d.yearly||[]).map(x=>({...x,label:`${x.year}년`})),"label","revenue");renderBars("#trackPlatformBars",(d.platforms||[]).slice(0,12),"platform","revenue");renderBars("#trackDistributorBars",d.distributors||[],"distributor","revenue");const top=(d.platforms||[])[0];$("#tdTopPlatform").textContent=top?`TOP ${top.platform} · ${Number(top.share_pct||0).toFixed(1)}%`:"TOP -";$("#trackPlatformsBody").innerHTML=(d.platforms||[]).map(x=>`<tr><td><b>${esc(x.platform)}</b><div class="table-sub">${esc(x.distributors||"")}</div></td><td class="num">${money(x.revenue)}</td><td class="num">${Number(x.share_pct||0).toFixed(1)}%</td><td class="num">${money(x.current_revenue)}</td><td class="num">${deltaHtml(x.delta)}</td><td class="num">${growthHtml(x.growth_pct,x.current_revenue,x.previous_revenue)}</td><td class="num">${num(x.actual_count)}</td><td class="num">${num(x.analysis_count)}</td><td class="num">${x.rpm_actual===null?'-':money(x.rpm_actual)}</td><td>${esc(x.latest_month||"-")}</td></tr>`).join("");$("#trackMonthsBody").innerHTML=[...(d.monthly||[])].reverse().map(x=>`<tr><td><b>${esc(x.ym)}</b></td><td class="num">${money(x.revenue)}</td><td class="num">${growthHtml(x.mom_pct,x.revenue,x.previous_revenue)}</td><td class="num">${num(x.actual_count)}</td><td class="num">${num(x.analysis_count)}</td><td class="num">${num(x.platforms_count)}</td><td class="num">${num(x.distributors_count)}</td><td class="num">${num(x.rows_count)}</td></tr>`).join("");renderTrackDetailCharts()}
  async function loadDashboard(){const d=await api(`/analytics?view=overview&${periodQuery()}`);$("#latestYm").textContent=d.latestYm||"-";$("#completeYm").textContent=d.completeYm||"-";const incomplete=!!(d.latestYm&&!d.completeYm)||!!(d.latestYm&&d.completeYm&&d.latestYm>d.completeYm);$("#completeBadge").textContent=incomplete?"이후 월 미완결":"완결";$("#completeBadge").className=`badge ${incomplete?"warn":"good"}`;$("#kpiRevenue").textContent=money(d.totals.revenue_total);$("#kpiRows").textContent=`${num(d.totals.rows_count)}건 · ${num(d.totals.distributors_count)}개 유통사`;if(state.scope==="month"){$("#kpiRevenueLabel").textContent=`${state.periodMonth} 수익`;$("#kpiCompleteLabel").textContent="전월 대비";$("#kpiCompleteRevenue").textContent=pct(d.recent.mom_pct);$("#kpiMom").textContent=`전월 ${money(d.recent.previous_month_revenue)}`;$("#kpiRecentLabel").textContent="분석 카운트";$("#kpiRecent3").textContent=num(d.totals.analysis_count_total);$("#kpiRecentGrowth").textContent=`실제 ${num(d.totals.actual_count_total)}`}else{$("#kpiRevenueLabel").textContent=state.scope==="year"?`${state.periodYear}년 수익`:"누적 정산수익";$("#kpiCompleteLabel").textContent="최근 완결월 수익";$("#kpiCompleteRevenue").textContent=money(d.recent.complete_revenue);$("#kpiMom").textContent=`전월 대비 ${pct(d.recent.mom_pct)}`;$("#kpiRecentLabel").textContent="최근 3개월 수익";$("#kpiRecent3").textContent=money(d.recent.revenue);$("#kpiRecentGrowth").textContent=`직전 3개월 대비 ${pct(d.recent.growth_pct)}`}$("#kpiTracks").textContent=`${num(d.totals.tracks_count)}곡`;$("#kpiAlbums").textContent=`${num(d.totals.albums_count)}앨범`;$("#kpiPlatforms").textContent=`${num(d.totals.platforms_count)}개`;const conc=Number(d.concentration.total||0)>0?Number(d.concentration.platform_top4||0)/Number(d.concentration.total)*100:0;$("#kpiPlatformConc").textContent=`TOP4 수익 비중 ${conc.toFixed(1)}%`;const qTotal=Number(d.totals.rows_count||0),qActual=Number(d.totals.actual_rows||0),qEst=Number(d.totals.estimated_rows||0),qZero=Number(d.totals.zero_adjusted_rows||0);$("#kpiCountQuality").textContent=qTotal?`${(qActual/qTotal*100).toFixed(1)}% 실제`:"-";$("#kpiCountQualitySub").textContent=`실제 ${num(qActual)} · 0보정 ${num(qZero)} · 추정 ${num(qEst)}`;renderLineChart("#revenueTrend",d.monthly,d.completeYm);renderRank("#topTracks",d.topTracks,"song_title","revenue");renderBars("#topPlatforms",d.topPlatforms,"platform","revenue");renderMomentum("#trackMomentum",d.trackMomentum,"song_title");renderMomentum("#platformMomentum",d.platformMomentum,"platform");const per=comparisonLabel(d);$("#trackMomentumPeriod").textContent=per;$("#platformMomentumPeriod").textContent=per;$("#coverageCards").innerHTML=(d.coverage||[]).map(x=>`<div class="coverage-card"><h3>${esc(x.distributor)}</h3><div class="coverage-meta"><div><span>누적 수익</span><strong>${money(x.revenue)}</strong></div><div><span>정산 건수</span><strong>${num(x.rows_count)}</strong></div><div><span>수익 최신월</span><strong>${esc(x.latest_occurrence||"-")}</strong></div><div><span>정산 최신월</span><strong>${esc(x.latest_settlement||"-")}</strong></div></div></div>`).join("")}

  async function loadMonths(){const d=await api(`/analytics?view=months&${periodQuery()}`);$("#monthsCompleteChip").textContent=state.scope==="month"?`선택월 ${state.periodMonth}`:state.scope==="year"?`${state.periodYear}년`:"전체기간";renderLineChart("#monthlyLongTrend",d.rows.slice(-60),d.completeYm);$("#monthsBody").innerHTML=[...d.rows].reverse().map(r=>`<tr><td><b>${esc(r.ym)}</b></td><td>${r.complete?'<span class="badge good">완결</span>':'<span class="badge warn">미완결</span>'}</td><td class="num">${money(r.revenue)}</td><td class="num">${growthHtml(r.mom_pct,r.revenue,1)}</td><td class="num">${num(r.actual_count)}</td><td class="num">${num(r.analysis_count)}</td><td class="num">${num(r.tracks_count)}</td><td class="num">${num(r.platforms_count)}</td><td class="num">${num(r.distributors_count)}</td></tr>`).join("")}

  async function loadPlatforms(){const d=await api(`/analytics?view=platforms&${periodQuery()}`);const rows=d.rows||[];renderBars("#platformShareBars",rows.slice(0,12),"platform","revenue");const rpm=rows.filter(x=>Number(x.actual_count)>=20&&Number.isFinite(Number(x.rpm_actual))).sort((a,b)=>Number(b.rpm_actual)-Number(a.rpm_actual)).slice(0,12);renderBars("#platformRpmBars",rpm,"platform","rpm_actual",v=>`₩${mf.format(v)}`);$("#platformPeriod").textContent=comparisonLabel(d);$("#platformsBody").innerHTML=rows.map(r=>`<tr><td><b>${esc(r.platform)}</b></td><td class="num">${money(r.revenue)}</td><td class="num">${Number(r.share_pct||0).toFixed(1)}%</td><td class="num">${money(r.current_revenue)}</td><td class="num">${deltaHtml(r.delta)}</td><td class="num">${growthHtml(r.growth_pct,r.current_revenue,r.previous_revenue)}</td><td class="num">${num(r.actual_count)}</td><td class="num">${r.rpm_actual===null?"-":`₩${mf.format(r.rpm_actual)}`}</td><td class="num">${num(r.tracks_count)}</td><td>${esc(r.latest_month||"-")}</td></tr>`).join("")}

  async function loadTracks(){if(state.selectedTrack){await loadTrackDetail(state.selectedTrack);return}const d=await api(`/analytics?view=tracks&${periodQuery()}`);state.tracks=d.rows||[];$("#trackPeriod").textContent="추세 비교: "+comparisonLabel(d);renderTracks()}
  function renderTracks(){const q=$("#trackSearch").value.trim().toLowerCase(),sort=$("#trackSort").value;let rows=state.tracks.filter(r=>!q||[r.song_title,r.artists,r.albums].some(v=>String(v||"").toLowerCase().includes(q)));const fn=sort==="rise"?(a,b)=>Number(b.delta)-Number(a.delta):sort==="growth"?(a,b)=>{const ga=Number.isFinite(Number(a.growth_pct))?Number(a.growth_pct):-1e9,gb=Number.isFinite(Number(b.growth_pct))?Number(b.growth_pct):-1e9;return gb-ga}:sort==="total"?(a,b)=>Number(b.revenue)-Number(a.revenue):(a,b)=>Number(b.current_revenue)-Number(a.current_revenue);rows.sort(fn);$("#tracksBody").innerHTML=rows.map((r,i)=>`<tr class="track-row" data-song="${esc(r.song_title)}"><td>${i+1}</td><td class="song-title-cell"><button class="track-link" type="button" data-track-open="${esc(r.song_title)}">${esc(r.song_title)}</button></td><td><div>${esc(r.artists||"-")}</div><div class="table-sub">${esc(r.albums||"")}</div></td><td class="num">${money(r.revenue)}</td><td class="num">${money(r.current_revenue)}</td><td class="num">${deltaHtml(r.delta)}</td><td class="num">${growthHtml(r.growth_pct,r.current_revenue,r.previous_revenue)}</td><td class="num">${num(r.actual_count)}</td><td class="num">${num(r.platforms_count)}</td><td>${esc(r.latest_month||"-")}</td><td><button class="detail-button" type="button" data-track-open="${esc(r.song_title)}">상세 →</button></td></tr>`).join("")}

  async function loadDistributors(){const d=await api(`/analytics?view=distributors&${periodQuery()}`);const rows=d.rows||[];$("#distributorCards").innerHTML=rows.map(r=>`<article class="distributor-card"><span class="share">수익 비중 ${Number(r.share_pct||0).toFixed(1)}%</span><h2>${esc(r.distributor)}</h2><strong>${money(r.revenue)}</strong><div class="mini"><span>수익 최신월<b>${esc(r.latest_occurrence||"-")}</b></span><span>정산 최신월<b>${esc(r.latest_settlement||"-")}</b></span><span>실제카운트 행<b>${Number(r.count_actual_row_pct||0).toFixed(1)}%</b></span></div></article>`).join("");$("#distributorsBody").innerHTML=rows.map(r=>`<tr><td><b>${esc(r.distributor)}</b></td><td class="num">${money(r.revenue)}</td><td class="num">${Number(r.share_pct||0).toFixed(1)}%</td><td class="num">${num(r.rows_count)}</td><td class="num">${num(r.tracks_count)}</td><td class="num">${num(r.platforms_count)}</td><td>${esc(r.latest_occurrence||"-")}</td><td>${esc(r.latest_settlement||"-")}</td><td class="num">${Number(r.count_actual_row_pct||0).toFixed(1)}%</td></tr>`).join("")}

  async function loadQuality(){const d=await api("/analytics?view=quality");$("#qRows").textContent=num(d.summary.rows_count);$("#qMissingOriginal").textContent=num(d.summary.original_missing_rows);$("#qZeroPositive").textContent=num(d.summary.original_zero_positive_rows);$("#qUnmapped").textContent=num(d.unmappedSourceKeys);$("#qArtists").textContent=`${num(d.summary.artist_variants)}종`;const labels={actual:"실제 카운트",zero_adjusted:"0카운트 보정",estimated:"추정 카운트",missing:"미제공"};renderBars("#qualityBases",(d.bases||[]).map(x=>({...x,label:labels[x.count_basis]||x.count_basis})),"label","rows_count",num);renderRank("#artistVariants",d.artists||[],"artist","revenue",r=>`${num(r.rows_count)}건`);$("#importsBody").innerHTML=(d.imports||[]).map(r=>`<tr><td>${esc((r.started_at||"").replace("T"," "))}</td><td>${esc(r.file_name||"-")}</td><td class="num">${num(r.rows_received)}</td><td class="num">${num(r.rows_inserted)}</td><td class="num">${num(r.duplicate_rows)}</td><td class="num">${num(r.mapping_rows)}</td><td>${r.completed_at?'<span class="badge good">완료</span>':'<span class="badge warn">진행</span>'}</td></tr>`).join("")}

  function recordParams(page=state.recordPage,limit=50){const p=new URLSearchParams({page:String(page),limit:String(limit),scope:state.scope});if(state.scope==="year"&&state.periodYear)p.set("period",state.periodYear);if(state.scope==="month"&&state.periodMonth)p.set("period",state.periodMonth);const q=$("#recordSearch").value.trim(),d=$("#recordDistributor").value,pl=$("#recordPlatform").value,cb=$("#recordCountBasis").value;if(q)p.set("q",q);if(d)p.set("distributor",d);if(pl)p.set("platform",pl);if(cb)p.set("count_basis",cb);return p}
  async function loadRecords(){
    const d=await api(`/records?${recordParams()}`);
    state.recordTotal=d.total;state.recordPages=Math.max(1,Math.ceil(d.total/d.limit));
    $("#pageInfo").textContent=`${d.page} / ${state.recordPages} · ${num(d.total)}건`;
    $("#prevPage").disabled=d.page<=1;$("#nextPage").disabled=d.page>=state.recordPages;
    digitalRecordRows.clear();
    $("#recordsBody").innerHTML=(d.rows||[]).map(r=>{
      const isDigital=!!r.manual_key;
      if(isDigital)digitalRecordRows.set(String(r.manual_key),r);
      const action=isDigital?`<button type="button" class="btn btn-ghost btn-sm" data-digital-edit="${esc(r.manual_key)}">수정</button>`:r.id?`<button type="button" class="icon-btn danger-mini" data-delete-id="${r.id}" title="삭제">×</button>`:'<span class="table-sub">R2</span>';
      return `<tr><td>${esc(r.occurrence_ym||"-")}</td><td>${esc(r.settlement_ym||"-")}</td><td>${esc(r.distributor)}</td><td><div class="song-title-cell">${esc(r.song_title)}</div><div class="table-sub">${esc(r.artist||"")} · ${esc(r.album_title||"")}</div>${isDigital?'<span class="badge actual">직접 입력</span>':""}</td><td><div>${esc(r.platform||"-")}</div><div class="table-sub">${esc(r.original_platform||"")} / ${esc(r.original_service||"")}</div></td><td class="num">${money(r.settlement_amount)}</td><td class="num">${r.original_count===null?'-':num(r.original_count)}</td><td class="num">${r.analysis_count===null?'-':num(r.analysis_count)}</td><td>${countBadge(r.count_basis)}${r.estimate_confidence?`<div class="table-sub">${esc(r.estimate_confidence)}</div>`:""}</td><td>${action}</td></tr>`;
    }).join("");
  }
  async function deleteRecord(id){if(!confirm("이 정산 행을 삭제할까요?"))return;await api(`/records?id=${id}`,{method:"DELETE"});toast("삭제했습니다.");await loadRecords()}
  async function exportCsv(){toast("CSV를 준비 중입니다.");let all=[],page=1,total=1;while(all.length<total){const d=await api(`/records?${recordParams(page,500)}`);total=d.total;all.push(...d.rows);page++;if(page>50)break}const head=["수익년월","정산년월","유통사","아티스트","앨범명","곡명","통합플랫폼","원본플랫폼","원본서비스","정산금액","원본카운트","분석카운트","카운트구분","추정방법","비고"];const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;const csv='\ufeff'+[head,...all.map(r=>[r.occurrence_ym,r.settlement_ym,r.distributor,r.artist,r.album_title,r.song_title,r.platform,r.original_platform,r.original_service,r.settlement_amount,r.original_count,r.analysis_count,r.count_basis,r.estimate_method,r.notes])].map(row=>row.map(q).join(",")).join("\r\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download=`kenneth-settlement-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

  function toNumber(v){if(v===null||v===undefined||v==="")return null;if(typeof v==="number"&&Number.isFinite(v))return v;const n=Number(String(v).replace(/[,₩원\s]/g,""));return Number.isFinite(n)?n:null}
  function parseYm(v,year,month){if(v instanceof Date&&!isNaN(v))return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,"0")}`;if(typeof v==="number"&&window.XLSX){const d=XLSX.SSF.parse_date_code(v);if(d)return `${d.y}-${String(d.m).padStart(2,"0")}`};const s=String(v??"").trim();const m=s.match(/(20\d{2}|19\d{2})[^0-9]?([01]?\d)/);if(m)return `${m[1]}-${String(Number(m[2])).padStart(2,"0")}`;if(year&&month)return `${String(Number(year)).padStart(4,"0")}-${String(Number(month)).padStart(2,"0")}`;return null}
  function median(a){const x=a.filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2}
  function applyCountQuality(rows){const maps={sdp:new Map(),sp:new Map(),s:new Map(),dp:new Map(),p:new Map(),d:new Map(),g:new Map()};const push=(map,key,val)=>{if(!(val>0))return;if(!map.has(key))map.set(key,[]);map.get(key).push(val)};for(const r of rows){const c=toNumber(r.original_count),m=toNumber(r.settlement_amount);if(c>0&&m>0){const rate=m/c;push(maps.sdp,`${r.song_title}|${r.distributor}|${r.platform}`,rate);push(maps.sp,`${r.song_title}|${r.platform}`,rate);push(maps.s,r.song_title,rate);push(maps.dp,`${r.distributor}|${r.platform}`,rate);push(maps.p,r.platform,rate);push(maps.d,r.distributor,rate);push(maps.g,"global",rate)}}let stats={actual:0,zero_adjusted:0,estimated:0,missing:0};for(const r of rows){const oc=toNumber(r.original_count),adj=toNumber(r.adjusted_count),m=toNumber(r.settlement_amount)||0;r.analysis_count=null;r.estimate_method="";r.estimate_confidence="";if(oc!==null&&oc>0){r.original_count=Math.round(oc);r.analysis_count=Math.round(oc);r.count_basis="actual";stats.actual++;continue}if(oc!==null&&oc===0&&m>0){r.original_count=0;r.analysis_count=adj>0?Math.round(adj):1;r.count_basis="zero_adjusted";r.estimate_method="원본 0 + 수익 발생 / 엑셀 보정카운트";r.estimate_confidence="medium";stats.zero_adjusted++;continue}if(oc===null&&m>0){const candidates=[[maps.sdp,`${r.song_title}|${r.distributor}|${r.platform}`,"동일 음원·유통사·플랫폼","high"],[maps.sp,`${r.song_title}|${r.platform}`,"동일 음원·플랫폼","high"],[maps.s,r.song_title,"동일 음원","medium"],[maps.dp,`${r.distributor}|${r.platform}`,"동일 유통사·플랫폼","medium"],[maps.p,r.platform,"동일 플랫폼","medium"],[maps.d,r.distributor,"동일 유통사","low"],[maps.g,"global","전체 데이터","very-low"]];let done=false;for(const [map,key,label,conf] of candidates){const rate=median(map.get(key)||[]);if(rate>0){r.analysis_count=Math.max(1,Math.round(m/rate));r.count_basis="estimated";r.estimate_method=`${label} 1카운트당 수익 중앙값`;r.estimate_confidence=conf;stats.estimated++;done=true;break}}if(done)continue}r.count_basis="missing";stats.missing++}return stats}
  function findHeader(matrix,required){for(let i=0;i<Math.min(20,matrix.length);i++){const set=new Set((matrix[i]||[]).map(x=>String(x??"").trim()));if(required.every(x=>set.has(x)))return i}return -1}
  function rowsFromSheet(ws,headerMap,required){const matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:null,raw:true});const hi=findHeader(matrix,required);if(hi<0)throw new Error(`${required.join(", ")} 헤더를 찾지 못했습니다.`);const headers=matrix[hi].map(h=>headerMap[String(h??"").trim()]||null),out=[];for(let i=hi+1;i<matrix.length;i++){const line=matrix[i]||[],r={};headers.forEach((k,j)=>{if(k)r[k]=line[j]});if(r.song_title&&String(r.song_title).trim())out.push(r)}return out}
  async function parseFile(file){
    if(!window.XLSX||!window.SettlementImport)throw new Error("엑셀 파서가 로드되지 않았습니다. 새로고침해주세요.");
    const wb=await XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
    return SettlementImport.parseWorkbook(wb,file.name);
  }
  let fileSelection=0,importBusy=false;
  function resetImportPreview(){
    state.importRows=[];state.importMappings=[];state.importFile="";state.importMode="replace";
    $("#previewCount").textContent="0건";
    $("#previewBody").innerHTML="";
    $("#previewTableWrap").classList.add("hidden");
    $("#importProgress").classList.add("hidden");
    $("#importProgressBar").style.width="0%";
    $("#importButton").disabled=true;
  }
  async function handleFiles(input){
    if(importBusy)return;
    const files=Array.from(input||[]);if(!files.length)return;
    const selection=++fileSelection;
    resetImportPreview();
    $("#fileInfo").classList.remove("hidden");
    $("#fileInfo").textContent=`${files.map(f=>f.name).join(" · ")} · 분석 중…`;
    $("#importSummary").className="import-summary empty-state";
    $("#importSummary").textContent="정산서 형식과 금액을 확인하고 있습니다.";
    try{
      if(files.some(f=>! /\.xlsx$/i.test(f.name)))throw new Error("XLSX 파일만 선택해주세요.");
      const results=[];
      for(const file of files){const result=await parseFile(file);if(selection!==fileSelection)return;results.push(result)}
      if(results.length>1&&results.some(r=>r.format!=="minerva"))throw new Error("통합관리 엑셀은 한 파일씩 반영해주세요. 미네르바 원본 정산서는 여러 파일을 함께 선택할 수 있습니다.");
      const rawPeriods=new Set();
      for(const result of results){
        if(result.format!=="minerva")continue;
        const period=result.settlementYm||result.rows[0]?.settlement_ym;
        if(rawPeriods.has(period))throw new Error("같은 정산월의 미네르바 파일은 하나씩 반영해주세요. 서로 다른 월의 파일은 함께 선택할 수 있습니다.");
        rawPeriods.add(period);
      }
      const rows=results.flatMap(r=>r.rows),mappings=results.flatMap(r=>r.mappings);
      if(!rows.length)throw new Error("가져올 세부 정산내역이 없습니다.");
      const stats=applyCountQuality(rows),revenue=rows.reduce((sum,r)=>sum+(Number(r.settlement_amount)||0),0),dates=rows.map(r=>r.occurrence_ym).filter(Boolean).sort();
      state.importRows=rows;state.importMappings=mappings;state.importFile=files.map(f=>f.name).join("; ");
      state.importMode=results.every(r=>r.format==="minerva")?"append":"replace";
      const append=state.importMode==="append";
      $("#fileInfo").textContent=`${files.length}개 파일 · 세부 정산 ${num(rows.length)}건 · ${append?"기존 자료에 추가":"통합관리 엑셀"}`;
      $("#previewCount").textContent=`${num(rows.length)}건`;
      $("#importSummary").className="import-summary";
      $("#importSummary").innerHTML=`<div class="summary-grid"><div class="summary-box"><span>세부 정산행</span><strong>${num(rows.length)}건</strong></div><div class="summary-box"><span>수익 기간</span><strong>${esc(dates[0]||"-")} ~ ${esc(dates.at(-1)||"-")}</strong></div><div class="summary-box"><span>정산금액 합계</span><strong>${money(revenue)}</strong></div></div><p class="muted">${append?"미네르바 원본 정산서를 기존 자료에 추가합니다. 이미 반영된 내역은 중복 제외합니다.":"통합관리 엑셀로 전체 분석자료를 갱신합니다."}</p><p class="muted">실제 ${num(stats.actual)}행 · 0카운트 보정 ${num(stats.zero_adjusted)}행 · 추정 ${num(stats.estimated)}행 · 미제공 ${num(stats.missing)}행</p>`;
      $("#previewBody").innerHTML=rows.slice(0,12).map(x=>`<tr><td>${num(x.source_row_no)}</td><td>${esc(x.occurrence_ym||"-")}</td><td>${esc(x.distributor)}</td><td>${esc(x.song_title)}</td><td>${esc(x.platform||"-")}</td><td class="num">${money(x.settlement_amount)}</td><td class="num">${x.analysis_count===null?'-':num(x.analysis_count)}</td><td>${countBadge(x.count_basis)}</td></tr>`).join("");
      $("#previewTableWrap").classList.remove("hidden");
      $("#importButton").disabled=false;
    }catch(e){
      if(selection!==fileSelection)return;
      resetImportPreview();$("#fileInfo").textContent=e.message;
      $("#importSummary").className="import-summary empty-state";$("#importSummary").textContent=e.message;toast(e.message,"error");
    }
  }
  async function seedR2Snapshot(batchId){
    if(state.importMode==="append"){
      const status=await api("/cache/seed",{force:true});
      if(!status.supportsAppend)throw new Error("추가 업로드 기능이 아직 배포되지 않았습니다. 배포 완료 후 새로고침해주세요.");
    }
    const total=state.importRows.length,chunk=500;let result;
    for(let i=0,chunkNo=0;i<total;i+=chunk,chunkNo++){
      const rows=state.importRows.slice(i,i+chunk),finalChunk=i+chunk>=total,done=Math.min(total,i+rows.length);
      result=await api("/cache/seed",{method:"POST",body:JSON.stringify({mode:state.importMode,snapshotVersion:batchId,chunkNo,rows,finalChunk,totalRows:total,mappings:finalChunk?state.importMappings:[]})});
      const p=Math.round(done/total*55);$("#importProgressBar").style.width=`${p}%`;$("#importProgressText").textContent=`${p}%`;$("#importButton").textContent=`분석자료 반영… ${num(done)} / ${num(total)}`;
    }
    return result;
  }
  async function importRows(){
    if(!state.importRows.length||importBusy)return;
    const total=state.importRows.length,chunk=300,batchId=`${state.importMode}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    let inserted=0,dupes=0,d1Ok=true,d1Error="";
    importBusy=true;$("#fileInput").disabled=true;$("#importButton").disabled=true;$("#importButton").textContent="분석자료 준비…";$("#importProgress").classList.remove("hidden");
    try{
      const snapshot=await seedR2Snapshot(batchId);clearGetCache();
      try{
        for(let i=0;i<total;i+=chunk){
          const rows=state.importRows.slice(i,i+chunk),finalChunk=i+chunk>=total,d=await api("/import",{method:"POST",body:JSON.stringify({batchId,fileName:state.importFile,rows,mappings:i===0?state.importMappings:[],finalChunk})});
          if(Number(d.invalid||0)>0)throw new Error(`정산내역 ${num(d.invalid)}건의 필수정보를 확인해주세요.`);
          inserted+=Number(d.inserted||0);dupes+=Number(d.duplicates||0);
          const done=Math.min(total,i+rows.length),p=55+Math.round(done/total*45);$("#importProgressBar").style.width=`${p}%`;$("#importProgressText").textContent=`${p}%`;$("#importButton").textContent=`원본 저장… ${num(done)} / ${num(total)}`;
        }
      }catch(err){d1Ok=false;d1Error=err.message||String(err)}
      $("#importProgressBar").style.width="100%";$("#importProgressText").textContent="100%";
      const cacheSummary=state.importMode==="append"?`기존 분석자료 보존 · 신규 ${num(snapshot.appended)}건 · 중복 ${num(snapshot.duplicates)}건`:`전체 분석자료 ${num(total)}건 반영`;
      $("#importSummary").innerHTML=d1Ok?`<strong>정산 데이터 반영 완료</strong><p class="muted">${cacheSummary}</p><p class="muted">원본 신규 ${num(inserted)}건 · 중복 ${num(dupes)}건</p>`:`<strong>분석자료 반영 완료 · 원본 저장 재시도 필요</strong><p class="muted">${cacheSummary}</p><p class="muted">${esc(d1Error)}. 같은 파일을 다시 반영하면 중복을 제외하고 저장을 재시도합니다.</p>`;
      toast(d1Ok?"정산 데이터 반영이 완료됐습니다.":"분석자료는 반영됐습니다. 원본 저장은 다시 시도해주세요.",d1Ok?"ok":"error");
      state.importRows=[];state.importMappings=[];$("#fileInput").value="";clearGetCache();
      try{await loadMeta()}catch(e){toast(`반영은 완료됐지만 화면 갱신에 실패했습니다: ${e.message}`,"error")}
    }catch(e){toast(e.message,"error")}
    finally{importBusy=false;$("#fileInput").disabled=false;$("#importButton").textContent="정산 데이터 반영";$("#importButton").disabled=!state.importRows.length}
  }

  async function saveManual(e){e.preventDefault();const fd=new FormData(e.currentTarget),obj=Object.fromEntries(fd.entries());if(obj.original_count==="")obj.original_count=null;else obj.original_count=Number(obj.original_count);obj.settlement_amount=Number(obj.settlement_amount||0);try{await api("/records",{method:"POST",body:JSON.stringify(obj)});e.currentTarget.reset();$("#manualDialog").close();toast("저장했습니다.");await Promise.all([loadMeta(),loadRecords()])}catch(err){toast(err.message,"error")}}

  const digitalRecordRows=new Map();
  let digitalManualBusy=false,digitalAccountGeneration=0;
  function clearDigitalManualAccount(){
    digitalAccountGeneration++;
    const input=$("#digitalLoginId");if(input)input.value="";
    const copy=$("#copyDigitalLoginIdButton");if(copy)copy.disabled=true;
    const status=$("#digitalAccountStatus");if(status)status.textContent="";
  }
  async function openDigitalManual(row=null){
    if(digitalManualBusy)return;
    const form=$("#digitalManualForm");form.reset();
    form.elements.settlement_ym.value=row?.settlement_ym||"";
    form.elements.settlement_ym.readOnly=!!row;
    form.elements.occurrence_ym.value=row?.occurrence_ym||"";
    form.elements.settlement_amount.value=row?String(row.settlement_amount):"";
    form.elements.original_count.value=row?.original_count===null||row?.original_count===undefined?"":String(row.original_count);
    form.elements.notes.value=row?.notes||"";
    form.dataset.editing=row?.manual_key||"";
    $("#digitalManualTitle").textContent=row?"디지털 레코즈 정산 수정":"디지털 레코즈 정산 입력";
    $("#digitalManualMessage").textContent="";clearDigitalManualAccount();
    $("#digitalAccountStatus").textContent="아이디 불러오는 중…";
    $("#digitalManualDialog").showModal();
    const generation=digitalAccountGeneration;
    try{
      const d=await api("/manual");
      if(generation!==digitalAccountGeneration||!$("#digitalManualDialog").open)return;
      if(!d.account?.login_id)throw new Error("아이디를 불러오지 못했습니다.");
      $("#digitalLoginId").value=String(d.account.login_id);
      $("#copyDigitalLoginIdButton").disabled=digitalManualBusy;
      $("#digitalAccountStatus").textContent="";
    }catch(error){
      if(generation===digitalAccountGeneration&&$("#digitalManualDialog").open)$("#digitalAccountStatus").textContent="아이디를 불러오지 못했습니다.";
    }
  }
  async function copyDigitalLoginId(){
    const input=$("#digitalLoginId");if(!input.value)return;
    try{
      if(!navigator.clipboard?.writeText)throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(input.value);toast("아이디를 복사했습니다.");
    }catch{
      input.focus();input.select();
      const copied=typeof document.execCommand==="function"&&document.execCommand("copy");
      toast(copied?"아이디를 복사했습니다.":"아이디를 선택했습니다. Ctrl+C로 복사해주세요.");
    }
  }
  function updateDigitalOccurrence(){
    const form=$("#digitalManualForm");
    form.elements.occurrence_ym.value=shiftYmClient(form.elements.settlement_ym.value,-3)||"";
  }
  function digitalManualPayload(form){
    const validYm=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
    const settlement_ym=form.elements.settlement_ym.value,occurrence_ym=form.elements.occurrence_ym.value;
    if(!validYm(settlement_ym)||!validYm(occurrence_ym))throw new Error("정산월과 수익월을 확인해주세요.");
    const amountText=form.elements.settlement_amount.value.trim();
    const settlement_amount=Number(amountText);
    if(!amountText||!Number.isFinite(settlement_amount)||settlement_amount<0)throw new Error("정산금액을 0 이상으로 입력해주세요.");
    const countText=form.elements.original_count.value.trim();
    const original_count=countText===""?null:Number(countText);
    if(original_count!==null&&(!Number.isSafeInteger(original_count)||original_count<0))throw new Error("카운트는 0 이상의 정수로 입력해주세요.");
    const payload={settlement_ym,occurrence_ym,settlement_amount,original_count,notes:form.elements.notes.value.trim()};
    const aliases=["디지털레코즈","디지털레코드","digitalrecords"];
    const distributor=(state.meta?.distributors||[]).find(value=>aliases.includes(String(value||"").toLowerCase().replace(/\s/g,"")));
    if(distributor)payload.distributor=distributor;
    return payload;
  }
  function setDigitalManualBusy(busy){
    digitalManualBusy=busy;
    $$("#digitalManualForm input, #digitalManualForm textarea, #digitalManualForm button").forEach(el=>el.disabled=busy);
    $("#copyDigitalLoginIdButton").disabled=busy||!$("#digitalLoginId").value;
    $("#digitalAccountLink").setAttribute("aria-disabled",String(busy));
    $("#digitalManualSave").textContent=busy?"저장 중…":"저장";
  }
  async function digitalMonthAlreadyImported(settlementYm){
    const provider=value=>String(value||"").toLowerCase().replace(/\s/g,"");
    let page=1,received=0,total=1;
    while(received<total){
      const params=new URLSearchParams({scope:"all",q:"오우야",limit:"500",page:String(page)});
      const d=await api(`/records?${params}`),rows=d.rows||[];total=Number(d.total)||0;
      if(rows.some(r=>!r.manual_key&&r.song_title==="오우야"&&r.settlement_ym===settlementYm&&["디지털레코즈","디지털레코드","digitalrecords"].includes(provider(r.distributor))))return true;
      received+=rows.length;
      if(!rows.length&&received<total)throw new Error("기존 정산내역 확인을 완료하지 못했습니다. 다시 시도해주세요.");
      page++;
    }
    return false;
  }
  async function saveDigitalManual(e){
    e.preventDefault();if(digitalManualBusy)return;
    const form=e.currentTarget,message=$("#digitalManualMessage");let obj;
    try{obj=digitalManualPayload(form)}catch(error){message.textContent=error.message;return}
    message.textContent="";setDigitalManualBusy(true);
    try{
      if(await digitalMonthAlreadyImported(obj.settlement_ym))throw new Error("이 정산월은 기존 정산내역에 이미 있습니다.");
      let result;
      try{result=await api("/manual",{method:"POST",body:JSON.stringify(obj)})}catch(error){
        if(error.status!==409||error.details?.error!=="manual_entry_exists")throw error;
        const previous=error.details.previous;
        if(!previous)throw error;
        const text=`${obj.settlement_ym} 디지털 레코즈 정산이 이미 있습니다.\n기존: ${money(previous.settlement_amount)} · 수익월 ${previous.occurrence_ym||"-"}\n변경: ${money(obj.settlement_amount)} · 수익월 ${obj.occurrence_ym}\n기존 내용을 수정할까요?`;
        if(!confirm(text))return;
        result=await api("/manual",{method:"POST",body:JSON.stringify({...obj,replace_existing:true,expected_fingerprint:previous.manual_fingerprint})});
      }
      $("#digitalManualDialog").close();form.reset();clearGetCache();
      toast(result.duplicate?"같은 내용이 이미 저장되어 있습니다.":result.replaced?"정산내역을 수정했습니다.":"디지털 레코즈 정산을 저장했습니다.");
      try{await loadMeta();await loadRecords()}catch(error){toast(`저장은 완료됐지만 화면 갱신에 실패했습니다: ${error.message}`,"error")}
    }catch(error){const text=error.message==="manual_entry_changed_retry"?"이 정산내역이 변경됐습니다. 다시 저장해 최신 내용을 확인해주세요.":error.message;message.textContent=text;toast(text,"error")}
    finally{setDigitalManualBusy(false)}
  }

  function bind(){ $("#loginForm").addEventListener("submit",login);$("#logoutButton").addEventListener("click",logout);$("#retryStatusButton").addEventListener("click",checkStatus);$$(`.nav-group[data-group]`).forEach(b=>b.addEventListener("click",()=>{const g=b.dataset.group,target=(g==="analysis"||g==="settlement")?(state.lastGroupPage[g]||groupDefault[g]):groupDefault[g];nav(target)}));$("#sectionTabs").addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)nav(b.dataset.page)});$$(`#periodControl button`).forEach(b=>b.addEventListener("click",()=>setScope(b.dataset.scope)));$("#periodYear").addEventListener("change",e=>{state.periodYear=e.target.value;reloadForPeriod()});$("#periodMonth").addEventListener("change",e=>{state.periodMonth=e.target.value;reloadForPeriod()});$("#refreshButton").addEventListener("click",async()=>{clearGetCache();await loadMeta();await loadPage(state.page)});$("#trackSearch").addEventListener("input",debounce(renderTracks));$("#trackSort").addEventListener("change",renderTracks);$("#tracksBody").addEventListener("click",e=>{const b=e.target.closest("[data-track-open]");if(b)loadTrackDetail(b.dataset.trackOpen)});$("#trackBackButton").addEventListener("click",closeTrackDetail);$$("#trackRangeControl button").forEach(b=>b.addEventListener("click",()=>{state.trackRange=b.dataset.range;$$("#trackRangeControl button").forEach(x=>x.classList.toggle("active",x===b));renderTrackDetailCharts()}));const rr=debounce(()=>{state.recordPage=1;loadRecords()});for(const id of ["recordSearch","recordDistributor","recordPlatform","recordCountBasis"])$("#"+id).addEventListener(id==="recordSearch"?"input":"change",rr);$("#prevPage").addEventListener("click",()=>{if(state.recordPage>1){state.recordPage--;loadRecords()}});$("#nextPage").addEventListener("click",()=>{if(state.recordPage<state.recordPages){state.recordPage++;loadRecords()}});$("#recordsBody").addEventListener("click",e=>{const edit=e.target.closest("[data-digital-edit]");if(edit){const row=digitalRecordRows.get(edit.dataset.digitalEdit);if(row)openDigitalManual(row);return}const b=e.target.closest("[data-delete-id]");if(b)deleteRecord(Number(b.dataset.deleteId))});$("#exportCsvButton").addEventListener("click",exportCsv);$("#openManualButton").addEventListener("click",()=>$("#manualDialog").showModal());$("#manualForm").addEventListener("submit",saveManual);$$("[data-close-dialog]").forEach(b=>b.addEventListener("click",()=>{if(b.dataset.closeDialog==="digitalManualDialog"&&digitalManualBusy)return;$("#"+b.dataset.closeDialog).close()}));$("#openDigitalManualButton").addEventListener("click",()=>openDigitalManual());$("#digitalManualForm").addEventListener("submit",saveDigitalManual);$("#copyDigitalLoginIdButton").addEventListener("click",copyDigitalLoginId);$("#digitalAccountLink").addEventListener("click",e=>{if(digitalManualBusy)e.preventDefault()});$("#digitalManualForm").elements.settlement_ym.addEventListener("change",updateDigitalOccurrence);$("#digitalManualDialog").addEventListener("cancel",e=>{if(digitalManualBusy)e.preventDefault()});$("#fileInput").addEventListener("change",e=>handleFiles(e.target.files));const dz=$("#dropZone");for(const ev of ["dragenter","dragover"])dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("drag")});for(const ev of ["dragleave","drop"])dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("drag")});dz.addEventListener("drop",e=>handleFiles(e.dataTransfer.files));$("#importButton").addEventListener("click",importRows)}
  document.addEventListener("DOMContentLoaded",()=>{bind();checkStatus()});
})();
