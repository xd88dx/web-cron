// ui.js —— 管理面板 HTML（内嵌，Worker 直接返回，无需静态资源绑定）
// 注意：外层用 String.raw 模板，内部禁止出现反引号与 ${，前端 JS 一律用字符串拼接。
export const HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Web 定时任务</title>
<style>
:root{--bg:#f4f6fb;--card:#fff;--line:#e5e9f2;--txt:#1f2937;--muted:#6b7280;--blue:#2563eb;--green:#16a34a;--green-bg:#f0fdf4;--red:#dc2626;--red-bg:#fef2f2;--gray-bg:#f3f4f6;--shadow:0 1px 3px rgba(16,24,40,.08)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;background:var(--bg);color:var(--txt);font-size:14px}
header{background:var(--card);border-bottom:1px solid var(--line);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:20}
.brand{font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px}
.brand small{color:var(--muted);font-weight:400;font-size:12px}
.hd-actions{display:flex;gap:8px;flex-wrap:wrap}
button{cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--txt);border-radius:8px;padding:7px 14px;font-size:13px;transition:.15s}
button:hover{border-color:var(--blue);color:var(--blue)}
button.primary{background:var(--blue);border-color:var(--blue);color:#fff}
button.primary:hover{background:#1d4ed8;color:#fff}
button.danger:hover{border-color:var(--red);color:var(--red)}
button.icon{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:1;border-radius:8px;color:var(--muted)}
button.icon:hover{color:var(--blue);border-color:var(--blue);background:#eff6ff}
button.icon.danger{color:var(--red)}
button.icon.danger:hover{background:var(--red-bg);border-color:var(--red);color:var(--red)}
main{max-width:1200px;margin:0 auto;padding:20px 24px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;box-shadow:var(--shadow)}
.stat .v{font-size:24px;font-weight:700;margin-top:4px}
.stat .l{color:var(--muted);font-size:12px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);overflow:hidden}
table{width:100%;border-collapse:collapse}
th{font-size:12px;color:var(--muted);text-align:left;padding:12px 16px;border-bottom:1px solid var(--line);background:#fafbfd;font-weight:600;white-space:nowrap}
td{padding:12px 16px;border-bottom:1px solid var(--line);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fafbfd}
.tname{font-weight:600}
.turl{color:var(--muted);font-size:12px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.badge.on{background:var(--green-bg);color:var(--green)}
.badge.off{background:var(--gray-bg);color:var(--muted)}
.badge.ok{background:var(--green-bg);color:var(--green)}
.badge.fail{background:var(--red-bg);color:var(--red)}
.badge.idle{background:var(--gray-bg);color:var(--muted)}
.muted{color:var(--muted);font-size:12px}
.ops{display:flex;gap:6px;justify-content:flex-end}
.empty{text-align:center;padding:48px 0;color:var(--muted)}
.empty .big{font-size:36px;margin-bottom:8px}
.overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);display:none;align-items:center;justify-content:center;z-index:50;padding:20px}
.overlay.show{display:flex}
.modal{background:var(--card);border-radius:14px;width:100%;max-width:560px;max-height:90vh;overflow:auto;padding:22px 24px;box-shadow:0 20px 50px rgba(0,0,0,.25)}
.modal h3{margin-bottom:16px;font-size:16px}
.frow{margin-bottom:12px}
.frow label{display:block;font-size:12px;color:var(--muted);margin-bottom:5px;font-weight:600}
.frow input,.frow select,.frow textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;background:#fff;color:var(--txt)}
.frow textarea{resize:vertical;min-height:64px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.mfoot{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
#editOverlay .mfoot,#logOverlay .mfoot{position:sticky;bottom:0;background:var(--card);margin:18px -24px -22px;padding:14px 24px 22px;z-index:1}
.err{color:var(--red);font-size:12px;min-height:16px;margin-top:6px}
.histok{color:var(--green);font-weight:700}
.histfail{color:var(--red);font-weight:700}
.snippet{background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:12px;color:var(--muted);white-space:pre-wrap;word-break:break-all;margin-top:4px;max-height:120px;overflow:auto}
#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:10px 20px;border-radius:10px;font-size:13px;opacity:0;pointer-events:none;transition:.25s;z-index:99}
#toast.show{opacity:1}
.login-box{max-width:340px}
td .muted{margin-top:3px}
#taskBody tr[draggable]{cursor:grab}
#taskBody tr.dragging{opacity:.4}
#taskBody tr.drop-before td{box-shadow:inset 0 2px 0 var(--blue)}
#taskBody tr.drop-after td{box-shadow:inset 0 -2px 0 var(--blue)}
.hidden{display:none!important}
</style>
</head>
<body>
<header>
  <div class="brand">⏰ web-cron <small>多功能定时任务调度器</small></div>
  <div class="hd-actions">
    <button id="btnExport">导出备份</button>
    <button id="btnImport">导入备份</button>
    <button id="btnLogout" class="hidden">退出登录</button>
    <button id="btnNew" class="primary">＋ 新建任务</button>
  </div>
</header>
<main>
  <section class="stats">
    <div class="stat"><div class="l">任务总数</div><div class="v" id="stTasks">-</div></div>
    <div class="stat"><div class="l">运行中</div><div class="v" id="stEnabled">-</div></div>
    <div class="stat"><div class="l">24h 成功率</div><div class="v" id="stRate">-</div></div>
    <div class="stat"><div class="l">24h 执行次数</div><div class="v" id="stRuns">-</div></div>
  </section>
  <section class="panel">
    <table>
      <thead><tr>
        <th style="width:80px">状态</th><th>任务</th><th style="width:170px">调度规则</th>
        <th style="width:190px">上次执行</th><th style="width:160px">下次执行</th>
        <th style="width:210px;text-align:right">操作</th>
      </tr></thead>
      <tbody id="taskBody"></tbody>
    </table>
    <div class="empty hidden" id="emptyBox"><div class="big">📭</div>还没有任务，点击右上角「新建任务」添加第一个定时访问任务</div>
  </section>
</main>

<div class="overlay" id="editOverlay" data-dismiss="outside">
  <div class="modal">
    <h3 id="editTitle">新建任务</h3>
    <div class="frow"><label>任务名称 *</label><input id="fName" placeholder="例：站点保活"></div>
    <div class="frow"><label>访问地址 URL *</label><input id="fUrl" placeholder="https://example.com/ping"></div>
    <div class="grid3">
      <div class="frow"><label>请求方法</label><select id="fMethod"><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option><option>HEAD</option><option>PATCH</option></select></div>
      <div class="frow"><label>超时（秒，1-120）</label><input id="fTimeout" type="number" value="30" min="1" max="120"></div>
      <div class="frow"><label>失败重试次数（0-5）</label><input id="fRetries" type="number" value="0" min="0" max="5"></div>
    </div>
    <div class="frow"><label>调度方式</label>
      <select id="fStype" onchange="document.getElementById('intervalBox').classList.toggle('hidden',this.value!=='interval');document.getElementById('cronBox').classList.toggle('hidden',this.value!=='cron')">
        <option value="interval">固定间隔（每 N 分钟）</option><option value="cron">Cron 表达式（分 时 日 月 周）</option>
      </select>
    </div>
    <div class="grid2">
      <div class="frow" id="intervalBox"><label>间隔（分钟，≥1）</label><input id="fInterval" type="number" value="5" min="1"></div>
      <div class="frow hidden" id="cronBox"><label>Cron 表达式（5 段式，按设置时区判定）</label><input id="fCron" placeholder="*/5 * * * *"></div>
    </div>
    <div class="frow"><label>请求头（每行 Key: Value，或 JSON 对象，可覆盖默认浏览器头）</label><textarea id="fHeaders" placeholder="Authorization: Bearer xxx"></textarea></div>
    <div class="frow"><label>请求体 Body（非 GET 时生效，可选）</label><textarea id="fBody" placeholder="{&quot;keepalive&quot;: true}"></textarea></div>
    <div class="err" id="editErr"></div>
    <div class="mfoot"><button onclick="tryCloseEdit()">取消</button><button class="primary" id="btnSave">保存</button></div>
  </div>
</div>

<div class="overlay" id="logOverlay" data-dismiss="outside">
  <div class="modal" style="max-width:760px">
    <h3 id="logTitle">执行日志</h3>
    <div id="logBody"></div>
    <div class="mfoot"><button onclick="document.getElementById('logOverlay').classList.remove('show')">关闭</button></div>
  </div>
</div>

<div class="overlay" id="loginOverlay">
  <div class="modal login-box">
    <h3>🔐 web-cron 管理登录</h3>
    <div class="frow"><label>访问密码</label><input id="loginPwd" type="password" onkeydown="if(event.key==='Enter')doLogin()"></div>
    <div class="err" id="loginErr"></div>
    <div class="mfoot"><button class="primary" onclick="doLogin()">登录</button></div>
  </div>
</div>

<div id="toast"></div>
<input type="file" id="importFile" accept=".json" class="hidden">

<script>
let TASKS = [], TZ = 'UTC', editingId = null, authRequired = false;
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function fmt(ts){
  if(!ts) return '';
  try{ return new Intl.DateTimeFormat('zh-CN',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(ts)).replace(/\//g,'-'); }
  catch(e){ return new Date(ts).toISOString(); }
}
function hdr(){ var h={'Content-Type':'application/json'}, p=localStorage.getItem('cw_pwd'); if(p) h['X-Auth']=p; return h; }
function toast(msg){ var t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(function(){t.classList.remove('show');},2200); }
async function api(path, opts){
  opts = opts || {};
  opts.headers = Object.assign({}, hdr(), opts.headers || {});
  var r = await fetch(path, opts);
  if(r.status===401){ $('loginOverlay').classList.add('show'); throw new Error('unauthorized'); }
  var d = await r.json().catch(function(){return {};});
  if(!r.ok) throw new Error(d.error || ('HTTP '+r.status));
  return d;
}
async function doLogin(){
  try{
    var r = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('loginPwd').value})});
    if(!r.ok) throw new Error('bad');
    localStorage.setItem('cw_pwd',$('loginPwd').value);
    $('loginOverlay').classList.remove('show'); $('loginErr').textContent=''; load();
  }catch(e){ $('loginErr').textContent='密码错误'; }
}
function schedText(t){ return t.schedule_type==='cron' ? 'cron: '+t.cron_expr : '每 '+t.interval_minutes+' 分钟'; }
function lastBadge(t){
  if(t.last_run_at == null) return '<span class="badge idle">未运行</span>';
  if(t.last_ok===1) return '<span class="badge ok">✓ '+(t.last_status_code==null?'-':t.last_status_code)+' · '+t.last_duration_ms+'ms</span>';
  return '<span class="badge fail" title="'+esc(t.last_error||'')+'">✗ '+(t.last_status_code==null?'-':t.last_status_code)+' · '+esc(t.last_error||'失败')+'</span>';
}
function render(d){
  TASKS = d.tasks; TZ = d.timezone || 'UTC'; authRequired = d.auth_required;
  if(authRequired) $('btnLogout').classList.remove('hidden');
  var s=d.stats;
  $('stTasks').textContent=s.tasks; $('stEnabled').textContent=s.enabled;
  $('stRate').textContent=(s.rate24==null?'—':s.rate24+'%'); $('stRuns').textContent=s.runs24;
  $('taskBody').innerHTML = d.tasks.map(function(t){
    return '<tr draggable="true" data-id="'+t.id+'">'+
      '<td>'+(t.enabled?'<span class="badge on">● 运行中</span>':'<span class="badge off">⏸ 已暂停</span>')+'</td>'+
      '<td><span class="tname">'+esc(t.name)+'</span><span class="turl" title="'+esc(t.url)+'">'+esc(t.method)+' '+esc(t.url)+'</span></td>'+
      '<td>'+esc(schedText(t))+(t.retries>0?'<div class="muted">失败重试 '+t.retries+' 次</div>':'')+'</td>'+
      '<td>'+lastBadge(t)+'<div class="muted">'+esc(t.last_run_at_str||'')+'</div></td>'+
      '<td class="muted">'+(t.enabled?esc(t.next_run_at_str||'等待调度'):'—')+'</td>'+
      '<td><div class="ops">'+
        '<button class="icon" title="立即执行" onclick="runNow('+t.id+')">'+svgIcon('play')+'</button>'+
        '<button class="icon" title="'+(t.enabled?'暂停':'启动')+'" onclick="toggleTask('+t.id+')">'+svgIcon(t.enabled?'pause':'power')+'</button>'+
        '<button class="icon" title="执行日志" onclick="showLog('+t.id+')">'+svgIcon('log')+'</button>'+
        '<button class="icon" title="编辑" onclick="openEdit('+t.id+')">'+svgIcon('edit')+'</button>'+
        '<button class="icon danger" title="删除" onclick="delTask('+t.id+')">'+svgIcon('del')+'</button>'+
      '</div></td></tr>';
  }).join('');
  $('emptyBox').classList.toggle('hidden', d.tasks.length>0);
}
var LAST=null, dragBusy=false;
async function load(){
  if(dragBusy) return;  // 拖拽进行中跳过自动刷新，避免定时 render 打断拖拽
  try{ LAST=await api('/api/tasks'); render(LAST); }
  catch(e){ if(e.message!=='unauthorized') toast('加载失败: '+e.message); }
}
function svgIcon(n){
  var P={
    play:'<polygon points="6 4 20 12 6 20 6 4"/>',
    pause:'<line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/>',
    power:'<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
    log:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>',
    edit:'<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    del:'<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
  };
  return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+P[n]+'</svg>';
}
async function saveReorder(ids){
  try{ await api('/api/tasks/reorder',{method:'POST',body:JSON.stringify({ids:ids})}); toast('排序已保存'); }
  catch(e){ toast('排序保存失败: '+e.message); }
  load();
}
(function(){  // 任务列表拖拽排序：事件委托挂在 tbody 上，render 重建行不影响监听
  var tb=document.getElementById('taskBody'); var dragId=null;
  function rowOf(e){ var el=e.target; return el && el.closest ? el.closest('tr') : null; }
  tb.addEventListener('dragstart',function(e){
    var tr=rowOf(e); if(!tr||!tr.getAttribute('data-id')) return;
    dragId=+tr.getAttribute('data-id'); dragBusy=true;
    tr.classList.add('dragging'); e.dataTransfer.effectAllowed='move';
    try{ e.dataTransfer.setData('text/plain',String(dragId)); }catch(_){}
  });
  tb.addEventListener('dragover',function(e){
    if(dragId==null) return;
    var tr=rowOf(e); if(!tr) return;
    var dst=+tr.getAttribute('data-id');
    if(!dst||dst===dragId) return;
    e.preventDefault(); e.dataTransfer.dropEffect='move';
    var r=tr.getBoundingClientRect();
    var before=e.clientY-r.top<r.height/2;
    tr.classList.toggle('drop-before',before);
    tr.classList.toggle('drop-after',!before);
  });
  tb.addEventListener('dragleave',function(e){
    var tr=rowOf(e); if(tr) tr.classList.remove('drop-before','drop-after');
  });
  tb.addEventListener('drop',function(e){
    if(dragId==null) return;
    e.preventDefault();
    var tr=rowOf(e); if(!tr) return;
    var dst=+tr.getAttribute('data-id');
    var r=tr.getBoundingClientRect();
    var before=e.clientY-r.top<r.height/2;
    if(dst&&dst!==dragId&&LAST){
      var ids=LAST.tasks.map(function(t){return t.id;}).filter(function(i){return i!==dragId;});
      var idx=ids.indexOf(dst);
      if(idx>=0){
        ids.splice(before?idx:idx+1,0,dragId);
        var byId={}; LAST.tasks.forEach(function(t){byId[t.id]=t;});
        LAST.tasks=ids.map(function(i){return byId[i];});
        render(LAST);      // 乐观更新：先按新顺序渲染，保存失败由 load() 回滚
        saveReorder(ids);
      }
    }
  });
  tb.addEventListener('dragend',function(){
    dragId=null; dragBusy=false;
    Array.prototype.forEach.call(tb.querySelectorAll('tr'),function(x){
      x.classList.remove('dragging','drop-before','drop-after');
    });
    load();
  });
})();
function taskById(id){ return TASKS.find(function(t){return t.id===id;}) || {}; }
function openEdit(id){
  editingId=id; $('editErr').textContent=''; $('editTitle').textContent=id?'编辑任务':'新建任务';
  var t=taskById(id);
  $('fName').value=t.name||''; $('fUrl').value=t.url||''; $('fMethod').value=t.method||'GET';
  $('fTimeout').value=t.timeout_seconds==null?30:t.timeout_seconds;
  $('fRetries').value=t.retries==null?0:t.retries;
  $('fStype').value=t.schedule_type||'interval';
  $('fInterval').value=t.interval_minutes==null?5:t.interval_minutes;
  $('fCron').value=t.cron_expr||''; $('fHeaders').value=t.headers||''; $('fBody').value=t.body||'';
  $('fStype').dispatchEvent(new Event('change'));
  $('editOverlay').classList.add('show');
  editSnapshot = formSnapshot();
}
// 编辑弹窗：有未保存改动时，点遮罩 / Esc / 取消 都先二次确认，避免误关丢输入。
var editSnapshot = null;
function formSnapshot(){
  var els = document.querySelectorAll('#editOverlay input, #editOverlay select, #editOverlay textarea');
  var out = [];
  for(var i=0;i<els.length;i++){
    var e = els[i];
    out.push([e.id||e.name||('x'+i), e.type === 'checkbox' ? (e.checked ? '1' : '0') : e.value]);
  }
  return JSON.stringify(out);
}
function editDirty(){
  var el = document.getElementById('editOverlay');
  if(!el || !el.classList.contains('show') || editSnapshot === null) return false;
  return formSnapshot() !== editSnapshot;
}
function tryCloseEdit(){
  if(editDirty() && !confirm('有未保存的修改，确定要关闭吗？')) return;
  closeEdit();
}
function closeEdit(){ $('editOverlay').classList.remove('show'); editingId=null; editSnapshot=null; }
async function save(){
  var payload={ name:$('fName').value, url:$('fUrl').value, method:$('fMethod').value,
    timeout_seconds:+$('fTimeout').value, retries:+$('fRetries').value,
    schedule_type:$('fStype').value, interval_minutes:+$('fInterval').value,
    cron_expr:$('fCron').value, headers:$('fHeaders').value, body:$('fBody').value };
  try{
    if(editingId) await api('/api/tasks/'+editingId,{method:'PUT',body:JSON.stringify(payload)});
    else await api('/api/tasks',{method:'POST',body:JSON.stringify(payload)});
    closeEdit(); toast('已保存'); load();
  }catch(e){ $('editErr').textContent=e.message; }
}
async function runNow(id){
  toast('正在执行…');
  try{
    var r=await api('/api/tasks/'+id+'/run',{method:'POST'});
    if(r.result.ok) toast('✓ 执行成功 · HTTP '+r.result.status_code+' · '+r.result.duration_ms+'ms');
    else toast('✗ 执行失败 · '+(r.result.error||('HTTP '+r.result.status_code)));
    load();
  }catch(e){ toast('执行失败: '+e.message); }
}
async function toggleTask(id){ try{ await api('/api/tasks/'+id+'/toggle',{method:'POST'}); load(); }catch(e){ toast(e.message); } }
async function delTask(id){
  var t=taskById(id);
  if(!confirm('确定删除任务「'+t.name+'」？其执行历史也将删除。')) return;
  try{ await api('/api/tasks/'+id,{method:'DELETE'}); toast('已删除'); load(); }catch(e){ toast(e.message); }
}
async function showLog(id){
  var t=taskById(id);
  $('logTitle').textContent='📜 执行日志 — '+t.name;
  $('logBody').innerHTML='<div class="muted">加载中…</div>';
  $('logOverlay').classList.add('show');
  try{
    var r=await api('/api/tasks/'+id+'/history?limit=50');
    $('logBody').innerHTML = r.history.length===0 ? '<div class="empty">暂无执行记录</div>' :
      '<table><thead><tr><th>时间</th><th>结果</th><th>状态码</th><th>耗时</th><th>详情</th></tr></thead><tbody>'+
      r.history.map(function(h){
        return '<tr><td class="muted" style="white-space:nowrap">'+esc(h.run_at_str)+'</td>'+
          '<td>'+(h.ok?'<span class="histok">成功</span>':'<span class="histfail">失败</span>')+'</td>'+
          '<td>'+(h.status_code==null?'-':h.status_code)+'</td><td>'+h.duration_ms+'ms</td>'+
          '<td><div class="muted">'+esc(h.error||'')+'</div>'+(h.snippet?'<div class="snippet">'+esc(h.snippet)+'</div>':'')+'</td></tr>';
      }).join('')+'</tbody></table>';
  }catch(e){ $('logBody').innerHTML='<div class="err">'+esc(e.message)+'</div>'; }
}
async function doExport(){
  try{
    var r=await fetch('/api/export',{headers:hdr()});
    if(!r.ok) throw new Error('HTTP '+r.status);
    var blob=await r.blob(), a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download='web-cron_backup.json'; a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
  }catch(e){ toast('导出失败: '+e.message); }
}
$('btnSave').onclick=save;
$('btnNew').onclick=function(){openEdit(null);};
$('btnLogout').onclick=function(){ localStorage.removeItem('cw_pwd'); location.reload(); };
$('btnExport').onclick=doExport;
$('btnImport').onclick=function(){ $('importFile').click(); };
$('importFile').onchange=async function(ev){
  var f=ev.target.files[0]; if(!f) return;
  try{
    var text=await f.text();
    var r=await api('/api/import',{method:'POST',body:text});
    toast('导入完成：成功 '+r.imported+' 个，跳过 '+r.skipped+' 个'); load();
  }catch(e){ toast('导入失败: '+e.message); }
  ev.target.value='';
};
load();
setInterval(load,15000);

// 弹窗：点击遮罩空白区关闭，避免长日志必须滚到底部才能点「关闭」。
// 仅带 data-dismiss="outside" 的遮罩生效；登录框不带 —— 关掉后没有入口重新登录。
// mousedown + click 双判据：防止「在弹窗内容里按下、拖到遮罩松开」被误判成点外部。
(function(){
  var downOnBackdrop = false;
  function loginVisible(){
    var el = document.getElementById('loginOverlay');
    return !!(el && el.classList.contains('show'));
  }
  function closeOverlay(el){
    if(el.id === 'editOverlay' && typeof tryCloseEdit === 'function'){ tryCloseEdit(); return; }
    el.classList.remove('show');
  }
  document.addEventListener('mousedown', function(e){
    downOnBackdrop = !!(e.target && e.target.classList && e.target.classList.contains('overlay'));
  });
  document.addEventListener('click', function(e){
    if(!downOnBackdrop) return;
    downOnBackdrop = false;
    var el = e.target;
    if(!el || !el.classList || !el.classList.contains('overlay')) return;
    if(el.getAttribute('data-dismiss') !== 'outside' || loginVisible()) return;
    closeOverlay(el);
  });
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape' || loginVisible()) return;
    var list = document.querySelectorAll('.overlay.show[data-dismiss="outside"]');
    if(list.length) closeOverlay(list[list.length - 1]);
  });
})();
</script>
</body>
</html>`;
