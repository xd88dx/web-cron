// ui.ts —— 管理面板 HTML（内嵌，无需静态资源）
// 来源：worker/src/ui.js，增加双模式表单、浏览器能力提示、日志详情字段。
// 外层 String.raw 模板，内部禁止出现反引号与 ${，前端 JS 一律字符串拼接。
export const HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Web 定时任务</title>
<style>
:root{--bg:#f4f6fb;--card:#fff;--line:#e5e9f2;--txt:#1f2937;--muted:#6b7280;--blue:#2563eb;--purple:#7c3aed;--purple-bg:#f5f3ff;--green:#16a34a;--green-bg:#f0fdf4;--red:#dc2626;--red-bg:#fef2f2;--amber:#b45309;--amber-bg:#fffbeb;--gray-bg:#f3f4f6;--shadow:0 1px 3px rgba(16,24,40,.08)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;background:var(--bg);color:var(--txt);font-size:14px}
header{background:var(--card);border-bottom:1px solid var(--line);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:20;gap:12px;flex-wrap:wrap}
.brand{font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px}
.brand small{color:var(--muted);font-weight:400;font-size:12px}
.hd-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bstatus{font-size:12px;padding:5px 10px;border-radius:999px;font-weight:600;white-space:nowrap}
.bstatus.yes{background:var(--green-bg);color:var(--green)}
.bstatus.no{background:var(--amber-bg);color:var(--amber)}
button{cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--txt);border-radius:8px;padding:7px 14px;font-size:13px;transition:.15s}
button:hover{border-color:var(--blue);color:var(--blue)}
button.primary{background:var(--blue);border-color:var(--blue);color:#fff}
button.primary:hover{background:#1d4ed8;color:#fff}
button.danger:hover{border-color:var(--red);color:var(--red)}
button.icon{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:1;border-radius:8px;color:var(--muted)}
button.icon:hover{color:var(--blue);border-color:var(--blue);background:#eff6ff}
button.icon.danger{color:var(--red)}
button.icon.danger:hover{background:var(--red-bg);border-color:var(--red);color:var(--red)}
button.mini{padding:3px 8px;font-size:11px}
main{max-width:1280px;margin:0 auto;padding:20px 24px}
.banner{background:var(--amber-bg);border:1px solid #fde68a;color:var(--amber);border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:13px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;box-shadow:var(--shadow)}
.stat .v{font-size:24px;font-weight:700;margin-top:4px}
.stat .l{color:var(--muted);font-size:12px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);overflow:hidden}
table{width:100%;border-collapse:collapse}
th{font-size:12px;color:var(--muted);text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);background:#fafbfd;font-weight:600;white-space:nowrap}
td{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fafbfd}
.tname{font-weight:600}
.turl{color:var(--muted);font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.badge.on{background:var(--green-bg);color:var(--green)}
.badge.off{background:var(--gray-bg);color:var(--muted)}
.badge.ok{background:var(--green-bg);color:var(--green)}
.badge.fail{background:var(--red-bg);color:var(--red)}
.badge.idle{background:var(--gray-bg);color:var(--muted)}
.badge.http{background:#eff6ff;color:#1d4ed8}
.badge.browser{background:var(--purple-bg);color:var(--purple)}
.badge.ssh{background:#ecfdf5;color:#047857}
.badge.challenge{background:var(--red-bg);color:var(--red)}
.muted{color:var(--muted);font-size:12px}
.ops{display:flex;gap:6px;justify-content:flex-end}
.empty{text-align:center;padding:48px 0;color:var(--muted)}
.empty .big{font-size:36px;margin-bottom:8px}
.overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);display:none;align-items:center;justify-content:center;z-index:50;padding:20px}
.overlay.show{display:flex}
.modal{background:var(--card);border-radius:14px;width:100%;max-width:620px;max-height:90vh;overflow:auto;padding:22px 24px;box-shadow:0 20px 50px rgba(0,0,0,.25)}
.modal h3{margin-bottom:16px;font-size:16px}
.frow{margin-bottom:12px}
.frow label{display:block;font-size:12px;color:var(--muted);margin-bottom:5px;font-weight:600}
.frow input,.frow select,.frow textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;background:#fff;color:var(--txt)}
.frow textarea{resize:vertical;min-height:60px}
.frow input:disabled,.frow select:disabled,.frow textarea:read-only{background:var(--gray-bg);color:var(--muted);cursor:not-allowed}
.frow input[type=checkbox]{width:auto;margin-right:6px}
.checkline{display:flex;align-items:center;font-size:13px;gap:2px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.fieldset{border:1px dashed var(--line);border-radius:10px;padding:12px 14px;margin-bottom:12px;background:#fcfcff}
.fieldset legend{font-size:12px;font-weight:700;color:var(--purple);padding:0 6px}
.mfoot{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
#editOverlay .mfoot,#logOverlay .mfoot,#gistOverlay .mfoot{position:sticky;bottom:0;background:var(--card);margin:18px -24px -22px;padding:14px 24px 22px;z-index:1}
.err{color:var(--red);font-size:12px;min-height:16px;margin-top:6px}
.histok{color:var(--green);font-weight:700}
.histfail{color:var(--red);font-weight:700}
.snippet{background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:12px;color:var(--muted);white-space:pre-wrap;word-break:break-all;margin-top:4px;max-height:100px;overflow:auto}
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
    <span id="bStatus" class="bstatus no">浏览器仿真：探测中…</span>
    <button id="btnExport">导出备份</button>
    <button id="btnImport">导入备份</button>
    <button id="btnGist">Gist 同步</button>
    <button id="btnLogout" class="hidden">退出登录</button>
    <button id="btnNew" class="primary">＋ 新建任务</button>
  </div>
</header>
<main>
  <div class="banner hidden" id="degradeBox"></div>
  <section class="stats">
    <div class="stat"><div class="l">任务总数</div><div class="v" id="stTasks">-</div></div>
    <div class="stat"><div class="l">运行中</div><div class="v" id="stEnabled">-</div></div>
    <div class="stat"><div class="l">24h 成功率</div><div class="v" id="stRate">-</div></div>
    <div class="stat"><div class="l">24h 执行次数</div><div class="v" id="stRuns">-</div></div>
  </section>
  <section class="panel">
    <table>
      <thead><tr>
        <th style="width:76px">状态</th><th>任务</th><th style="width:88px">方式</th>
        <th style="width:150px">调度规则</th><th style="width:180px">上次执行</th>
        <th style="width:150px">下次执行</th><th style="width:200px;text-align:right">操作</th>
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
    <div class="frow"><label>访问方式 *</label>
      <select id="fMode" onchange="onModeChange()">
        <option value="http">🌐 HTTP 请求（普通站点，轻量快速）</option>
        <option value="browser">🧭 浏览器仿真（反爬站点，真实模拟）</option>
        <option value="ssh">🖥️ SSH 命令（远程保活/触发）</option>
      </select>
    </div>
    <div class="frow" id="urlRow"><label>访问地址 URL *</label><input id="fUrl" placeholder="https://example.com/ping"></div>
    <div class="grid3">
      <div class="frow"><label>请求方法</label><select id="fMethod"><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option><option>HEAD</option><option>PATCH</option></select></div>
      <div class="frow"><label>超时（秒，1-120）</label><input id="fTimeout" type="number" value="30" min="1" max="120" oninput="refreshSshPreview()"></div>
      <div class="frow"><label>失败重试（0-5）</label><input id="fRetries" type="number" value="0" min="0" max="5"></div>
    </div>
    <div class="frow hidden" id="browserOnlyHint"><div class="muted">浏览器仿真固定以 GET 导航、不携带请求体。</div></div>
    <div class="frow" id="fallbackBox"><label class="checkline"><input type="checkbox" id="fFallback"> HTTP 遇 403/429/503 或挑战页时，自动升级为浏览器仿真重试一次</label></div>
    <div class="fieldset hidden" id="browserBox">
      <legend>🧭 浏览器仿真选项</legend>
      <div class="grid2">
        <div class="frow"><label>导航等待策略</label><select id="fWaitUntil"><option value="domcontentloaded">domcontentloaded（DOM 就绪）</option><option value="load">load（资源加载完）</option><option value="commit">commit（响应头返回）</option><option value="networkidle">networkidle（网络空闲）</option></select></div>
        <div class="frow"><label>额外停留（毫秒，0-30000，随机化模拟阅读）</label><input id="fDwell" type="number" value="0" min="0" max="30000"></div>
      </div>
      <div class="frow"><label>等待元素出现（可选，CSS 选择器）</label><input id="fWaitSelector" placeholder="#app / .content"></div>
      <div class="frow"><label>成功断言（可选；CSS 选择器 / text:包含文本 / js:表达式）</label><input id="fAssert" placeholder="text:欢迎 或 #dashboard 或 js:document.title.includes('OK')"></div>
      <div class="grid2">
        <div class="frow"><label>任务级代理（可选）</label><input id="fProxy" placeholder="socks5://127.0.0.1:1080"></div>
        <div class="frow"><label>固定 User-Agent（留空则按任务自动分配）</label><input id="fUa" placeholder="留空即可"></div>
      </div>
      <div class="frow"><label class="checkline"><input type="checkbox" id="fScreenshot"> 失败或遇到挑战页时保存截图</label></div>
      <div class="muted">每个任务独立保存 Cookie / localStorage（storageState），跨次访问表现为回头客；共享一个常驻 Chromium，并发上限由服务端控制。</div>
    </div>
    <div class="fieldset hidden" id="sshBox">
      <legend>🖥️ SSH 连接参数</legend>
      <div class="grid2">
        <div class="frow"><label>主机 *</label><input id="fSshHost" placeholder="ssh.example.com" oninput="refreshSshPreview()"></div>
        <div class="frow"><label>端口</label><input id="fSshPort" type="number" value="22" min="1" max="65535" oninput="refreshSshPreview()"></div>
      </div>
      <div class="grid2">
        <div class="frow"><label>用户名 *</label><input id="fSshUser" placeholder="root" oninput="refreshSshPreview()"></div>
        <div class="frow"><label>认证方式 *</label>
          <select id="fSshAuth" onchange="onSshAuthChange()">
            <option value="password">密码</option>
            <option value="key">私钥</option>
          </select>
        </div>
      </div>
      <div class="frow" id="sshPwdRow"><label>密码（随配置进 Gist）</label><input id="fSshPassword" type="password" placeholder="SSH 登录密码"></div>
      <div class="frow hidden" id="sshKeyRow"><label>密钥 *</label>
        <div style="display:flex;gap:8px">
          <select id="fSshKey"><option value="">（尚无密钥）</option></select>
          <button type="button" class="mini" onclick="openKeys()" style="white-space:nowrap">管理密钥…</button>
        </div>
      </div>
      <div class="frow"><label>远程命令 *</label><input id="fSshCommand" placeholder="true" oninput="refreshSshPreview()"></div>
      <div class="frow"><label>预期命令（实时反显，可粘贴 ssh 命令自动回填）</label>
        <textarea id="fSshPreview" style="font-family:monospace;min-height:48px" oninput="onSshPreviewInput()" placeholder="ssh -p 2222 user@host true"></textarea>
      </div>
      <div class="muted">固定附加 BatchMode / StrictHostKeyChecking=no，超时为连接+命令总超时；私钥经 Gist 同步，导出备份不含。</div>
    </div>
    <div class="frow"><label>随机加时（分钟，0-1440，0=关闭）</label><input id="fJitter" type="number" value="0" min="0" max="1440"><div class="muted">每次触发前在 0~N 分钟内取随机数累加到固定触发时间，固定间隔与 Cron 均生效，每次触发重新随机</div></div>
    <div class="grid2">
      <div class="frow"><label>调度方式</label>
        <select id="fStype" onchange="document.getElementById('intervalBox').classList.toggle('hidden',this.value!=='interval');document.getElementById('cronBox').classList.toggle('hidden',this.value!=='cron')">
          <option value="interval">固定间隔（每 N 分钟）</option><option value="cron">Cron 表达式（分 时 日 月 周）</option>
        </select>
      </div>
      <div class="frow" id="intervalBox"><label>间隔（分钟，≥1）</label><input id="fInterval" type="number" value="5" min="1"></div>
      <div class="frow hidden" id="cronBox"><label>Cron 表达式（5 段式，按设置时区判定）</label><input id="fCron" placeholder="*/5 * * * *"></div>
    </div>
    <div class="frow" id="headersRow"><label>请求头（每行 Key: Value，或 JSON 对象，可覆盖默认浏览器头）</label><textarea id="fHeaders" placeholder="Authorization: Bearer xxx"></textarea></div>
    <div class="frow" id="bodyRow"><label>请求体 Body（非 GET 时生效，可选）</label><textarea id="fBody" placeholder="{&quot;keepalive&quot;: true}"></textarea></div>
    <div class="err" id="editErr"></div>
    <div class="mfoot"><button onclick="tryCloseEdit()">取消</button><button class="primary" id="btnSave">保存</button></div>
  </div>
</div>

<div class="overlay" id="logOverlay" data-dismiss="outside">
  <div class="modal" style="max-width:860px">
    <h3 id="logTitle">执行日志</h3>
    <div id="logBody"></div>
    <div class="mfoot"><button onclick="document.getElementById('logOverlay').classList.remove('show')">关闭</button></div>
  </div>
</div>

<div class="overlay" id="gistOverlay" data-dismiss="outside">
  <div class="modal" style="max-width:500px">
    <h3>☁️ Gist 同步</h3>
    <div class="muted" style="margin-bottom:12px">把任务配置备份到 GitHub 私密 Gist，在多个部署之间同步。</div>
    <div class="frow"><label>GitHub Token（ghp_ xxx）</label><input id="gToken" placeholder="ghp_xxxxxxxx"></div>
    <div class="frow"><label>Gist ID（留空即可，首次上传自动创建并回填）</label><input id="gGistId" placeholder="留空则上传时自动创建新 Gist"></div>
    <div class="frow" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <label class="checkline" style="display:flex;align-items:center;font-size:13px;font-weight:400;color:var(--txt);margin:0"><input type="checkbox" id="gAuto"> 自动同步</label>
      <span class="muted">每</span>
      <input id="gInterval" type="number" value="5" min="1" max="1440" style="width:76px">
      <span class="muted">分钟检查一次（1-1440）</span>
    </div>
    <div class="muted" id="gStatus" style="margin:2px 0 0"></div>
    <div class="err" id="gistErr"></div>
    <div class="mfoot"><button onclick="document.getElementById('gistOverlay').classList.remove('show')">取消</button><button id="btnGistSave">保存配置</button><button id="btnGistPull">⬇ 从 Gist 下载</button><button id="btnGistPush" class="primary">⬆ 上传到 Gist</button></div>
  </div>
</div>

<div class="overlay" id="keysOverlay" data-dismiss="outside">
  <div class="modal">
    <h3>🔑 SSH 密钥管理</h3>
    <div class="muted" style="margin-bottom:12px">私钥随 Gist 同步（明文，需 Token 才能读取；导出备份不含），任务按名称引用。</div>
    <div id="keysList" style="margin-bottom:14px"></div>
    <div class="fieldset">
      <legend>添加密钥</legend>
      <div class="frow"><label>名称 *</label><input id="kName" placeholder="例：my-server"></div>
      <div class="frow"><label>私钥 *（粘贴 PEM 内容）</label><textarea id="kPriv" style="font-family:monospace;min-height:110px" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"></textarea></div>
      <div class="frow"><label>口令（无则留空）</label><input id="kPass" type="password"></div>
      <div class="err" id="keysErr"></div>
      <div style="text-align:right"><button class="primary mini" onclick="addKey()">保存密钥</button></div>
    </div>
    <div class="mfoot"><button onclick="document.getElementById('keysOverlay').classList.remove('show')">关闭</button></div>
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
let TASKS = [], TZ = 'Asia/Shanghai', editingId = null;
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function fmt(ts){
  if(!ts) return '';
  try{ return new Intl.DateTimeFormat('zh-CN',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(ts)).replace(/\//g,'-'); }
  catch(e){ return new Date(ts).toISOString(); }
}
function hdr(){ var h={'Content-Type':'application/json'}, p=localStorage.getItem('cw_pwd'); if(p) h['X-Auth']=p; return h; }
function toast(msg){ var t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(function(){t.classList.remove('show');},2600); }
async function api(path, opts){
  opts = opts || {};
  // 无 body 的请求不要声明 application/json：Fastify 会对「声明 JSON 却空 body」
  // 抛 FST_ERR_CTP_EMPTY_JSON_BODY，导致立即执行 / 启停 / 删除按钮 400。
  var h = hdr();
  if(!opts.body) delete h['Content-Type'];
  opts.headers = Object.assign({}, h, opts.headers || {});
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
function onModeChange(){
  var m=$('fMode').value, b=m==='browser', s=m==='ssh';
  $('browserBox').classList.toggle('hidden',!b);
  $('sshBox').classList.toggle('hidden',!s);
  $('fallbackBox').classList.toggle('hidden',b||s);
  // SSH 任务没有 URL / 请求头 / 请求体，隐藏对应行
  $('urlRow').classList.toggle('hidden',s);
  $('headersRow').classList.toggle('hidden',s);
  $('bodyRow').classList.toggle('hidden',s);
  // 浏览器模式 page.goto 固定 GET 且不能携带 body；SSH 模式下 method 无意义 -> 置为只读。
  // <select> 没有 readonly 属性，只能用 disabled；disabled 元素的 .value 仍可读，save() 不受影响。
  $('fMethod').disabled=b||s;
  $('fBody').readOnly=b;
  $('browserOnlyHint').classList.toggle('hidden',!b);
  if(s){ onSshAuthChange(); refreshSshPreview(); }
}
function onSshAuthChange(){
  var key=$('fSshAuth').value==='key';
  $('sshPwdRow').classList.toggle('hidden',key);
  $('sshKeyRow').classList.toggle('hidden',!key);
}
// ---- SSH 双向命令区：参数 -> 预览实时反显；粘贴命令 -> 解析回填参数 ----
var sshSyncing=false;
function buildSshCmd(){
  var host=$('fSshHost').value.trim()||'<host>';
  var port=$('fSshPort').value.trim()||'22';
  var user=$('fSshUser').value.trim()||'<user>';
  var cmd=$('fSshCommand').value;
  var t=$('fTimeout').value||'30';
  return 'ssh -p '+port+' -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout='+t+' '+user+'@'+host+(cmd?' '+cmd:'');
}
function refreshSshPreview(){
  if(sshSyncing) return;
  sshSyncing=true;
  $('fSshPreview').value=buildSshCmd();
  sshSyncing=false;
}
// 解析粘贴的 ssh 命令：-p 端口 / -l 用户 / user@host / 其余原文作命令（保留引号空格）；
// ConnectTimeout 映射到超时秒；BatchMode/StrictHostKeyChecking 及未知选项（含 -i）静默忽略。
function parseSshCmd(text){
  var s=String(text||'').trim().replace(/^\s*ssh\s+/,'');
  if(!s) return null;
  var port=null, user='', host=null, ct=null, m, rest=s;
  while(true){
    if((m=rest.match(/^-p\s*(\d+)\s*/))){ port=m[1]; rest=rest.slice(m[0].length); continue; }
    if((m=rest.match(/^-l\s+(\S+)\s*/))){ user=m[1]; rest=rest.slice(m[0].length); continue; }
    if((m=rest.match(/^-i\s+(\S+)\s*/))){ rest=rest.slice(m[0].length); continue; }
    if((m=rest.match(/^-o\s+ConnectTimeout=(\d+)\s*/i))){ ct=m[1]; rest=rest.slice(m[0].length); continue; }
    if((m=rest.match(/^-o\s+(\S+)\s*/))){ rest=rest.slice(m[0].length); continue; }
    if((m=rest.match(/^-\S+\s*/))){ rest=rest.slice(m[0].length); continue; }
    break;
  }
  var tm=rest.match(/^(\S*)@(\S+?)\s+([\s\S]+)$/);
  if(tm){ user=tm[1]||user; host=tm[2]; rest=tm[3]; }
  else{
    var hm=rest.match(/^(\S+?)\s+([\s\S]+)$/);
    if(hm){ host=hm[1]; rest=hm[2]; }
    else{ host=rest; rest=''; }
  }
  if(!host||/^-/.test(host)) return null;
  return { host:host, port:port, user:user, cmd:rest, timeout:ct };
}
function onSshPreviewInput(){
  if(sshSyncing) return;
  var p=parseSshCmd($('fSshPreview').value);
  if(!p) return; // 解析不出主机就不动参数，避免清空用户输入
  sshSyncing=true;
  if(p.host){ $('fSshHost').value=p.host; }
  if(p.port){ $('fSshPort').value=p.port; }
  if(p.user){ $('fSshUser').value=p.user; }
  $('fSshCommand').value=p.cmd;
  if(p.timeout){ $('fTimeout').value=p.timeout; }
  sshSyncing=false;
  refreshSshPreview();
}
function fillSshKeySelect(selected){
  var sel=$('fSshKey');
  api('/api/sshkeys').then(function(d){
    var keys=d.keys||[];
    var opts=keys.length?'<option value="">（请选择密钥）</option>':'<option value="">（尚无密钥）</option>';
    keys.forEach(function(k){ opts+='<option value="'+esc(k.name)+'">'+esc(k.name)+'</option>'; });
    sel.innerHTML=opts;
    sel.value=selected||'';
  }).catch(function(){ sel.innerHTML='<option value="">（密钥列表加载失败）</option>'; });
}
function schedText(t){ return t.schedule_type==='cron' ? 'cron: '+t.cron_expr : '每 '+t.interval_minutes+' 分钟'; }
function modeBadge(t){
  if(t.mode==='browser') return '<span class="badge browser" title="真实 Chromium 仿真">🧭 浏览器</span>';
  if(t.mode==='ssh') return '<span class="badge ssh" title="SSH 命令执行">🖥️ SSH</span>';
  return '<span class="badge http" title="纯 HTTP 请求">🌐 HTTP</span>'+(t.http_fallback_browser?'<div class="muted">可自动升级</div>':'');
}
function lastBadge(t){
  if(t.last_run_at == null) return '<span class="badge idle">未运行</span>';
  if(t.last_ok===1) return '<span class="badge ok">✓ '+(t.last_status_code==null?'-':t.last_status_code)+' · '+t.last_duration_ms+'ms</span>';
  return '<span class="badge fail" title="'+esc(t.last_error||'')+'">✗ '+(t.last_status_code==null?'-':t.last_status_code)+' · '+esc(t.last_error||'失败')+'</span>';
}
function render(d){
  TASKS = d.tasks; TZ = d.timezone || 'Asia/Shanghai';
  if(d.auth_required) $('btnLogout').classList.remove('hidden');
  var bs=$('bStatus');
  if(d.browser_available){
    bs.className='bstatus yes'; bs.textContent='🧭 浏览器仿真：可用'+(d.browser_running?'（运行中）':'（空闲）');
    $('degradeBox').classList.add('hidden');
  }else{
    bs.className='bstatus no'; bs.textContent='🌐 浏览器仿真：不可用（已降级）';
    var box=$('degradeBox');
    box.innerHTML='⚠️ 当前环境不具备浏览器仿真能力，浏览器模式的任务会自动降级为 HTTP 请求。<br>原因：'+esc(d.browser_reason||'未探测')+'。部署带 Chromium 的 Docker 镜像即可启用完整功能。';
    box.classList.remove('hidden');
  }
  var s=d.stats;
  $('stTasks').textContent=s.tasks; $('stEnabled').textContent=s.enabled;
  $('stRate').textContent=(s.rate24==null?'—':s.rate24+'%'); $('stRuns').textContent=s.runs24;
  $('taskBody').innerHTML = d.tasks.map(function(t){
    return '<tr draggable="true" data-id="'+t.id+'">'+
      '<td>'+(t.enabled?'<span class="badge on">● 运行中</span>':'<span class="badge off">⏸ 已暂停</span>')+'</td>'+
      '<td><span class="tname">'+esc(t.name)+'</span><span class="turl" title="'+esc(t.mode==='ssh'?('SSH '+t.ssh_user+'@'+t.ssh_host+':'+t.ssh_port+' → '+t.ssh_command):t.url)+'">'+(t.mode==='ssh'?esc('SSH '+t.ssh_user+'@'+t.ssh_host+':'+t.ssh_port+' → '+t.ssh_command):esc(t.method+' '+t.url))+'</span></td>'+
      '<td>'+modeBadge(t)+'</td>'+
      '<td>'+esc(schedText(t))+(t.retries>0?'<div class="muted">失败重试 '+t.retries+' 次</div>':'')+(t.jitter_minutes>0?'<div class="muted">+ 随机 0~'+t.jitter_minutes+' 分钟</div>':'')+'</td>'+
      '<td>'+lastBadge(t)+'<div class="muted">'+esc(fmt(t.last_run_at))+'</div>'+(t.last_challenge?'<span class="badge challenge">挑战页</span>':'')+'</td>'+
      '<td class="muted">'+(t.enabled?esc(fmt(t.next_run_at)||'等待调度'):'—')+'</td>'+
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
  if(dragBusy) return;  // 拖拽进行中跳过自动刷新，避免 15s 定时 render 打断拖拽
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
  $('fJitter').value=t.jitter_minutes==null?0:t.jitter_minutes;
  $('fCron').value=t.cron_expr||''; $('fHeaders').value=t.headers||''; $('fBody').value=t.body||'';
  $('fMode').value=t.mode||'http';
  $('fSshHost').value=t.ssh_host||'';
  $('fSshPort').value=t.ssh_port==null?22:t.ssh_port;
  $('fSshUser').value=t.ssh_user||'';
  $('fSshCommand').value=t.ssh_command||'';
  $('fSshAuth').value=t.ssh_auth||'password';
  $('fSshPassword').value=t.ssh_password||'';
  fillSshKeySelect(t.ssh_key_name||'');
  $('fWaitUntil').value=t.browser_wait_until||'domcontentloaded';
  $('fWaitSelector').value=t.browser_wait_selector||'';
  $('fAssert').value=t.browser_assert||'';
  $('fDwell').value=t.browser_dwell_ms==null?0:t.browser_dwell_ms;
  $('fProxy').value=t.browser_proxy||''; $('fUa').value=t.browser_ua||'';
  $('fScreenshot').checked=!!t.browser_screenshot;
  $('fFallback').checked=!!t.http_fallback_browser;
  $('fStype').dispatchEvent(new Event('change'));
  onModeChange();
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
function save(){
  var payload={ name:$('fName').value, url:$('fUrl').value, method:$('fMethod').value,
    timeout_seconds:+$('fTimeout').value, retries:+$('fRetries').value,
    schedule_type:$('fStype').value, interval_minutes:+$('fInterval').value,
    jitter_minutes:+$('fJitter').value||0,
    cron_expr:$('fCron').value, headers:$('fHeaders').value, body:$('fBody').value,
    mode:$('fMode').value,
    ssh_host:$('fSshHost').value, ssh_port:+$('fSshPort').value||22,
    ssh_user:$('fSshUser').value, ssh_command:$('fSshCommand').value,
    ssh_auth:$('fSshAuth').value, ssh_password:$('fSshPassword').value,
    ssh_key_name:$('fSshKey').value,
    browser_wait_until:$('fWaitUntil').value,
    browser_wait_selector:$('fWaitSelector').value, browser_assert:$('fAssert').value,
    browser_dwell_ms:+$('fDwell').value, browser_proxy:$('fProxy').value,
    browser_ua:$('fUa').value, browser_screenshot:$('fScreenshot').checked?1:0,
    http_fallback_browser:$('fFallback').checked?1:0 };
  api(editingId?'/api/tasks/'+editingId:'/api/tasks',{method:editingId?'PUT':'POST',body:JSON.stringify(payload)})
    .then(function(){ closeEdit(); toast('已保存'); load(); })
    .catch(function(e){ $('editErr').textContent=e.message; });
}
async function runNow(id){
  toast('正在执行…');
  try{
    var r=await api('/api/tasks/'+id+'/run',{method:'POST'});
    if(r.result.ok) toast('✓ 成功 · '+r.result.mode+' · '+(r.result.mode==='ssh'?'exit ':'HTTP ')+r.result.status_code+' · '+r.result.duration_ms+'ms');
    else toast('✗ 失败 · '+(r.result.error||(r.result.mode==='ssh'?('exit '+r.result.status_code):('HTTP '+r.result.status_code))));
    load();
  }catch(e){ toast('执行失败: '+e.message); }
}
async function toggleTask(id){ try{ await api('/api/tasks/'+id+'/toggle',{method:'POST'}); load(); }catch(e){ toast(e.message); } }
async function delTask(id){
  var t=taskById(id);
  if(!confirm('确定删除任务「'+t.name+'」？其执行历史也将删除。')) return;
  try{ await api('/api/tasks/'+id,{method:'DELETE'}); toast('已删除'); load(); }catch(e){ toast(e.message); }
}
function shotBtn(name){ return '<button class="mini" onclick="viewShot(\''+esc(name)+'\')">查看截图</button>'; }
async function viewShot(name){
  try{
    var r=await fetch('/api/screenshot?name='+encodeURIComponent(name),{headers:hdr()});
    if(!r.ok) throw new Error('HTTP '+r.status);
    var url=URL.createObjectURL(await r.blob()); window.open(url,'_blank');
    setTimeout(function(){URL.revokeObjectURL(url);},60000);
  }catch(e){ toast('截图读取失败: '+e.message); }
}
async function showLog(id){
  var t=taskById(id);
  $('logTitle').textContent='📜 执行日志 — '+t.name;
  $('logBody').innerHTML='<div class="muted">加载中…</div>';
  $('logOverlay').classList.add('show');
  try{
    var r=await api('/api/tasks/'+id+'/history?limit=50');
    $('logBody').innerHTML = r.history.length===0 ? '<div class="empty">暂无执行记录</div>' :
      '<table><thead><tr><th>时间</th><th>结果</th><th>方式</th><th>状态/耗时</th><th>详情</th></tr></thead><tbody>'+
      r.history.map(function(h){
        var detail='<div class="muted">'+esc(h.note||'')+'</div>';
        if(h.final_url) detail+='<div class="muted">最终 URL: '+esc(h.final_url)+'</div>';
        if(h.page_title) detail+='<div class="muted">标题: '+esc(h.page_title)+'</div>';
        if(h.error) detail+='<div class="muted" style="color:var(--red)">'+esc(h.error)+'</div>';
        if(h.challenge) detail+='<span class="badge challenge">挑战页</span> ';
        if(h.degraded) detail+='<span class="badge off">已降级</span> ';
        if(h.screenshot) detail+=shotBtn(h.screenshot);
        if(h.snippet) detail+='<div class="snippet">'+esc(h.snippet)+'</div>';
        return '<tr><td class="muted" style="white-space:nowrap">'+esc(fmt(h.run_at))+'</td>'+
          '<td>'+(h.ok?'<span class="histok">成功</span>':'<span class="histfail">失败</span>')+'</td>'+
          '<td>'+(h.mode==='browser'?'<span class="badge browser">🧭 浏览器</span>':h.mode==='ssh'?'<span class="badge ssh">🖥️ SSH</span>':'<span class="badge http">🌐 HTTP</span>')+'</td>'+
          '<td class="muted">'+(h.status_code==null?'-':h.status_code)+'<br>'+h.duration_ms+'ms</td>'+
          '<td>'+detail+'</td></tr>';
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
// ---- SSH 密钥管理：只回名称与元信息，私钥内容永不出服务端 ----
async function openKeys(){
  $('keysErr').textContent='';
  $('keysOverlay').classList.add('show');
  loadKeys();
}
async function loadKeys(){
  try{
    var d=await api('/api/sshkeys');
    var keys=d.keys||[];
    var el=$('keysList');
    if(!keys.length){ el.innerHTML='<div class="muted">还没有密钥，在下方添加。</div>'; return; }
    el.innerHTML=keys.map(function(k){
      return '<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:6px">'+
        '<div><b>'+esc(k.name)+'</b><span class="muted">'+(k.has_passphrase?' · 有口令':'')+'</span></div>'+
        '<button class="icon danger" title="删除" onclick="delKey('+k.id+')">'+svgIcon('del')+'</button></div>';
    }).join('');
  }catch(e){ $('keysErr').textContent=e.message; }
}
async function addKey(){
  $('keysErr').textContent='';
  try{
    await api('/api/sshkeys',{method:'POST',body:JSON.stringify({
      name:$('kName').value, private_key:$('kPriv').value, passphrase:$('kPass').value })});
    $('kName').value=''; $('kPriv').value=''; $('kPass').value='';
    toast('密钥已保存');
    loadKeys(); fillSshKeySelect($('fSshKey').value);
  }catch(e){ $('keysErr').textContent=e.message; }
}
async function delKey(id){
  if(!confirm('确定删除这把密钥吗？引用它的任务将失败。')) return;
  try{
    await api('/api/sshkeys/'+id,{method:'DELETE'});
    toast('已删除');
    loadKeys(); fillSshKeySelect($('fSshKey').value);
  }catch(e){ $('keysErr').textContent=e.message; }
}
// ---- Gist 同步：先保存弹窗里的配置再执行上传/下载，改完 Token 直接点即可 ----
function closeGist(){ document.getElementById('gistOverlay').classList.remove('show'); }
function openGist(){
  $('gistErr').textContent='';
  $('gistOverlay').classList.add('show');
  api('/api/gist').then(function(g){
    $('gToken').value=g.token||''; $('gGistId').value=g.gist_id||'';
    $('gAuto').checked=!!g.auto; $('gInterval').value=g.interval_min==null?5:g.interval_min;
    $('gStatus').textContent=g.last_result?('上次同步：'+(g.synced_at?fmt(g.synced_at):'')+' · '+g.last_result):'';
  }).catch(function(e){ $('gistErr').textContent=e.message; });
}
async function gistSaveCfg(){
  await api('/api/gist',{method:'PUT',body:JSON.stringify({
    token:$('gToken').value,gist_id:$('gGistId').value,
    auto:$('gAuto').checked?1:0,interval_min:+$('gInterval').value||5})});
}
async function gistPush(){
  try{
    $('gistErr').textContent='';
    await gistSaveCfg();
    var r=await api('/api/gist/push',{method:'POST'});
    $('gGistId').value=r.gist_id||$('gGistId').value;
    toast(r.created?'已创建私密 Gist 并上传':'已上传到 Gist');
  }catch(e){ $('gistErr').textContent=e.message; }
}
async function gistPull(){
  if(!confirm('从 Gist 下载将覆盖当前全部任务（执行历史保留），确定？')) return;
  try{
    $('gistErr').textContent='';
    await gistSaveCfg();
    var r=await api('/api/gist/pull',{method:'POST'});
    closeGist();
    toast('已从 Gist 恢复：成功 '+r.imported+' 个，跳过 '+r.skipped+' 个');
    load();
  }catch(e){ $('gistErr').textContent=e.message; }
}
$('btnGist').onclick=openGist;
$('btnGistSave').onclick=async function(){ try{ await gistSaveCfg(); toast('Gist 配置已保存'); }catch(e){ $('gistErr').textContent=e.message; } };
$('btnGistPush').onclick=gistPush;
$('btnGistPull').onclick=gistPull;
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
