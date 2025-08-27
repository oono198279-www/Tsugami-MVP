// CNC line-by-line translator (Tsugami MVP) — semicolon-aware

const baseDict = {
  // G codes (common)
  "G0":"早送り移動",
  "G00":"早送り移動",
  "G1":"直線補間",
  "G01":"直線補間",
  "G2":"円弧補間CW",
  "G02":"円弧補間CW",
  "G3":"円弧補間CCW",
  "G03":"円弧補間CCW",
  "G4":"ドウェル(一時停止)",
  "G04":"ドウェル(一時停止)",
  "G28":"原点復帰",
  "G50":"上限回転数設定/スケーリング解除(機種依存)",
  "G92":"座標/ねじ切り関係(機種依存)",
  "G94":"送り単位 毎分",
  "G95":"送り単位 毎回転",
  "G96":"定切削速度(CSS)",
  "G97":"回転数指定",
  "G98":"固定サイクル 復帰:初期位置",
  "G99":"固定サイクル 復帰:R点",
  // M codes (generic/common)
  "M0":"プログラム一時停止",
  "M00":"プログラム一時停止",
  "M1":"条件付停止",
  "M01":"条件付停止",
  "M2":"プログラム終了",
  "M02":"プログラム終了",
  "M3":"主軸 正転",
  "M03":"主軸 正転",
  "M4":"主軸 逆転",
  "M04":"主軸 逆転",
  "M5":"主軸 停止",
  "M05":"主軸 停止",
  "M8":"クーラント ON",
  "M08":"クーラント ON",
  "M9":"クーラント OFF",
  "M09":"クーラント OFF",
  // Common but often machine-dependent
  "M10":"チャック クランプ（機種依存）",
  "M11":"チャック アンクランプ（機種依存）",
  "M60":"バーフィーダ制御（機種依存）",
  "M61":"バーフィーダ制御（機種依存）",
  "M62":"バーフィーダ制御（機種依存）",
};

// Model-specific overrides or additions (extendable)
const modelDicts = {
  "B012-Ⅱ": {},
  "B012-Ⅲ": {},
  "B012-F": {},
  "B018-Ⅲ": {},
  "B0125": {},
  "B0125-Ⅱ": {},
  "B0125-Ⅲ": {},
  "BE12": {},
  "BE20-V": {},
  "BS12-Ⅲ": {},
  "BS18-Ⅲ": {}
};

// Simple tokenizer with support for trailing semicolons and glued tokens like G28U0W0
function tokenize(line){
  // Remove inline parentheses comments
  const commentStripped = line.replace(/\(.*?\)/g, '').trim();
  // strip trailing semicolons so both '...;' and '...' work
  const cleaned = commentStripped.replace(/;+$/, '');

  // Split by spaces; also break chained codes like "G0X10Z2" -> "G0","X10","Z2"
  const parts = [];
  let buf = "";
  for (let i=0;i<cleaned.length;i++){
    const ch = cleaned[i];
    if (ch === ' ') {
      if (buf) { parts.push(buf); buf=""; }
    } else {
      buf += ch;
    }
  }
  if (buf) parts.push(buf);

  // Further split glued tokens, e.g., "G0X38.0" -> ["G0","X38.0"]
  const out = [];
  for (const p of parts){
    // Attempt to split at boundaries where a letter is followed by a number, repeatedly
    let cur = "";
    for (let i=0;i<p.length;i++){
      const ch = p[i];
      const prev = cur[cur.length-1];
      const isLetter = /[A-Za-z]/.test(ch);
      const prevIsLetter = /[A-Za-z]/.test(prev||'');
      if (isLetter && cur && !prevIsLetter){
        out.push(cur); cur = ch;
      } else {
        cur += ch;
      }
    }
    if (cur) out.push(cur);
  }
  return out.filter(t => t.length);
}

function translateLine(line, model){
  const tokens = tokenize(line);
  if (tokens.length === 0) return ["", ""];
  const dict = {...baseDict, ...(modelDicts[model]||{})};

  const primary = [];
  const params = [];
  let unknowns = [];

  for (const tk of tokens){
    const u = tk.toUpperCase();
    if (/^G\d+$/i.test(u) || /^M\d+$/i.test(u)){
      primary.push(dict[u] || `未登録:${u}`);
      if (!dict[u]) unknowns.push(u);
    } else if (/^[XYZUWIJKRSPFQ][\-+]?[\d\.]+$/i.test(u)){
      params.push(u.toUpperCase());
    } else if (/^N[\dA-Za-z]+$/i.test(u)){
      primary.push(`ラベル ${u.toUpperCase()}`);
    } else if (/^IF$/i.test(u)){
      primary.push("条件分岐 IF");
    } else if (/^GOTO[\dA-Za-z]+$/i.test(u)){
      primary.push(`GOTO ${u.slice(4).toUpperCase()}`);
    } else if (/^\#\d+$/i.test(u)){
      params.push(u);
    } else if (/^(EQ|NE|GT|LT|GE|LE|\[|\]|AND|OR)$/.test(u)){
      params.push(u);
    } else {
      const gto = u.match(/^GOTO(\S+)/);
      if (gto){
        primary.push(`GOTO ${gto[1]}`);
      } else {
        unknowns.push(u);
        params.push(u);
      }
    }
  }

  let name = primary.join(" ／ ");
  if (params.length){
    const order = "XYZUWIJKRSPFQ";
    const sorted = params.slice().sort((a,b)=>{
      const ka = order.indexOf(a[0]); const kb = order.indexOf(b[0]);
      if (ka!==-1 && kb!==-1) return ka-kb;
      if (ka!==-1) return -1;
      if (kb!==-1) return 1;
      return a.localeCompare(b);
    });
    name += (name ? " " : "") + sorted.join(" ");
  }
  const hasUnknown = unknowns.length>0;
  return [name, hasUnknown];
}

function render(){
  const src = document.getElementById('src').value.replace(/\r\n/g,"\n");
  const model = document.getElementById('model').value;
  const out = document.getElementById('out');
  out.innerHTML = '';
  const lines = src.split('\n');
  lines.forEach((line, idx)=>{
    const [name, hasUnknown] = translateLine(line, model);
    const row = document.createElement('div'); row.className='row';
    const c1 = document.createElement('div'); c1.className='cell code'; c1.textContent = line;
    const c2 = document.createElement('div'); c2.className='cell tr'; c2.textContent = name;
    if (hasUnknown) c2.classList.add('unknown');
    row.appendChild(c1); row.appendChild(c2);
    out.appendChild(row);
  });
}

document.getElementById('btnTranslate').addEventListener('click', render);
document.getElementById('btnClear').addEventListener('click', ()=>{
  document.getElementById('src').value='';
  document.getElementById('out').innerHTML='';
});

// PWA install prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('btnInstall');
  btn.style.display = 'inline-block';
  btn.addEventListener('click', async ()=>{
    btn.style.display='none';
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    }
  });
});

// Dict import/export
document.getElementById('btnExportDict').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify({baseDict, modelDicts}, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tsugami_dict.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
});

document.querySelector('label input#importDict').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const obj = JSON.parse(text);
    if (obj.baseDict) Object.assign(baseDict, obj.baseDict);
    if (obj.modelDicts) {
      for (const k of Object.keys(obj.modelDicts)){
        modelDicts[k] = {...(modelDicts[k]||{}), ...obj.modelDicts[k]};
      }
    }
    alert('辞書を読み込みました');
  } catch(err){
    alert('JSON読み込みエラー: '+err.message);
  }
});

// initial render
render();
