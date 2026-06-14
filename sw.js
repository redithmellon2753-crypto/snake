<script>
// ====== Supabase 云排行榜 ======
const SB_URL='https://pilixnfkdciwrtdadjdl.supabase.co';
const SB_KEY='sb_publishable_Sght7vbMyGKJNgFcbD58DA_2IjzOMG7';
let sb=null;
try{ sb=window.supabase.createClient(SB_URL,SB_KEY); }catch(e){ console.warn('Supabase init fail',e); }
async function uploadScore(name,score,mode){ if(!sb||score<=0) return; try{ await sb.from('scores').insert({name:name.slice(0,20),score,mode}); }catch(e){ console.warn('upload fail',e);} }
async function fetchGlobal(){ if(!sb) return null; try{ const {data,error}=await sb.from('scores').select('name,score,mode').order('score',{ascending:false}).limit(20); if(error) throw error; return data; }catch(e){ console.warn('fetch fail',e); return null; } }

const canvas=document.getElementById('game'), ctx=canvas.getContext('2d');
const $=id=>document.getElementById(id);
const CELL=24;                 // 像素/格
const VIEW=canvas.width;       // 可视区像素 480 -> 20格视野
const VCELLS=VIEW/CELL;        // 视野格数 20
const MAP=40;                  // 大地图 40x40 格
const k=(x,y)=>x+'_'+y;

const DIFF={ easy:{speed:155,name:'简单'}, normal:{speed:118,name:'普通'}, hard:{speed:86,name:'困难'}, hell:{speed:56,name:'地狱'} };
const MODE_NAME={ classic:'经典', level:'闯关', chaos:'混沌' };
const KEY_BEST='snakeBig_best', KEY_HIST='snakeBig_history';
const COLORS={ normal:'#ff4d6d', speed:'#5b9dff', shrink:'#c77dff', double:'#ff9f43', poison:'#8a6d3b', mirror:'#e8edf0', coin:'#ffd700' };
const TIMED_LIFE=8000, TIMED_MAX=3;

let snake,dir,nextDir,wallSet,score,kills,timer,running,paused;
let mainFood,timedFoods,nextTimedAt,coin,nextCoinAt,portals,enemies;
let curDiff='normal', curMode='classic', useDpad=false;
let level=1, baseSpeed=118, curSpeed=118, eatenInLevel=0, needPerLevel=5;
let lastEatTime=0, combo=0, speedBoostUntil=0, mirrorUntil=0;
let particles=[], shake=0, usedRevive=false, dieReason='';
let cam={x:0,y:0};             // 摄像机（格坐标，浮点，用于平滑）
let currentTab='local';

// 音效
let actx=null;
function beep(f,dur=0.08,type='square',vol=0.15){ try{ if(!actx)actx=new(window.AudioContext||window.webkitAudioContext)(); const o=actx.createOscillator(),g=actx.createGain(); o.type=type;o.frequency.value=f;o.connect(g);g.connect(actx.destination); g.gain.setValueAtTime(vol,actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,actx.currentTime+dur); o.start();o.stop(actx.currentTime+dur);}catch(e){} }
const sEat=()=>beep(660,0.07), sSpecial=()=>{beep(880,0.06);setTimeout(()=>beep(1180,0.08),60);};
const sCoin=()=>{beep(988,0.05);setTimeout(()=>beep(1318,0.07),50);setTimeout(()=>beep(1568,0.09),100);};
const sKill=()=>{beep(1200,0.06,'square');setTimeout(()=>beep(1600,0.06),50);setTimeout(()=>beep(2000,0.1),100);};
const sBad=()=>beep(160,0.15,'sawtooth'), sPortal=()=>{beep(440,0.05,'sine');setTimeout(()=>beep(880,0.08,'sine'),40);};
const sDie=()=>{beep(200,0.18,'sawtooth');setTimeout(()=>beep(120,0.25,'sawtooth'),120);};
const sLevel=()=>{beep(523,0.1);setTimeout(()=>beep(659,0.1),100);setTimeout(()=>beep(784,0.15),200);};

const getBest=()=>+(localStorage.getItem(KEY_BEST)||0);
const setBest=v=>localStorage.setItem(KEY_BEST,v);
function getHist(){ try{return JSON.parse(localStorage.getItem(KEY_HIST)||'[]');}catch{return[];} }
function addHist(e){ const h=getHist(); h.unshift(e); h.sort((a,b)=>b.score-a.score); localStorage.setItem(KEY_HIST,JSON.stringify(h.slice(0,10))); }

function refreshStatsUI(){ $('best').textContent=getBest(); $('lvBox').style.display=curMode==='level'?'':'none'; $('level').textContent=level; $('kills').textContent=kills||0; }
function renderHistory(){ const el=$('hlist'); const h=getHist(); if(!h.length){ el.innerHTML='<div class="empty">还没有记录，快玩一局吧</div>'; return; } el.innerHTML=h.map((e,i)=>{ const m=i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`; return `<li><span class="hd">${m} ${e.name||'匿名'} · ${e.mode}${e.level?(' L'+e.level):''}</span><span class="hs">${e.score} 分</span></li>`; }).join(''); }
async function renderGlobal(){ const el=$('hlist'); el.innerHTML='<div class="empty">加载中…</div>'; const data=await fetchGlobal(); if(!data){ el.innerHTML='<div class="empty">连接失败，检查网络</div>'; return; } if(!data.length){ el.innerHTML='<div class="empty">全球榜还空着，抢第一吧</div>'; return; } el.innerHTML=data.map((e,i)=>{ const m=i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`; return `<li><span class="hd">${m} ${(e.name||'匿名').replace(/</g,'')} · ${e.mode||''}</span><span class="hs">${e.score} 分</span></li>`; }).join(''); }
function refreshBoard(){ currentTab==='global'?renderGlobal():renderHistory(); }
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),1200); }
function showFx(txt,color){ const f=$('fx'); f.textContent=txt; f.style.color=color; f.classList.add('show'); clearTimeout(f._t); f._t=setTimeout(()=>f.classList.remove('show'),900); }
function showCombo(){ const c=$('combo'); c.textContent=`🔥 连击 x${combo} +${combo-2}`; c.classList.add('show'); clearTimeout(c._t); c._t=setTimeout(()=>c.classList.remove('show'),900); }
function showKill(){ const e=$('killfx'); e.textContent='击杀 +10!'; e.classList.add('show'); clearTimeout(e._t); e._t=setTimeout(()=>e.classList.remove('show'),700); }
function burst(cx,cy,color,n=10){ for(let i=0;i<n;i++){ const a=Math.random()*Math.PI*2, sp=1+Math.random()*3.5; particles.push({x:cx,y:cy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,color}); } }

// ====== 地图与障碍（成团分布）======
function inMap(x,y){ return x>=0&&x<MAP&&y>=0&&y<MAP; }
function buildWalls(){
  wallSet=new Set();
  const safe=(x,y)=>Math.abs(x-MAP/2)<=2&&Math.abs(y-MAP/2)<=2; // 出生点附近留空
  let clusters;
  if(curMode==='level') clusters=Math.min(2+level,8);
  else if(curMode==='chaos') clusters=9;
  else clusters=5; // 经典
  for(let c=0;c<clusters;c++){
    const cx=2+Math.floor(Math.random()*(MAP-4));
    const cy=2+Math.floor(Math.random()*(MAP-4));
    const blobs=4+Math.floor(Math.random()*8); // 每团 4~11 块，聚集
    let px=cx,py=cy;
    for(let b=0;b<blobs;b++){
      if(inMap(px,py)&&!safe(px,py)) wallSet.add(k(px,py));
      px+=Math.floor(Math.random()*3)-1;
      py+=Math.floor(Math.random()*3)-1;
      px=Math.max(0,Math.min(MAP-1,px)); py=Math.max(0,Math.min(MAP-1,py));
    }
  }
}
function isWall(x,y){ return wallSet.has(k(x,y)); }

function occupied(x,y){
  if(snake.some(s=>s.x===x&&s.y===y)) return true;
  if(isWall(x,y)) return true;
  if(mainFood&&mainFood.x===x&&mainFood.y===y) return true;
  if(timedFoods.some(f=>f.x===x&&f.y===y)) return true;
  if(coin&&coin.x===x&&coin.y===y) return true;
  if(portals&&portals.some(p=>p.x===x&&p.y===y)) return true;
  if(enemies&&enemies.some(en=>en.body.some(s=>s.x===x&&s.y===y))) return true;
  return false;
}
function freeCell(){ let x,y,g=0; do{ x=Math.floor(Math.random()*MAP); y=Math.floor(Math.random()*MAP); g++; }while(occupied(x,y)&&g<1500); return {x,y}; }

function spawnMain(){ mainFood=null; const r=Math.random(); const type=r<0.62?'normal':r<0.76?'speed':r<0.87?'shrink':'double'; mainFood={...freeCell(),type}; }
function spawnTimed(){ if(timedFoods.length>=TIMED_MAX) return; const type=Math.random()<0.6?'poison':'mirror'; timedFoods.push({...freeCell(),type,expire:Date.now()+TIMED_LIFE}); }
function scheduleTimed(){ nextTimedAt=Date.now()+5000+Math.random()*5000; }
function spawnCoin(){ coin={...freeCell(),expire:Date.now()+7000}; }
function scheduleCoin(){ nextCoinAt=Date.now()+7000+Math.random()*7000; }
function spawnPortals(){ const a=freeCell(); let b; do{ b=freeCell(); }while(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)<8); portals=[{...a,pair:1},{...b,pair:0}]; }
function spawnEnemy(){ const c=freeCell(); const len=4+Math.floor(Math.random()*4); const body=[]; for(let i=0;i<len;i++) body.push({x:c.x,y:c.y}); enemies.push({ body, dir:{x:1,y:0}, nextMove:Date.now()+500 }); }
function enemyCount(){ if(curMode==='chaos') return 3; if(curMode==='level') return level>=4?2:(level>=2?1:0); return 1; } // 经典也有1条
</script>
<script>
function reset(){
  snake=[]; const sx=MAP/2|0, sy=MAP/2|0;
  for(let i=0;i<3;i++) snake.push({x:sx-i,y:sy});
  dir={x:1,y:0}; nextDir={x:1,y:0};
  score=0; kills=0; combo=0; speedBoostUntil=0; mirrorUntil=0; usedRevive=false; particles=[]; shake=0;
  $('score').textContent='0';
  level=1; eatenInLevel=0;
  buildWalls();
  baseSpeed=DIFF[curDiff].speed; curSpeed=baseSpeed;
  mainFood=null; timedFoods=[]; coin=null; portals=null; enemies=[];
  spawnMain(); scheduleTimed(); scheduleCoin();
  if(curMode==='chaos') spawnPortals();
  const ec=enemyCount(); for(let i=0;i<ec;i++) spawnEnemy();
  cam.x=sx-VCELLS/2; cam.y=sy-VCELLS/2;
}
function restartTimer(){ clearInterval(timer); timer=setInterval(step,curSpeed); }

// 敌人蛇：朝食物移动，可被玩家撞身体击杀；其头撞玩家身体则玩家死
function moveEnemies(now){
  enemies.forEach(en=>{
    if(now<en.nextMove) return;
    en.nextMove=now+Math.max(150,curSpeed+50);
    const h=en.body[0], t=mainFood||{x:h.x,y:h.y};
    const opts=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}].filter(d=>!(d.x===-en.dir.x&&d.y===-en.dir.y));
    opts.sort((a,b)=>(Math.abs(h.x+a.x-t.x)+Math.abs(h.y+a.y-t.y))-(Math.abs(h.x+b.x-t.x)+Math.abs(h.y+b.y-t.y)));
    let chosen=null;
    for(const d of opts){ const nx=h.x+d.x,ny=h.y+d.y; if(!inMap(nx,ny)) continue; if(isWall(nx,ny)) continue; if(snake.some(s=>s.x===nx&&s.y===ny)) continue; chosen=d; break; }
    if(!chosen) chosen=opts[0]||en.dir;
    en.dir=chosen;
    let nx=h.x+chosen.x, ny=h.y+chosen.y;
    if(!inMap(nx,ny)){ nx=h.x; ny=h.y; }
    en.body.unshift({x:nx,y:ny}); en.body.pop();
  });
}

function killEnemy(idx,px,py){
  enemies.splice(idx,1);
  kills++; $('kills').textContent=kills;
  score+=10; $('score').textContent=score;
  sKill(); showKill(); shake=10;
  burst(px,py,'#ff5c8a',22); burst(px,py,'#ffd700',14);
  // 击杀后稍后补一条新敌人蛇，保持挑战
  setTimeout(()=>{ if(running&&enemies.length<enemyCount()) spawnEnemy(); }, 3000);
}

function step(){
  if(paused) return;
  const now=Date.now();
  if(speedBoostUntil&&now>speedBoostUntil){ speedBoostUntil=0; curSpeed=baseSpeed; restartTimer(); return; }
  timedFoods=timedFoods.filter(f=>now<f.expire);
  if(now>=nextTimedAt){ spawnTimed(); scheduleTimed(); }
  if(coin&&now>coin.expire) coin=null;
  if(!coin&&now>=nextCoinAt){ spawnCoin(); scheduleCoin(); }
  moveEnemies(now);

  dir=nextDir;
  let nx=snake[0].x+dir.x, ny=snake[0].y+dir.y;
  if(!inMap(nx,ny)){ dieReason='撞到边界'; return die(); }

  // 传送门
  if(portals){ const p=portals.find(p=>p.x===nx&&p.y===ny); if(p){ const o=portals[p.pair]; nx=o.x+dir.x; ny=o.y+dir.y; if(!inMap(nx,ny)){ nx=o.x; ny=o.y; } sPortal(); burst(cx(o.x),cy(o.y),'#00d4ff',12); } }

  const head={x:nx,y:ny};
  if(snake.some(s=>s.x===head.x&&s.y===head.y)){ dieReason='撞到自己'; return die(); }
  if(isWall(head.x,head.y)){ dieReason='撞到障碍'; return die(); }

  // 与敌人蛇判定：撞到对方头 -> 死；撞到对方身体 -> 击杀
  for(let i=0;i<enemies.length;i++){
    const en=enemies[i];
    if(en.body[0].x===head.x&&en.body[0].y===head.y){ dieReason='撞上敌人蛇头'; return die(); }
    const bi=en.body.findIndex((s,si)=>si>0&&s.x===head.x&&s.y===head.y);
    if(bi>0){ snake.unshift(head); killEnemy(i,cx(head.x),cy(head.y)); draw(); return; }
  }
  // 敌人头撞到玩家身体（非头），也算玩家被偷袭致死
  for(const en of enemies){ const eh=en.body[0]; if(snake.some((s,si)=>si>0&&s.x===eh.x&&s.y===eh.y)){ dieReason='被敌人蛇偷袭'; return die(); } }

  snake.unshift(head);
  let ate=false;
  if(mainFood&&head.x===mainFood.x&&head.y===mainFood.y){ burst(cx(head.x),cy(head.y),COLORS[mainFood.type],8); applyFood(mainFood); spawnMain(); ate=true; }
  else if(coin&&head.x===coin.x&&head.y===coin.y){ burst(cx(head.x),cy(head.y),'#ffd700',16); applyCoin(); coin=null; ate=true; }
  else { const ti=timedFoods.findIndex(f=>f.x===head.x&&f.y===head.y); if(ti>=0){ burst(cx(head.x),cy(head.y),COLORS[timedFoods[ti].type],8); applyFood(timedFoods[ti]); timedFoods.splice(ti,1); ate=true; } }
  if(!ate) snake.pop();
  draw();
}

function comboBonus(){ return combo>=3?combo-2:0; }
function applyFood(f){
  const now=Date.now();
  const counts=f.type!=='poison';
  if(counts){ combo=(now-lastEatTime<1500)?combo+1:1; lastEatTime=now; } else combo=0;
  const bonus=counts?comboBonus():0;
  let gain=1, countsLevel=true, pop=0;
  switch(f.type){
    case 'double': gain=2; sSpecial(); toast('双倍 +2'); break;
    case 'speed': sSpecial(); toast('加速！'); curSpeed=Math.max(34,baseSpeed*0.6); speedBoostUntil=now+4000; restartTimer(); break;
    case 'shrink': sSpecial(); toast('缩短'); pop=4; break;
    case 'poison': gain=-3; countsLevel=false; sBad(); toast('💀 毒苹果 -3'); showFx('毒！','#c8a36a'); pop=3; shake=8; break;
    case 'mirror': sBad(); toast('🪞 镜像反转！'); showFx('镜像','#e8edf0'); mirrorUntil=now+5000; break;
    default: sEat();
  }
  score=Math.max(0,score+gain+(gain>0?bonus:0)); $('score').textContent=score;
  for(let i=0;i<pop&&snake.length>3;i++) snake.pop();
  if(bonus>0&&gain>0) showCombo();
  if(curMode==='level'&&countsLevel){ eatenInLevel++; if(eatenInLevel>=needPerLevel) nextLevel(); }
}
function applyCoin(){
  const now=Date.now(); combo=(now-lastEatTime<1500)?combo+1:1; lastEatTime=now;
  const bonus=comboBonus(); score+=5+bonus; $('score').textContent=score; sCoin(); toast('💰 金币 +5'); shake=4;
  if(bonus>0) showCombo();
  if(curMode==='level'){ eatenInLevel++; if(eatenInLevel>=needPerLevel) nextLevel(); }
}
function nextLevel(){
  level++; eatenInLevel=0; buildWalls();
  baseSpeed=Math.max(44,DIFF[curDiff].speed-level*6); curSpeed=baseSpeed; speedBoostUntil=0;
  if(mainFood&&isWall(mainFood.x,mainFood.y)) spawnMain();
  timedFoods=timedFoods.filter(f=>!isWall(f.x,f.y));
  if(level>=3&&!portals) spawnPortals();
  while(enemies.length<enemyCount()) spawnEnemy();
  $('level').textContent=level; sLevel(); toast(`进入第 ${level} 关！`); restartTimer();
}

// ====== 摄像机 + 渲染 ======
function cx(gx){ return (gx-cam.x)*CELL; } // 格->屏幕像素
function cy(gy){ return (gy-cam.y)*CELL; }
function updateCam(){
  const tx=snake[0].x-VCELLS/2+0.5, ty=snake[0].y-VCELLS/2+0.5;
  cam.x+=(tx-cam.x)*0.18; cam.y+=(ty-cam.y)*0.18; // 平滑跟随
  cam.x=Math.max(0,Math.min(MAP-VCELLS,cam.x));
  cam.y=Math.max(0,Math.min(MAP-VCELLS,cam.y));
}
function roundRect(x,y,w,h,r){ ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.fill(); }
function visible(gx,gy){ return gx>=cam.x-1&&gx<=cam.x+VCELLS+1&&gy>=cam.y-1&&gy<=cam.y+VCELLS+1; }

function drawFood(f){ if(!visible(f.x,f.y))return; ctx.fillStyle=COLORS[f.type]; const pulse=f.type!=='normal'?Math.sin(Date.now()/150)*2:Math.sin(Date.now()/300)*1; const x=cx(f.x),y=cy(f.y); roundRect(x+3-pulse,y+3-pulse,CELL-6+pulse*2,CELL-6+pulse*2,5); if(f.type==='poison'){ ctx.fillStyle='#3a2410'; ctx.fillRect(x+CELL/2-1,y+4,2,6); } }

function draw(){
  updateCam();
  const now=Date.now();
  const mirror=mirrorUntil&&now<mirrorUntil;
  ctx.save();
  if(shake>0){ ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake); shake*=0.85; if(shake<0.4)shake=0; }
  // 背景
  ctx.fillStyle=mirror?'#101430':'#0a0d20'; ctx.fillRect(-20,-20,VIEW+40,VIEW+40);
  // 网格（随摄像机偏移）
  ctx.strokeStyle='rgba(255,255,255,0.035)'; ctx.lineWidth=1;
  const ox=-(cam.x%1)*CELL, oy=-(cam.y%1)*CELL;
  for(let i=0;i<=VCELLS+1;i++){ const gx=ox+i*CELL; ctx.beginPath();ctx.moveTo(gx,0);ctx.lineTo(gx,VIEW);ctx.stroke(); const gy=oy+i*CELL; ctx.beginPath();ctx.moveTo(0,gy);ctx.lineTo(VIEW,gy);ctx.stroke(); }
  // 地图边界（暗红粗框）
  ctx.strokeStyle='rgba(255,77,109,0.5)'; ctx.lineWidth=3;
  ctx.strokeRect(cx(0),cy(0),MAP*CELL,MAP*CELL);

  // 障碍
  ctx.fillStyle='#3a3f63';
  wallSet.forEach(s=>{ const [x,y]=s.split('_').map(Number); if(!visible(x,y))return; const sx=cx(x),sy=cy(y); roundRect(sx+1,sy+1,CELL-2,CELL-2,4); ctx.fillStyle='rgba(255,255,255,0.06)'; ctx.fillRect(sx+2,sy+2,CELL-4,3); ctx.fillStyle='#3a3f63'; });

  // 传送门
  if(portals) portals.forEach((p,i)=>{ if(!visible(p.x,p.y))return; const X=cx(p.x)+CELL/2,Y=cy(p.y)+CELL/2; const g=ctx.createRadialGradient(X,Y,1,X,Y,CELL/1.3); g.addColorStop(0,'#cffaff'); g.addColorStop(1,i?'#0088cc':'#00d4ff'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(X,Y,CELL/2-2+Math.sin(now/200)*2,0,7); ctx.fill(); });

  // 金币
  if(coin&&visible(coin.x,coin.y)){ const left=coin.expire-now; if(!(left<2000&&Math.floor(now/150)%2===0)){ const X=cx(coin.x)+CELL/2,Y=cy(coin.y)+CELL/2; ctx.fillStyle='#ffd700'; ctx.beginPath(); ctx.arc(X,Y,CELL/2-3,0,7); ctx.fill(); ctx.fillStyle='#b8860b'; ctx.font='bold 14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('$',X,Y+1); } }

  if(mainFood) drawFood(mainFood);
  timedFoods.forEach(f=>{ const left=f.expire-now; if(left<2000&&Math.floor(now/150)%2===0) return; drawFood(f); });

  // 敌人蛇
  enemies.forEach(en=>{ en.body.forEach((s,i)=>{ if(!visible(s.x,s.y))return; const sx=cx(s.x),sy=cy(s.y); ctx.fillStyle=i===0?'#ff5c8a':'#c4406a'; roundRect(sx+1,sy+1,CELL-2,CELL-2,4); if(i===0){ ctx.fillStyle='#fff'; ctx.fillRect(sx+6,sy+6,3,3); ctx.fillRect(sx+CELL-9,sy+6,3,3); } }); });

  // 玩家蛇
  snake.forEach((s,i)=>{ if(!visible(s.x,s.y))return; const sx=cx(s.x),sy=cy(s.y); let c=i===0?(speedBoostUntil?'#5b9dff':(mirror?'#e8edf0':'#4ecca3')):'#36b390'; ctx.fillStyle=c; roundRect(sx+1,sy+1,CELL-2,CELL-2,4); if(i===0){ ctx.fillStyle='#062018'; ctx.fillRect(sx+6,sy+6,3,3); ctx.fillRect(sx+CELL-9,sy+6,3,3); } });

  // 粒子
  particles.forEach(p=>{ p.x+=p.vx; p.y+=p.vy; p.vy+=0.12; p.life-=0.035; ctx.globalAlpha=Math.max(0,p.life); ctx.fillStyle=p.color; ctx.fillRect(p.x-2,p.y-2,4,4); });
  ctx.globalAlpha=1; particles=particles.filter(p=>p.life>0);

  if(mirror){ ctx.fillStyle='rgba(232,237,240,0.05)'; ctx.fillRect(0,0,VIEW,VIEW); }
  ctx.restore();

  // 小地图
  drawMinimap();
}

function drawMinimap(){
  const S=70, pad=8, scale=S/MAP;
  const ox=VIEW-S-pad, oy=pad;
  ctx.save();
  ctx.globalAlpha=0.8; ctx.fillStyle='rgba(0,0,0,0.5)'; roundRect(ox-3,oy-3,S+6,S+6,6);
  ctx.fillStyle='rgba(58,63,99,0.8)'; wallSet.forEach(s=>{ const [x,y]=s.split('_').map(Number); ctx.fillRect(ox+x*scale,oy+y*scale,scale+0.5,scale+0.5); });
  if(mainFood){ ctx.fillStyle='#ff4d6d'; ctx.fillRect(ox+mainFood.x*scale,oy+mainFood.y*scale,2,2); }
  enemies.forEach(en=>{ ctx.fillStyle='#ff5c8a'; ctx.fillRect(ox+en.body[0].x*scale,oy+en.body[0].y*scale,2,2); });
  ctx.fillStyle='#4ecca3'; ctx.fillRect(ox+snake[0].x*scale,oy+snake[0].y*scale,2,2);
  ctx.strokeStyle='rgba(78,204,163,0.6)'; ctx.lineWidth=1; ctx.strokeRect(ox+cam.x*scale,oy+cam.y*scale,VCELLS*scale,VCELLS*scale);
  ctx.restore();
}

// ====== 结束/续命/流程 ======
let pendingEntry=null;
function fmtDate(){ const d=new Date(); return `${d.getMonth()+1}/${d.getDate()}`; }
function die(){
  clearInterval(timer); running=false; sDie(); shake=14; burst(cx(snake[0].x),cy(snake[0].y),'#4ecca3',24);
  $('reviveBtn').style.display=usedRevive?'none':'block';
  const best=getBest(); const isNew=score>best; if(isNew) setBest(score);
  $('goTitle').textContent=isNew?'🎉 新纪录！':'游戏结束';
  $('goSub').textContent=`${dieReason?dieReason+'　':''}得分 ${score}　击杀 ${kills}　最高 ${getBest()}`;
  $('nameBox').style.display=isNew?'block':'none'; if(isNew) $('nameInput').value='';
  pendingEntry={ score, mode:MODE_NAME[curMode], level:curMode==='level'?level:0, date:fmtDate(), name:'' };
  refreshStatsUI(); $('gameover').classList.remove('hidden');
}
function revive(){ usedRevive=true; $('gameover').classList.add('hidden'); snake=snake.slice(0,3); if(snake.length<3){ const sx=MAP/2|0,sy=MAP/2|0; snake=[{x:sx,y:sy},{x:sx-1,y:sy},{x:sx-2,y:sy}]; } dir={x:1,y:0}; nextDir={x:1,y:0}; speedBoostUntil=0; mirrorUntil=0; curSpeed=baseSpeed; running=true; paused=false; pendingEntry=null; toast('❤️ 复活！'); restartTimer(); }
function commitEntry(){ if(!pendingEntry) return; if($('nameBox').style.display!=='none') pendingEntry.name=($('nameInput').value.trim()||'无名英雄'); addHist(pendingEntry); uploadScore(pendingEntry.name,pendingEntry.score,pendingEntry.mode); pendingEntry=null; }

function startGame(){ if(actx&&actx.state==='suspended') actx.resume(); reset(); running=true; paused=false; $('pauseBtn').textContent='暂停'; $('menu').classList.add('hidden'); $('gameover').classList.add('hidden'); $('dpad').classList.toggle('on',useDpad); refreshStatsUI(); draw(); restartTimer(); }
function togglePause(){ if(!running) return; paused=!paused; $('pauseBtn').textContent=paused?'继续':'暂停'; }
function openMenu(){ commitEntry(); clearInterval(timer); running=false; $('dpad').classList.remove('on'); refreshBoard(); refreshStatsUI(); $('gameover').classList.add('hidden'); $('menu').classList.remove('hidden'); }
function setDir(x,y){ if(mirrorUntil&&Date.now()<mirrorUntil){ x=-x; y=-y; } if(dir.x===-x&&dir.y===-y) return; if(dir.x===x&&dir.y===y) return; nextDir={x,y}; }

// 控制
document.addEventListener('keydown',e=>{ const map={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0],w:[0,-1],s:[0,1],a:[-1,0],d:[1,0],W:[0,-1],S:[0,1],A:[-1,0],D:[1,0]}; if(e.key===' '){ e.preventDefault(); togglePause(); return; } if(map[e.key]){ e.preventDefault(); setDir(...map[e.key]); } });
let touchStart=null;
canvas.addEventListener('touchstart',e=>{ touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY}; },{passive:true});
canvas.addEventListener('touchmove',e=>{ if(!touchStart)return; const dx=e.touches[0].clientX-touchStart.x,dy=e.touches[0].clientY-touchStart.y; if(Math.abs(dx)<18&&Math.abs(dy)<18)return; if(Math.abs(dx)>Math.abs(dy)) setDir(dx>0?1:-1,0); else setDir(0,dy>0?1:-1); touchStart=null; },{passive:true});
$('dpad').addEventListener('click',e=>{ const b=e.target.closest('button[data-dir]'); if(!b)return; const [x,y]=b.dataset.dir.split(',').map(Number); setDir(x,y); });

$('modeSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return; curMode=b.dataset.m; [...e.currentTarget.children].forEach(c=>c.classList.toggle('active',c===b)); refreshStatsUI(); });
$('diffSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return; curDiff=b.dataset.d; [...e.currentTarget.children].forEach(c=>c.classList.toggle('active',c===b)); });
$('dpadChk').addEventListener('change',e=>useDpad=e.target.checked);
$('startBtn').addEventListener('click',startGame);
$('againBtn').addEventListener('click',()=>{ commitEntry(); startGame(); });
$('reviveBtn').addEventListener('click',revive);
$('backBtn').addEventListener('click',openMenu);
$('pauseBtn').addEventListener('click',togglePause);
$('restartBtn').addEventListener('click',()=>{ commitEntry(); startGame(); });
$('menuBtn').addEventListener('click',openMenu);
$('clearBtn').addEventListener('click',()=>{ localStorage.removeItem(KEY_HIST); renderHistory(); });
$('tabLocal').addEventListener('click',()=>{ currentTab='local'; $('tabLocal').classList.add('active'); $('tabGlobal').classList.remove('active'); renderHistory(); });
$('tabGlobal').addEventListener('click',()=>{ currentTab='global'; $('tabGlobal').classList.add('active'); $('tabLocal').classList.remove('active'); renderGlobal(); });
$('helpBtn').addEventListener('click',()=>$('help').classList.remove('hidden'));
$('helpBtn2').addEventListener('click',()=>$('help').classList.remove('hidden'));
$('helpClose').addEventListener('click',()=>$('help').classList.add('hidden'));

// 持续渲染（动画/摄像机平滑）
setInterval(()=>{ if(running&&!paused) draw(); },1000/40);

// PWA
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); deferredPrompt=e; $('installBtn').style.display='inline-block'; });
$('installBtn').addEventListener('click',async()=>{ if(!deferredPrompt){ toast('浏览器菜单选「添加到主屏幕」'); return; } deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $('installBtn').style.display='none'; });
window.addEventListener('appinstalled',()=>{ $('installBtn').style.display='none'; toast('已安装到桌面'); });
if('serviceWorker' in navigator){ window.addEventListener('load',()=>{ navigator.serviceWorker.register('./sw.js').catch(()=>{}); }); }

refreshStatsUI(); renderHistory();
</script>
</body>
</html>
