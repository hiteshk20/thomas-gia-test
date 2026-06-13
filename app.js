/* ============================================================
   Cognitra PRO · Elite GIA-style assessment engine
   Pure vanilla JS, zero deps, ships as a static PWA.
   ----------------------------------------------------------------
   Features
   - 5 timed tasks, 8 practice items each, real GIA flow
   - Per-item response-time analytics
   - Composite score + percentile + radar chart
   - PDF (print-quality) report, JSON & CSV export
   - Tab-switch / focus loss integrity logging
   - Fullscreen focus mode
   - Auto-save & resume mid-test (localStorage)
   - Past-attempts admin dashboard
   - Dark mode toggle (persisted)
   - Keyboard shortcuts (1-5)
   - PWA manifest + service worker
============================================================ */
(() => {
'use strict';

/* ---------- micro-helpers ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const rand  = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const pick  = arr => arr[rand(0, arr.length-1)];
const shuffle = a => { a=[...a]; for(let i=a.length-1;i>0;i--){const j=rand(0,i);[a[i],a[j]]=[a[j],a[i]];} return a; };
const fmt   = (n,d=0) => Number(n).toFixed(d);
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const LS_RESUME   = 'cognitra.resume.v1';
const LS_ATTEMPTS = 'cognitra.attempts.v1';
const LS_THEME    = 'cognitra.theme.v1';

/* ---------- screen routing ---------- */
function show(id){
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#'+id).classList.add('active');
  window.scrollTo({top:0,behavior:'instant'});
  if(id === 'screen-admin') renderAdmin();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-action="goto"]');
  if(b) show(b.dataset.target);
});

/* ---------- theme ---------- */
(function initTheme(){
  const saved = localStorage.getItem(LS_THEME);
  const prefers = matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefers ? 'dark' : 'light');
  document.body.dataset.theme = theme;
  $('#themeToggle').textContent = theme === 'dark' ? '☀' : '☾';
})();
$('#themeToggle').addEventListener('click', () => {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = next;
  localStorage.setItem(LS_THEME, next);
  $('#themeToggle').textContent = next === 'dark' ? '☀' : '☾';
});

/* ============================================================
   TASK DEFINITIONS
============================================================ */
const TASKS = [
  {
    key:'perceptual', name:'Perceptual Speed', seconds: 3*60, eyebrow:'Task 1 of 5',
    desc:'You will see four vertical pairs of letters. Decide how many of the pairs contain the same letter. Capital and small letters of the same letter (e.g. F and f) count as the same.',
    example:`<b>Example:</b> E/e · Q/y · D/d · K/k → 3 matching pairs.<div class="mini"><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span></div>`,
    gen: genPerceptual, render: renderPerceptual
  },
  {
    key:'reasoning', name:'Reasoning', seconds: 4*60, eyebrow:'Task 2 of 5',
    desc:'Read a short statement comparing two people. When ready, click to continue, then choose the correct answer to the question.',
    example:`<b>Example:</b> "Bob is not as happy as Paul." → Who is happier? <b>Paul</b>.`,
    gen: genReasoning, render: renderReasoning
  },
  {
    key:'memory', name:'Working Memory · Word Meaning', seconds: 4*60, eyebrow:'Task 3 of 5',
    desc:'You will be given three words. Two of the three will be related in some way and the third is the odd one out. Click the odd word.',
    example:`<b>Example:</b> hot · cold · warm → odd = <b>cold</b>.`,
    gen: genWord, render: renderWord
  },
  {
    key:'number', name:'Number Speed & Accuracy', seconds: 4*60, eyebrow:'Task 4 of 5',
    desc:'You see three numbers. Find the highest and the lowest, then decide which of those two is numerically further from the remaining number. Click that number.',
    example:`<b>Example:</b> 2 · 4 · 8 → 8 is 4 away from 4; 2 is 2 away from 4. Answer: <b>8</b>.`,
    gen: genNumber, render: renderNumber
  },
  {
    key:'spatial', name:'Spatial Visualisation', seconds: 5*60, eyebrow:'Task 5 of 5',
    desc:'Count how many pairs of shapes (top vs bottom) can be rotated to match exactly. Mirror images do NOT count as a match.',
    example:`<b>Example:</b> 4 pairs shown — count rotational matches and click the number (0–4).`,
    gen: genSpatial, render: renderSpatial
  }
];

/* ============================================================
   STATE
============================================================ */
let candidate = null;      // {name,email,role,startedAt}
let series    = null;      // {idx, results:[...], integrity:[...] }
let task      = null;
let item      = null;
let timerId   = null;
let endsAt    = 0;
let answered  = 0, correct = 0;
let mode      = 'practice';
let practiceIndex = 0;
let itemStart = 0;         // ms timestamp when current item shown
let _locked   = false;
let resumeData = null;
const PRACTICE_COUNT = 8;

/* ============================================================
   INTAKE / RESUME
============================================================ */
const intakeForm = $('#intakeForm');
intakeForm.addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(intakeForm);
  candidate = {
    name:  fd.get('name').trim(),
    email: fd.get('email').trim(),
    role:  fd.get('role').trim() || '—',
    startedAt: new Date().toISOString()
  };
  show('screen-guidelines');
});

function checkResume(){
  try{ resumeData = JSON.parse(localStorage.getItem(LS_RESUME) || 'null'); } catch{ resumeData=null; }
  $('#resumeBanner').hidden = !resumeData;
}
$('#discardResume').addEventListener('click', () => {
  localStorage.removeItem(LS_RESUME);
  resumeData = null;
  $('#resumeBanner').hidden = true;
});
$('#doResume').addEventListener('click', () => {
  if(!resumeData) return;
  candidate = resumeData.candidate;
  series    = resumeData.series;
  // jump straight into intro of the next task
  beginTask();
});

/* ---------- guidelines ---------- */
const consent  = $('#consent');
const beginAll = $('#beginAll');
consent.addEventListener('change', () => beginAll.disabled = !consent.checked);
beginAll.addEventListener('click', () => {
  if($('#fullscreenOpt').checked) enterFullscreen();
  series = { idx:0, results:[], integrity:[] };
  installIntegrityWatchers();
  beginTask();
});

/* ============================================================
   FULLSCREEN
============================================================ */
function enterFullscreen(){
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if(fn) fn.call(el).catch(()=>{});
}

/* ============================================================
   INTEGRITY WATCHERS  (tab-switch, blur, fullscreen-exit)
============================================================ */
function installIntegrityWatchers(){
  document.addEventListener('visibilitychange', () => {
    if(document.hidden && isInTest()) logIntegrity('Tab hidden / switched away');
  });
  window.addEventListener('blur', () => {
    if(isInTest()) logIntegrity('Window lost focus');
  });
  document.addEventListener('fullscreenchange', () => {
    if(!document.fullscreenElement && isInTest()) logIntegrity('Exited fullscreen');
  });
}
function isInTest(){
  return series && !$('#screen-results').classList.contains('active')
              && !$('#screen-landing').classList.contains('active');
}
function logIntegrity(msg){
  if(!series) return;
  series.integrity.push({ at: Date.now(), msg });
  flashIntegrity(msg);
}
function flashIntegrity(msg){
  const t = $('#integrityToast');
  t.textContent = '⚠ ' + msg + ' — recorded';
  t.classList.add('show');
  clearTimeout(flashIntegrity._t);
  flashIntegrity._t = setTimeout(()=> t.classList.remove('show'), 2200);
}

/* ============================================================
   TASK FLOW
============================================================ */
function beginTask(){
  task = TASKS[series.idx];
  $('#ti-eyebrow').textContent = task.eyebrow;
  $('#ti-title').textContent   = task.name;
  $('#ti-desc').textContent    = task.desc;
  $('#ti-example').innerHTML   = task.example;
  $('#ti-time').textContent    = `${Math.floor(task.seconds/60)} minutes`;
  $('#ti-start').onclick = () => startPractice();
  show('screen-task-intro');
  saveResume();
}

function startPractice(){
  mode = 'practice';
  practiceIndex = 0;
  answered = 0; correct = 0;
  $('#rn-task').textContent = task.name;
  $('#rn-mode').textContent = 'Practice';
  $('#rn-timer').textContent = '--:--';
  clearInterval(timerId);
  nextItem();
  show('screen-runner');
}

function startReal(){
  mode = 'real';
  answered = 0; correct = 0;
  $('#rn-mode').textContent = 'Timed task';
  endsAt = Date.now() + task.seconds*1000;
  // store per-item timings for analytics
  task._timings = [];
  timerId = setInterval(tickTimer, 250);
  tickTimer();
  nextItem();
}

function tickTimer(){
  const remain = Math.max(0, endsAt - Date.now());
  const m = Math.floor(remain/60000);
  const s = Math.floor((remain%60000)/1000);
  $('#rn-timer').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  if(mode === 'real'){
    const totalMs = task.seconds*1000;
    const elapsed = totalMs - remain;
    $('#rn-bar').style.width = `${Math.min(100,(elapsed/totalMs)*100)}%`;
    if(remain < 10000) $('#rn-timer').style.color = 'var(--bad)';
    else $('#rn-timer').style.color = '';
  }
  if(remain <= 0){ clearInterval(timerId); finishTask(); }
}

function nextItem(){
  if(mode === 'practice'){
    if(practiceIndex >= PRACTICE_COUNT){ showPracticeComplete(); return; }
    practiceIndex++;
    updateProgress(practiceIndex, PRACTICE_COUNT);
  } else {
    updateProgress(answered, null);
  }
  item = task.gen();
  itemStart = performance.now();
  const waitForClick = (task.key === 'reasoning'); // reasoning shows stim first
  task.render(item, waitForClick);
}

function updateProgress(cur, total){
  const counter = $('#rn-counter'), bar = $('#rn-bar');
  if(mode === 'practice'){
    counter.textContent = `Practice ${cur} / ${total}`;
    bar.style.width = `${(cur/total)*100}%`;
  } else {
    counter.textContent = `Answered: ${answered}`;
  }
}

function showPracticeComplete(){
  $('#rn-hint').textContent = '';
  $('#rn-stage').innerHTML = `
    <div class="white-card" style="flex-direction:column;gap:18px">
      <p class="stim-text" style="font-size:24px">Practice complete</p>
      <p style="color:var(--ink-soft);margin:0;font-size:15px;text-align:center;max-width:480px">
        The timed task will start as soon as you click below.
        Remember — both <b>speed</b> and <b>accuracy</b> matter.
      </p>
      <button class="btn primary lg" id="practiceGo">Start timed task →</button>
    </div>`;
  $('#practiceGo').onclick = () => startReal();
}

function handleAnswer(isCorrect, el){
  if(_locked) return;
  _locked = true;
  const ms = performance.now() - itemStart;
  if(mode === 'practice'){
    el.classList.add(isCorrect ? 'correct' : 'wrong');
    flashFeedback(isCorrect);
    setTimeout(() => { _locked = false; nextItem(); }, 550);
  } else {
    answered++;
    if(isCorrect) correct++;
    task._timings.push({ rt: ms, correct: isCorrect });
    _locked = false;
    nextItem();
  }
}

function flashFeedback(good){
  const fb = $('#rn-fb');
  fb.textContent = good ? '✓ Correct' : '✕ Try again';
  fb.className = 'feedback show ' + (good ? 'good' : 'bad');
  clearTimeout(flashFeedback._t);
  flashFeedback._t = setTimeout(()=> fb.classList.remove('show'), 500);
}

function finishTask(){
  clearInterval(timerId);
  const accuracy = answered ? correct/answered : 0;
  const baseline = baselineFor(task.key);
  const speedScore = Math.min(100, (answered / baseline) * 100);
  const acc = accuracy * 100;
  const score = Math.round(acc * 0.55 + speedScore * 0.45);

  series.results.push({
    key:task.key, name:task.name, answered, correct, accuracy, score,
    timings: task._timings || []
  });
  saveResume();

  if(series.idx < TASKS.length - 1){
    $('#bt-msg').textContent = `You answered ${answered} item${answered===1?'':'s'} with ${Math.round(accuracy*100)}% accuracy. Up next: ${TASKS[series.idx+1].name}.`;
    $('#bt-next').onclick = () => { series.idx++; beginTask(); };
    show('screen-between');
  } else {
    finalizeAttempt();
  }
}

function baselineFor(key){
  return { perceptual:35, reasoning:25, memory:35, number:30, spatial:25 }[key] || 30;
}

/* ============================================================
   ITEM GENERATORS
============================================================ */
/* 1. Perceptual Speed */
function genPerceptual(){
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const pairs = []; let same = 0;
  for(let i=0;i<4;i++){
    const isSame = Math.random() < 0.5;
    const a = pick(alphabet);
    let b;
    if(isSame){ b = a; same++; }
    else { do{ b = pick(alphabet); }while(b===a); }
    pairs.push([
      Math.random()<.5 ? a.toUpperCase() : a,
      Math.random()<.5 ? b.toUpperCase() : b
    ]);
  }
  return { pairs, answer: same };
}
function renderPerceptual(it){
  const stage = $('#rn-stage');
  const pairsHtml = it.pairs.map(p => `<div class="pair"><div class="glyph">${p[0]}</div><div class="glyph">${p[1]}</div></div>`).join('');
  const opts = [0,1,2,3,4].map(n => `<button class="ans-box" data-v="${n}">${n}</button>`).join('');
  stage.innerHTML = `<div class="white-card"><div class="pairs">${pairsHtml}</div></div><div class="answer-grid five">${opts}</div>`;
  $('#rn-hint').textContent = 'How many pairs contain the same letter?';
  stage.querySelectorAll('.ans-box').forEach(b => {
    b.onclick = () => handleAnswer(parseInt(b.dataset.v,10) === it.answer, b);
  });
}

/* 2. Reasoning */
const PEOPLE = ['Bob','Paul','Tom','Anna','Lisa','Jane','Mark','Sue','Liam','Mia','Ravi','Zara'];
const TRAITS = [
  {pos:'happy',  neg:'sad',     posQ:'happier', negQ:'sadder'},
  {pos:'tall',   neg:'short',   posQ:'taller',  negQ:'shorter'},
  {pos:'strong', neg:'weak',    posQ:'stronger',negQ:'weaker'},
  {pos:'fast',   neg:'slow',    posQ:'faster',  negQ:'slower'},
  {pos:'heavy',  neg:'light',   posQ:'heavier', negQ:'lighter'},
  {pos:'rich',   neg:'poor',    posQ:'richer',  negQ:'poorer'},
];
function genReasoning(){
  const [a,b] = shuffle(PEOPLE).slice(0,2);
  const t = pick(TRAITS);
  const patterns = [
    () => ({stim:`${a} is ${t.pos}er than ${b}.`,            winnerPos:a, winnerNeg:b }),
    () => ({stim:`${a} is not as ${t.pos} as ${b}.`,         winnerPos:b, winnerNeg:a }),
    () => ({stim:`${a} is less ${t.pos} than ${b}.`,         winnerPos:b, winnerNeg:a }),
    () => ({stim:`${a} is ${t.neg}er than ${b}.`,            winnerPos:b, winnerNeg:a }),
  ];
  const p = pick(patterns)();
  const askPos = Math.random() < 0.5;
  return {
    stim:p.stim,
    question: askPos ? `Who is ${t.posQ}?` : `Who is ${t.negQ}?`,
    answer:   askPos ? p.winnerPos : p.winnerNeg,
    options: shuffle([a,b])
  };
}
function renderReasoning(it, showStim){
  const stage = $('#rn-stage');
  if(showStim){
    stage.innerHTML = `<div class="white-card click-anywhere"><p class="stim-text">${escapeHTML(it.stim)}</p></div>`;
    $('#rn-hint').textContent = 'Click the screen when ready to continue';
    const runner = $('#screen-runner');
    let armed = false;
    const next = (e) => {
      if(!armed) return;
      if(e && e.target && e.target.closest('button,a,input')) return;
      runner.removeEventListener('click', next);
      document.removeEventListener('keydown', keyer);
      itemStart = performance.now(); // reset timer for the actual question
      renderReasoningQuestion(it);
    };
    const keyer = e => { if(e.key===' '||e.key==='Enter'){ e.preventDefault(); next({}); } };
    setTimeout(()=>{ armed = true; runner.addEventListener('click', next); document.addEventListener('keydown', keyer); }, 180);
  } else {
    renderReasoningQuestion(it);
  }
}
function renderReasoningQuestion(it){
  const stage = $('#rn-stage');
  stage.innerHTML = `<div class="white-card"><p class="stim-text">${escapeHTML(it.question)}</p></div>
    <div class="answer-grid two">${it.options.map(o=>`<button class="ans-box big" data-v="${escapeHTML(o)}">${escapeHTML(o)}</button>`).join('')}</div>`;
  $('#rn-hint').textContent = 'Click the correct answer.';
  stage.querySelectorAll('.ans-box').forEach(b => {
    b.onclick = () => handleAnswer(b.dataset.v === it.answer, b);
  });
}

/* 3. Word Meaning */
const WORD_SETS = [
  ['hot','warm','cold'],['below','under','letter'],['big','large','small'],
  ['begin','start','finish'],['quick','fast','slow'],['happy','glad','sad'],
  ['gift','present','spoon'],['speak','talk','run'],['rich','wealthy','poor'],
  ['shut','close','open'],['simple','easy','hard'],['enemy','foe','friend'],
  ['street','road','river'],['couch','sofa','chair'],['silent','quiet','loud'],
  ['ill','sick','well'],['answer','reply','question'],['choose','pick','reject'],
  ['build','make','break'],['near','close','far'],['boat','ship','train'],
  ['pretty','beautiful','ugly'],['strong','powerful','weak'],['begin','commence','end'],
  ['joyful','cheerful','gloomy'],['true','correct','wrong'],['shout','yell','whisper'],
  ['easy','simple','complex'],['little','tiny','huge'],['cold','chilly','warm'],
  ['hurry','rush','linger'],['old','aged','young'],['kind','nice','mean'],['dry','arid','wet']
];
function genWord(){
  const trio = pick(WORD_SETS);
  const odd  = trio[2];
  return { options: shuffle(trio), answer: odd };
}
function renderWord(it){
  const stage = $('#rn-stage');
  stage.innerHTML = `<div class="white-card"><p class="stim-text">Click the odd word out</p></div>
    <div class="answer-grid three">${it.options.map(o=>`<button class="ans-box big" data-v="${escapeHTML(o)}">${escapeHTML(o)}</button>`).join('')}</div>`;
  $('#rn-hint').textContent = 'Two words are related — click the one that is not.';
  stage.querySelectorAll('.ans-box').forEach(b => {
    b.onclick = () => handleAnswer(b.dataset.v === it.answer, b);
  });
}

/* 4. Number Speed & Accuracy */
function genNumber(){
  let a,b,c;
  do{
    a = rand(1,20); b = rand(1,20); c = rand(1,20);
  } while(new Set([a,b,c]).size < 3 ||
          (Math.abs(Math.max(a,b,c)-median3(a,b,c)) === Math.abs(Math.min(a,b,c)-median3(a,b,c))));
  const nums = [a,b,c];
  const hi = Math.max(...nums), lo = Math.min(...nums);
  const mid = nums.find(n => n!==hi && n!==lo);
  const answer = (Math.abs(hi-mid) > Math.abs(lo-mid)) ? hi : lo;
  return { nums, answer };
}
function median3(a,b,c){ return [a,b,c].sort((x,y)=>x-y)[1]; }
function renderNumber(it){
  const stage = $('#rn-stage');
  stage.innerHTML = `<div class="white-card"><div class="number-trio">${it.nums.map(n=>`<div>${n}</div>`).join('')}</div></div>
    <div class="answer-grid three">${it.nums.map(n=>`<button class="ans-box big" data-v="${n}">${n}</button>`).join('')}</div>`;
  $('#rn-hint').textContent = 'Click the number furthest from the remaining one.';
  stage.querySelectorAll('.ans-box').forEach(b => {
    b.onclick = () => handleAnswer(parseInt(b.dataset.v,10) === it.answer, b);
  });
}

/* 5. Spatial Visualisation */
const SPATIAL_GLYPHS = ['R','F','G','J','P','L'];
function rotG(glyph, angle, mirror){
  return `<span class="glyph shape" style="display:inline-block;transform:rotate(${angle}deg) scaleX(${mirror?-1:1});font-family:Georgia,serif">${glyph}</span>`;
}
function genSpatial(){
  const pairs = []; let same = 0;
  const glyph = pick(SPATIAL_GLYPHS);
  for(let i=0;i<4;i++){
    const topMirror = Math.random()<.5;
    const aRot = rand(0,3)*90;
    const matches = Math.random()<.5;
    const botMirror = matches ? topMirror : !topMirror;
    const bRot = rand(0,3)*90;
    pairs.push({ glyph, top:{a:aRot,m:topMirror}, bot:{a:bRot,m:botMirror} });
    if(matches) same++;
  }
  return { pairs, answer:same };
}
function renderSpatial(it){
  const stage = $('#rn-stage');
  const pairsHtml = it.pairs.map(p => `<div class="pair">${rotG(p.glyph,p.top.a,p.top.m)}${rotG(p.glyph,p.bot.a,p.bot.m)}</div>`).join('');
  const opts = [0,1,2,3,4].map(n => `<button class="ans-box" data-v="${n}">${n}</button>`).join('');
  stage.innerHTML = `<div class="white-card"><div class="pairs">${pairsHtml}</div></div><div class="answer-grid five">${opts}</div>`;
  $('#rn-hint').textContent = 'How many pairs match by rotation only (not mirror)?';
  stage.querySelectorAll('.ans-box').forEach(b => {
    b.onclick = () => handleAnswer(parseInt(b.dataset.v,10) === it.answer, b);
  });
}

/* ============================================================
   FINALIZE  →  attempt record  →  results UI
============================================================ */
function finalizeAttempt(){
  const composite = Math.round(series.results.reduce((s,r)=>s+r.score,0) / series.results.length);
  const attempt = {
    id: 'a_' + Date.now().toString(36),
    candidate,
    composite,
    percentile: percentileFor(composite),
    results: series.results,
    integrity: series.integrity,
    finishedAt: new Date().toISOString()
  };
  saveAttempt(attempt);
  localStorage.removeItem(LS_RESUME);
  renderResults(attempt);
  show('screen-results');
}

function saveAttempt(a){
  let arr=[]; try{ arr = JSON.parse(localStorage.getItem(LS_ATTEMPTS)||'[]'); }catch{}
  arr.unshift(a);
  localStorage.setItem(LS_ATTEMPTS, JSON.stringify(arr.slice(0,200)));
}
function loadAttempts(){
  try{ return JSON.parse(localStorage.getItem(LS_ATTEMPTS)||'[]'); }catch{ return []; }
}
function saveResume(){
  if(!series) return;
  try{
    localStorage.setItem(LS_RESUME, JSON.stringify({ candidate, series }));
  }catch{}
}

/* Percentile mapping — illustrative norm curve (mean 50, sd ~17) */
function percentileFor(score){
  // crude normal CDF approximation
  const z = (score - 50) / 17;
  const p = 0.5 * (1 + erf(z / Math.SQRT2));
  return Math.max(1, Math.min(99, Math.round(p*100)));
}
function erf(x){
  // Abramowitz & Stegun
  const sign = Math.sign(x); x = Math.abs(x);
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const t = 1/(1+p*x);
  const y = 1 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t * Math.exp(-x*x);
  return sign*y;
}

/* ============================================================
   RESULTS UI
============================================================ */
function renderResults(a){
  $('#reportName').textContent = `Report · ${a.candidate?.name || 'Candidate'}`;
  const d = new Date(a.finishedAt);
  $('#reportMeta').textContent =
    `${a.candidate?.email || ''} · ${a.candidate?.role || ''} · ${d.toLocaleString()}`;
  $('#scoreVal').textContent = a.composite;
  const dash = 326.7;
  $('#ringFg').style.strokeDashoffset = (dash - dash*(a.composite/100)).toFixed(1);
  $('#percentileVal').textContent = a.percentile + 'th';
  $('#scoreBlurb').textContent = blurb(a.composite);

  // Breakdown
  $('#breakdown').innerHTML = a.results.map(r => `
    <div class="brk">
      <div class="label">${escapeHTML(r.name)}</div>
      <div class="track"><div style="width:${r.score}%"></div></div>
      <div class="val">${r.score}</div>
    </div>
    <div class="brk-meta">${r.answered} answered · ${r.correct} correct · ${Math.round(r.accuracy*100)}% accuracy</div>
  `).join('');

  // Radar
  renderRadar(a.results);

  // RT analytics
  $('#rtCharts').innerHTML = a.results.map(r => rtCard(r)).join('');

  // Integrity
  const il = $('#integrityList');
  if(!a.integrity.length){
    il.innerHTML = `<div class="integrity-row ok"><span>✓ No distraction events detected. Clean assessment.</span></div>`;
  } else {
    il.innerHTML = a.integrity.map(ev =>
      `<div class="integrity-row"><span>⚠ ${escapeHTML(ev.msg)}</span><time>${new Date(ev.at).toLocaleTimeString()}</time></div>`
    ).join('');
  }
}

function blurb(score){
  if(score >= 80) return 'Outstanding — your processing speed and accuracy place you in the top tier of trainability.';
  if(score >= 65) return 'Strong performance across all five domains. You learn new information quickly.';
  if(score >= 50) return 'Solid, balanced performance. With practice you can lift specific subscales further.';
  if(score >= 35) return 'A steady result. Focus on the lower subscales to raise your composite score.';
  return 'A good first pass. Re-take the assessment in a quiet, focused environment for a truer score.';
}

/* Radar chart (pure SVG) */
function renderRadar(results){
  const svg = $('#radarSvg');
  const W=320, H=280, cx=W/2, cy=H/2+10, R=98;
  const n = results.length;
  const labels = results.map(r=>r.name.split(/[ ·]/)[0]);
  const vals   = results.map(r=>r.score);
  const angle = i => -Math.PI/2 + i*(2*Math.PI/n);

  let grid='';
  for(const ring of [0.25,0.5,0.75,1]){
    const pts=[]; for(let i=0;i<n;i++){const a=angle(i); pts.push(`${cx+Math.cos(a)*R*ring},${cy+Math.sin(a)*R*ring}`);}
    grid += `<polygon class="radar-grid" points="${pts.join(' ')}"/>`;
  }
  for(let i=0;i<n;i++){
    const a=angle(i);
    grid += `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${cx+Math.cos(a)*R}" y2="${cy+Math.sin(a)*R}"/>`;
  }
  const pts=[]; const dots=[]; const lbls=[];
  for(let i=0;i<n;i++){
    const a=angle(i); const v=vals[i]/100;
    const x=cx+Math.cos(a)*R*v, y=cy+Math.sin(a)*R*v;
    pts.push(`${x},${y}`); dots.push(`<circle class="radar-dot" cx="${x}" cy="${y}" r="3"/>`);
    const lx=cx+Math.cos(a)*(R+18), ly=cy+Math.sin(a)*(R+18)+4;
    const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle';
    lbls.push(`<text class="radar-label" x="${lx}" y="${ly}" text-anchor="${anchor}">${escapeHTML(labels[i])}</text>`);
  }
  svg.innerHTML = grid + `<polygon class="radar-shape" points="${pts.join(' ')}"/>` + dots.join('') + lbls.join('');
}

/* Per-task RT spark line */
function rtCard(r){
  const t = r.timings;
  if(!t || !t.length) return `<div class="rt-card"><h4>${escapeHTML(r.name)}</h4><div class="rt-meta">No timed responses</div></div>`;
  const W=240, H=60, pad=4;
  const max = Math.max(...t.map(x=>x.rt), 1);
  const stepX = (W-pad*2) / Math.max(1, t.length-1);
  const pts = t.map((x,i)=>[pad + i*stepX, H - pad - (x.rt/max)*(H-pad*2)]);
  const path = pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const area = path + ` L ${pts[pts.length-1][0]},${H-pad} L ${pts[0][0]},${H-pad} Z`;
  const dots = pts.map((p,i)=>`<circle class="dot ${t[i].correct?'good':''}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2"/>`).join('');
  const median = [...t].map(x=>x.rt).sort((a,b)=>a-b)[Math.floor(t.length/2)];
  return `<div class="rt-card">
    <h4>${escapeHTML(r.name)}</h4>
    <div class="rt-meta">${t.length} responses · median ${(median/1000).toFixed(2)}s · accuracy ${Math.round(r.accuracy*100)}%</div>
    <svg class="rt-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path class="area" d="${area}"/>
      <path d="${path}"/>
      ${dots}
    </svg>
  </div>`;
}

/* Export buttons */
$('#printBtn').addEventListener('click', () => window.print());
$('#jsonBtn').addEventListener('click', () => {
  const a = loadAttempts()[0];
  download(`cognitra-${(a.candidate.name||'attempt').replace(/\s+/g,'-')}.json`,
    JSON.stringify(a, null, 2), 'application/json');
});
$('#csvBtn').addEventListener('click', () => download('cognitra-attempt.csv', toCsv([loadAttempts()[0]]), 'text/csv'));

function toCsv(arr){
  const rows = [['attemptId','finishedAt','name','email','role','composite','percentile','task','answered','correct','accuracy','score']];
  for(const a of arr) for(const r of a.results){
    rows.push([a.id, a.finishedAt, a.candidate?.name||'', a.candidate?.email||'', a.candidate?.role||'',
               a.composite, a.percentile, r.name, r.answered, r.correct, (r.accuracy||0).toFixed(3), r.score]);
  }
  return rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }).join(',')).join('\n');
}
function download(name, text, mime){
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

/* ============================================================
   ADMIN DASHBOARD
============================================================ */
function renderAdmin(){
  const arr = loadAttempts();
  const tbody = $('#attemptsTbody');
  $('#emptyAttempts').hidden = arr.length > 0;

  // stats
  const total = arr.length;
  const avg = total ? Math.round(arr.reduce((s,a)=>s+a.composite,0)/total) : 0;
  const best = total ? Math.max(...arr.map(a=>a.composite)) : 0;
  const clean = arr.filter(a => (a.integrity||[]).length===0).length;
  $('#adminStats').innerHTML = `
    <div class="stat"><b>${total}</b><span>Total attempts</span></div>
    <div class="stat"><b>${avg}</b><span>Average composite</span></div>
    <div class="stat"><b>${best}</b><span>Highest score</span></div>
    <div class="stat"><b>${clean}/${total||0}</b><span>Clean integrity</span></div>
  `;

  tbody.innerHTML = arr.map(a => {
    const flagged = (a.integrity||[]).length;
    return `<tr>
      <td>${new Date(a.finishedAt).toLocaleString()}</td>
      <td>${escapeHTML(a.candidate?.name||'—')}</td>
      <td>${escapeHTML(a.candidate?.email||'—')}</td>
      <td>${escapeHTML(a.candidate?.role||'—')}</td>
      <td><b>${a.composite}</b></td>
      <td>${a.percentile}th</td>
      <td><span class="badge-int ${flagged?'flag':'clean'}">${flagged?flagged+' flag(s)':'Clean'}</span></td>
      <td class="row-actions">
        <button class="btn ghost" data-view="${a.id}">View</button>
        <button class="btn ghost" data-del="${a.id}">Delete</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    const a = loadAttempts().find(x => x.id === b.dataset.view);
    if(a){ renderResults(a); show('screen-results'); }
  });
  tbody.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const arr2 = loadAttempts().filter(x => x.id !== b.dataset.del);
    localStorage.setItem(LS_ATTEMPTS, JSON.stringify(arr2));
    renderAdmin();
  });
}
$('#exportAllCsv').addEventListener('click', () => download('cognitra-all-attempts.csv', toCsv(loadAttempts()), 'text/csv'));
$('#clearAll').addEventListener('click', () => {
  if(confirm('Delete all stored attempts? This cannot be undone.')){
    localStorage.removeItem(LS_ATTEMPTS); renderAdmin();
  }
});

/* ============================================================
   QUIT button + global key shortcuts + beforeunload
============================================================ */
$('#quitBtn').addEventListener('click', () => {
  if(confirm('Quit the assessment? Your progress so far will be saved as a resumable draft.')){
    saveResume();
    clearInterval(timerId);
    show('screen-landing');
  }
});
document.addEventListener('keydown', e => {
  if(!$('#screen-runner').classList.contains('active')) return;
  if(/^[1-5]$/.test(e.key)){
    const boxes = $$('#rn-stage .ans-box');
    const idx = parseInt(e.key,10) - 1;
    if(boxes[idx]){ e.preventDefault(); boxes[idx].click(); }
  }
});
window.addEventListener('beforeunload', e => {
  if(isInTest()){ e.preventDefault(); e.returnValue = ''; }
});

/* When user enters intake screen, check for resumable attempt */
new MutationObserver(() => {
  if($('#screen-intake').classList.contains('active')) checkResume();
}).observe(document.body, { subtree:true, attributes:true, attributeFilter:['class'] });

})();
