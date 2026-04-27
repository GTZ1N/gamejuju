'use strict';

const GAME_DURATION    = 60;
const PHASE2_START     = 30;
const URGENT_TIME      = 10;
const FRICTION         = 0.87;
const PLAYER_SPEED     = 4.5;
const PLAYER_ACCEL     = 0.9;
const KICK_POWER       = 14;
const BALL_FRICTION    = 0.955;
const BALL_WALL_BOUNCE = 0.7;
const PLAYER_RADIUS    = 26;
const BALL_RADIUS      = 11;
const TARGET_RADIUS    = 22;
const HUD_HEIGHT       = 80;

let canvas, ctx, W, H, animId;
let gameState = 'menu';
let score1 = 0, score2 = 0, timeLeft = GAME_DURATION;
let lastTimestamp = 0, timerAccum = 0, phase = 1;
let shakeX = 0, shakeY = 0, shakeDuration = 0;
let particles = [], flashAlpha = 0, flashColor = '#ffffff';
let player1, player2, ball1, ball2, target1, target2;
let cooldown1 = 0, cooldown2 = 0;

let audioCtx;
let crowdGainNode = null, crowdBufferSource = null, crowdLevel = 0;
let volJogo    = 1.0;
let volTorcida = 0.7;
let volKick    = 1.0;

function initAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { return; }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  initCrowd();
}

function initCrowd() {
  if (!audioCtx || crowdBufferSource) return;
  const sr  = audioCtx.sampleRate;
  const buf = audioCtx.createBuffer(2, sr * 4, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  crowdBufferSource = audioCtx.createBufferSource();
  crowdBufferSource.buffer = buf;
  crowdBufferSource.loop = true;
  const hpf  = audioCtx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 100; hpf.Q.value = 0.6;
  const lpf  = audioCtx.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = 2000; lpf.Q.value = 0.8;
  const peak = audioCtx.createBiquadFilter();
  peak.type = 'peaking'; peak.frequency.value = 380; peak.Q.value = 0.5; peak.gain.value = 12;
  crowdGainNode = audioCtx.createGain();
  crowdGainNode.gain.value = 0;
  crowdBufferSource.connect(hpf);
  hpf.connect(lpf);
  lpf.connect(peak);
  peak.connect(crowdGainNode);
  crowdGainNode.connect(audioCtx.destination);
  crowdBufferSource.start();
}

function _setCrowdGain(ramp) {
  if (!crowdGainNode || !audioCtx) return;
  const target = Math.max(0, crowdLevel * volTorcida);
  crowdGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
  crowdGainNode.gain.setValueAtTime(crowdGainNode.gain.value, audioCtx.currentTime);
  crowdGainNode.gain.linearRampToValueAtTime(target, audioCtx.currentTime + ramp);
}

function startCrowd()  { crowdLevel = 0.15; _setCrowdGain(1.8); }
function stopCrowd()   { crowdLevel = 0;    _setCrowdGain(0.6); }

function crowdCheer() {
  if (!crowdGainNode || volTorcida <= 0) return;
  crowdLevel = 0.55;
  _setCrowdGain(0.08);
  setTimeout(() => { if (crowdLevel > 0.14) { crowdLevel = 0.15; _setCrowdGain(2.5); } }, 3200);
}

function crowdPhase2() {
  if (crowdLevel <= 0) return;
  crowdLevel = 0.35; _setCrowdGain(0.3);
  setTimeout(() => { if (crowdLevel > 0.14) { crowdLevel = 0.15; _setCrowdGain(2.2); } }, 2800);
}

function crowdUrgent() {
  if (crowdLevel > 0 && crowdLevel < 0.28) { crowdLevel = 0.28; _setCrowdGain(0.5); }
}

function playKick() {
  if (!audioCtx || volKick <= 0) return;
  const ac = audioCtx, now = ac.currentTime, v = volKick;
  const o1 = ac.createOscillator(), g1 = ac.createGain();
  o1.connect(g1); g1.connect(ac.destination);
  o1.type = 'sine';
  o1.frequency.setValueAtTime(140, now);
  o1.frequency.exponentialRampToValueAtTime(42, now + 0.13);
  g1.gain.setValueAtTime(0.48 * v, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  o1.start(now); o1.stop(now + 0.16);
  const o2 = ac.createOscillator(), g2 = ac.createGain();
  o2.connect(g2); g2.connect(ac.destination);
  o2.type = 'triangle';
  o2.frequency.setValueAtTime(950, now);
  o2.frequency.exponentialRampToValueAtTime(190, now + 0.06);
  g2.gain.setValueAtTime(0.22 * v, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  o2.start(now); o2.stop(now + 0.08);
  try {
    const nb = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.04), ac.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
    const ns = ac.createBufferSource(), ng = ac.createGain(), nf = ac.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 2200; nf.Q.value = 1.8;
    ns.buffer = nb; ns.connect(nf); nf.connect(ng); ng.connect(ac.destination);
    ng.gain.setValueAtTime(0.30 * v, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    ns.start(now); ns.stop(now + 0.05);
  } catch(e) {}
}

function playGoal() {
  if (!audioCtx) return;
  const ac = audioCtx, v = volJogo;
  if (v > 0) {
    [523, 659, 784, 1047].forEach((freq, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, ac.currentTime + i * 0.1);
      g.gain.linearRampToValueAtTime(0.25 * v, ac.currentTime + i * 0.1 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i * 0.1 + 0.28);
      o.start(ac.currentTime + i * 0.1);
      o.stop(ac.currentTime + i * 0.1 + 0.3);
    });
  }
  crowdCheer();
}

function playWhistle() {
  if (!audioCtx || volJogo <= 0) return;
  const ac = audioCtx, v = volJogo;
  const o = ac.createOscillator(), g = ac.createGain();
  o.connect(g); g.connect(ac.destination);
  o.type = 'sine';
  o.frequency.setValueAtTime(1200, ac.currentTime);
  o.frequency.setValueAtTime(900, ac.currentTime + 0.3);
  g.gain.setValueAtTime(0.38 * v, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.55);
  o.start(); o.stop(ac.currentTime + 0.6);
}

function playBeep() {
  if (!audioCtx || volJogo <= 0) return;
  const ac = audioCtx, v = volJogo;
  const o = ac.createOscillator(), g = ac.createGain();
  o.connect(g); g.connect(ac.destination);
  o.type = 'sine'; o.frequency.value = 880;
  g.gain.setValueAtTime(0.3 * v, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
  o.start(); o.stop(ac.currentTime + 0.2);
}

function playVictory() {
  if (!audioCtx || volJogo <= 0) return;
  const ac = audioCtx, v = volJogo;
  const f = [523,523,523,415,523,0,659,659,659,523,659,784], d = 0.12;
  f.forEach((freq, i) => {
    if (!freq) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.2 * v, ac.currentTime + i * d);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i * d + d * 0.9);
    o.start(ac.currentTime + i * d);
    o.stop(ac.currentTime + i * d + d);
  });
}

function playSound(type) {
  if      (type === 'kick')    playKick();
  else if (type === 'goal')    playGoal();
  else if (type === 'whistle') playWhistle();
  else if (type === 'beep')    playBeep();
  else if (type === 'victory') playVictory();
}

function hexToRgba(hex, alpha) {
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function lighten(hex, n) {
  return `rgb(${Math.min(255,parseInt(hex.slice(1,3),16)+n)},${Math.min(255,parseInt(hex.slice(3,5),16)+n)},${Math.min(255,parseInt(hex.slice(5,7),16)+n)})`;
}
function darken(hex, n) {
  return `rgb(${Math.max(0,parseInt(hex.slice(1,3),16)-n)},${Math.max(0,parseInt(hex.slice(3,5),16)-n)},${Math.max(0,parseInt(hex.slice(5,7),16)-n)})`;
}
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function getFieldLayout() {
  const margin = 60;
  const goalW  = 22;
  const goalH  = Math.min(H * 0.38, 160);
  const postT  = 6;
  return {
    left:   margin + goalW,
    right:  W - margin - goalW,
    top:    margin * 0.9,
    bottom: H - margin * 0.9,
    get fieldW() { return this.right - this.left; },
    get fieldH() { return this.bottom - this.top; },
    get cx()     { return (this.left + this.right) / 2; },
    get cy()     { return (this.top + this.bottom) / 2; },
    goalW, goalH, margin, postT,
    get goalLeftX()  { return margin; },
    get goalRightX() { return W - margin; },
  };
}

function drawRealisticGoal(ctx, anchorX, cy, goalW, goalH, color, side) {
  const halfH = goalH / 2;
  const postT  = 6;
  const netCol = 'rgba(255,255,255,0.18)';
  const netColDark = 'rgba(255,255,255,0.07)';
  const mouthX = anchorX;
  const backX  = side === 'left' ? anchorX - goalW : anchorX + goalW;
  const topY   = cy - halfH;
  const botY   = cy + halfH;
  const netFill = ctx.createLinearGradient(mouthX, cy, backX, cy);
  netFill.addColorStop(0, 'rgba(0,0,0,0.50)');
  netFill.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = netFill;
  ctx.fillRect(side === 'left' ? backX : mouthX, topY, goalW, goalH);
  ctx.strokeStyle = netCol; ctx.lineWidth = 0.8;
  const netRows = 10;
  for (let r = 0; r <= netRows; r++) {
    const ny = topY + (r / netRows) * goalH;
    ctx.beginPath(); ctx.moveTo(Math.min(mouthX, backX), ny); ctx.lineTo(Math.max(mouthX, backX), ny); ctx.stroke();
  }
  const netCols = 7;
  for (let c = 0; c <= netCols; c++) {
    const xb = side === 'left' ? mouthX - (c / netCols) * goalW : mouthX + (c / netCols) * goalW;
    ctx.strokeStyle = netCol; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(xb, topY); ctx.lineTo(xb, botY); ctx.stroke();
  }
  ctx.strokeStyle = netColDark; ctx.lineWidth = 0.5;
  const diagSteps = 8;
  for (let d = 0; d <= diagSteps; d++) {
    const yPos = topY + (d / diagSteps) * goalH;
    ctx.beginPath(); ctx.moveTo(mouthX, yPos); ctx.lineTo(backX, yPos); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  if (side === 'left') ctx.fillRect(backX - postT * 0.5, topY, postT * 0.8, goalH);
  else ctx.fillRect(backX - postT * 0.3, topY, postT * 0.8, goalH);
  function drawPost(x1, y1, x2, y2, isVertical) {
    const px = Math.min(x1, x2), py = Math.min(y1, y2);
    const pw = Math.abs(x2 - x1) || postT, ph = Math.abs(y2 - y1) || postT;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(px + 2, py + 2, pw, ph);
    let postGrad;
    if (isVertical) postGrad = ctx.createLinearGradient(px, py, px + pw, py);
    else postGrad = ctx.createLinearGradient(px, py, px, py + ph);
    postGrad.addColorStop(0, '#ffffff'); postGrad.addColorStop(0.3, '#e8e8e8');
    postGrad.addColorStop(0.7, '#c0c0c0'); postGrad.addColorStop(1, '#989898');
    ctx.fillStyle = postGrad; ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    if (isVertical) ctx.fillRect(px, py, pw * 0.3, ph);
    else ctx.fillRect(px, py, pw, ph * 0.3);
    ctx.strokeStyle = hexToRgba(color, 0.35); ctx.lineWidth = 1.5; ctx.strokeRect(px, py, pw, ph);
  }
  drawPost(mouthX - postT, topY - postT, mouthX, botY + postT, true);
  drawPost(Math.min(mouthX, backX) - postT, topY - postT, Math.max(mouthX, backX) + postT, topY, false);
  const gg = ctx.createRadialGradient(
    side === 'left' ? mouthX - goalW * 0.5 : mouthX + goalW * 0.5, cy, 0,
    side === 'left' ? mouthX - goalW * 0.5 : mouthX + goalW * 0.5, cy, goalH * 0.8
  );
  gg.addColorStop(0, hexToRgba(color, 0.18)); gg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gg;
  ctx.fillRect(Math.min(mouthX, backX) - 10, topY - 20, goalW + 20, goalH + 40);
}

class Target {
  constructor(x, y, color) {
    this.x = x; this.baseY = y; this.y = y;
    this.color = color; this.radius = TARGET_RADIUS;
    this.hitFlash = 0; this.pulsePhase = Math.random() * Math.PI * 2; this.moveOffset = 0;
  }
  update(timeLeft) {
    this.pulsePhase += 0.05;
    if (timeLeft <= PHASE2_START) {
      const progress = 1 - (timeLeft / PHASE2_START);
      const speed = 0.8 + progress * 2.5, range = 28 + progress * 55;
      this.moveOffset += speed * 0.02;
      this.y = this.baseY + Math.sin(this.moveOffset) * range;
    } else { this.y = this.baseY; this.moveOffset = 0; }
    if (this.hitFlash > 0) this.hitFlash--;
  }
  checkHit(ball) {
    return Math.hypot(ball.x - this.x, ball.y - this.y) < this.radius + ball.radius * 0.6;
  }
  draw(ctx) {
    const pulse = 1 + Math.sin(this.pulsePhase) * 0.05;
    const r = this.radius * pulse, hit = this.hitFlash > 0;
    const cx = this.x, cy = this.y;
    ctx.fillStyle = '#555'; ctx.fillRect(cx - 2, cy - r - 14, 4, 14);
    ctx.fillStyle = '#777'; ctx.fillRect(cx - 1, cy - r - 14, 2, 14);
    ctx.fillStyle = '#444'; ctx.beginPath(); ctx.arc(cx, cy - r - 14, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#888'; ctx.beginPath(); ctx.arc(cx, cy - r - 14, 2.5, 0, Math.PI*2); ctx.fill();
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 12; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 4;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fillStyle = '#111'; ctx.fill(); ctx.restore();
    const boardGrad = ctx.createRadialGradient(cx-r*0.3, cy-r*0.3, 0, cx, cy, r);
    boardGrad.addColorStop(0, '#5a3a1a'); boardGrad.addColorStop(0.6, '#3d2510'); boardGrad.addColorStop(1, '#2a1808');
    ctx.fillStyle = boardGrad; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
    const ringColors = hit
      ? ['#fff','#ffd700','#fff','#ffd700','#fff']
      : [this.color, '#fff', this.color, '#fff', this.color];
    const radii = [r*0.98, r*0.78, r*0.58, r*0.38, r*0.20];
    for (let i = 0; i < radii.length; i++) {
      const ringR = radii[i];
      const rg = ctx.createRadialGradient(cx - ringR*0.2, cy - ringR*0.2, 0, cx, cy, ringR);
      const c = ringColors[i];
      rg.addColorStop(0, lighten(c === '#fff' ? '#dddddd' : c, 30));
      rg.addColorStop(0.6, c);
      rg.addColorStop(1, darken(c === '#fff' ? '#cccccc' : c, 20));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI*2); ctx.stroke();
    }
    const dotGrad = ctx.createRadialGradient(cx-2, cy-2, 0, cx, cy, r*0.20);
    dotGrad.addColorStop(0, '#fff');
    dotGrad.addColorStop(0.5, hit ? '#ffd700' : this.color);
    dotGrad.addColorStop(1, darken(hit ? '#ffd700' : this.color, 30));
    ctx.fillStyle = dotGrad; ctx.beginPath(); ctx.arc(cx, cy, r*0.20, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    for (const ringR of radii) { ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI*2); ctx.stroke(); }
    const sheen = ctx.createRadialGradient(cx - r*0.35, cy - r*0.4, 0, cx - r*0.1, cy - r*0.1, r*0.75);
    sheen.addColorStop(0, 'rgba(255,255,255,0.22)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0.06)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
    const glowA = hit ? 0.6 : (0.15 + Math.sin(this.pulsePhase) * 0.08);
    const glow = ctx.createRadialGradient(cx, cy, r*0.8, cx, cy, r*2.2);
    glow.addColorStop(0, hexToRgba(this.color, glowA)); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, r*2.2, 0, Math.PI*2); ctx.fill();
    if (hit) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI*2); ctx.stroke();
    }
  }
}

function drawChibiPlayer(ctx, cx, cy, jerseyColor, walkT, facingRight, playerId, isKicking) {
  ctx.save(); ctx.translate(cx, cy);
  const flip = facingRight ? 1 : -1;
  const headR=19, bodyH=22, bodyW=15, legLen=20, neckH=3;
  const bodyTop=-(bodyH+neckH), bodyBot=-neckH, hipY=bodyBot;
  const headY=-(bodyH+neckH+headR);
  const legSwingR = isKicking ? 0 : Math.sin(walkT)*(18*Math.PI/180);
  ctx.save(); ctx.scale(1,0.3);
  const sg=ctx.createRadialGradient(0,legLen*3.2,0,0,legLen*3.2,22);
  sg.addColorStop(0,'rgba(0,0,0,0.45)'); sg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=sg; ctx.beginPath(); ctx.ellipse(0,legLen*3.2,22,22,0,0,Math.PI*2); ctx.fill(); ctx.restore();
  drawChibiLeg(ctx,flip,-6,hipY,legLen,jerseyColor,-legSwingR*0.7,false);
  drawChibiLeg(ctx,flip,6,hipY,legLen,jerseyColor,isKicking?-0.9*flip:legSwingR,true);
  const jg=ctx.createLinearGradient(-bodyW,bodyTop,bodyW,bodyBot);
  jg.addColorStop(0,lighten(jerseyColor,40)); jg.addColorStop(0.5,jerseyColor); jg.addColorStop(1,darken(jerseyColor,30));
  ctx.fillStyle=jg;
  ctx.beginPath();
  ctx.moveTo(-bodyW+5,bodyTop); ctx.lineTo(bodyW-5,bodyTop); ctx.quadraticCurveTo(bodyW,bodyTop,bodyW,bodyTop+5);
  ctx.lineTo(bodyW,bodyBot-5); ctx.quadraticCurveTo(bodyW,bodyBot,bodyW-5,bodyBot);
  ctx.lineTo(-bodyW+5,bodyBot); ctx.quadraticCurveTo(-bodyW,bodyBot,-bodyW,bodyBot-5);
  ctx.lineTo(-bodyW,bodyTop+5); ctx.quadraticCurveTo(-bodyW,bodyTop,-bodyW+5,bodyTop);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.ellipse(0,bodyTop+3,6,4,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.ellipse(-4,bodyTop+7,4,7,-0.3,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#f5c5a0'; ctx.fillRect(-4,bodyTop-neckH,8,neckH);
  drawChibiArms(ctx,flip,bodyW,bodyTop,bodyH,walkT,jerseyColor,isKicking);
  drawChibiHead(ctx,0,headY,headR,playerId,jerseyColor);
  ctx.restore();
}
function drawChibiLeg(ctx,flip,xOff,hipY,legLen,jerseyColor,angle,isFront){
  ctx.save(); ctx.translate(xOff*flip,hipY); ctx.rotate(angle);
  ctx.fillStyle=darken(jerseyColor,50); ctx.beginPath(); ctx.roundRect(-5,0,10,9,3); ctx.fill();
  ctx.fillStyle='#f5c095'; ctx.beginPath(); ctx.roundRect(-4,8,8,12,2); ctx.fill();
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.roundRect(-4,17,8,5,1); ctx.fill();
  ctx.fillStyle='#18182e'; ctx.beginPath(); ctx.ellipse(flip*2,legLen+1,9,5,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.ellipse(flip*2,legLen,5.5,2.5,0,0,Math.PI*2); ctx.fill();
  ctx.restore();
}
function drawChibiHead(ctx,x,y,r,playerId,jerseyColor){
  const skinColor=playerId===1?'#fcd5a8':'#f5bc90';
  const sg=ctx.createRadialGradient(x-4,y-5,2,x,y,r);
  sg.addColorStop(0,'#fff8f0'); sg.addColorStop(0.5,skinColor); sg.addColorStop(1,darken(skinColor,20));
  ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=skinColor; ctx.beginPath(); ctx.ellipse(x,y+r*0.3,r*0.78,r*0.55,0,0,Math.PI*2); ctx.fill();
  if(playerId===1){
    ctx.fillStyle='#1e0f02'; ctx.beginPath(); ctx.arc(x,y-2,r*0.97,Math.PI,Math.PI*2); ctx.fill();
    ctx.fillStyle='#2a1a04';
    [[-12,-r+1,-15,-r-11,-7,-r-1],[-5,-r-1,-7,-r-14,2,-r-3],[3,-r-1,3,-r-14,11,-r-2],[9,-r+1,13,-r-11,16,-r]].forEach(([x1,y1,mx,my,x2,y2])=>{
      ctx.beginPath(); ctx.moveTo(x+x1,y+y1); ctx.quadraticCurveTo(x+mx,y+my,x+x2,y+y2); ctx.lineTo(x+x2,y+y1); ctx.closePath(); ctx.fill();
    });
    ctx.fillStyle='#1e0f02';
    ctx.beginPath(); ctx.ellipse(x-r+2,y,5,8,-0.2,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x+r-2,y,5,8,0.2,0,Math.PI*2); ctx.fill();
  } else {
    ctx.fillStyle='#7a1500'; ctx.beginPath(); ctx.arc(x,y-2,r*0.97,Math.PI,Math.PI*2); ctx.fill();
    ctx.fillStyle='#9a2000';
    ctx.beginPath(); ctx.moveTo(x-r*0.7,y-r*0.4); ctx.quadraticCurveTo(x+2,y-r*1.25,x+r*0.92,y-r*0.5);
    ctx.quadraticCurveTo(x+r*0.5,y-r*0.3,x-r*0.3,y-r*0.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#7a1500';
    ctx.beginPath(); ctx.ellipse(x-r+3,y-2,5,9,-0.15,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x+r-3,y-2,5,9,0.15,0,Math.PI*2); ctx.fill();
  }
  ctx.fillStyle='#fff';
  ctx.beginPath(); ctx.ellipse(x-6,y-1,5,6.5,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x+6,y-1,5,6.5,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=playerId===1?'#1655a0':'#8b1a00';
  ctx.beginPath(); ctx.ellipse(x-6,y,3.5,5,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x+6,y,3.5,5,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#080808';
  ctx.beginPath(); ctx.arc(x-5.5,y,2.2,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x+6.5,y,2.2,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(x-4.5,y-1.5,1.2,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x+7.5,y-1.5,1.2,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#1e0f02'; ctx.lineWidth=1.8;
  ctx.beginPath(); ctx.arc(x-6,y-1,5,-Math.PI*0.85,-Math.PI*0.15); ctx.stroke();
  ctx.beginPath(); ctx.arc(x+6,y-1,5,-Math.PI*0.85,-Math.PI*0.15); ctx.stroke();
  ctx.fillStyle=darken(skinColor,15); ctx.beginPath(); ctx.ellipse(x,y+5,2.5,1.8,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#c07050'; ctx.lineWidth=1.8; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(x,y+8,5,0.2,Math.PI-0.2); ctx.stroke();
  ctx.fillStyle='rgba(255,110,110,0.22)';
  ctx.beginPath(); ctx.ellipse(x-10,y+5,4.5,3,0,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x+10,y+5,4.5,3,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=skinColor;
  ctx.beginPath(); ctx.ellipse(x-r+1,y+2,4,5.5,0.2,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x+r-1,y+2,4,5.5,-0.2,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#1e0f02'; ctx.lineWidth=2; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(x-10,y-8); ctx.quadraticCurveTo(x-6,y-10,x-2,y-8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+2,y-8); ctx.quadraticCurveTo(x+6,y-10,x+10,y-8); ctx.stroke();
}
function drawChibiArms(ctx,flip,bodyW,bodyTop,bodyH,walkT,jerseyColor,isKicking){
  const armSwing=Math.sin(walkT+Math.PI)*0.4, skin='#f5c095';
  ctx.save(); ctx.translate(-bodyW*flip,bodyTop+5); ctx.rotate(isKicking?-0.8:armSwing);
  ctx.fillStyle=jerseyColor; ctx.beginPath(); ctx.roundRect(-4,0,7,14,3); ctx.fill();
  ctx.fillStyle=skin; ctx.beginPath(); ctx.ellipse(0,16,4,4,0,0,Math.PI*2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(bodyW*flip,bodyTop+5); ctx.rotate(isKicking?0.5:-armSwing);
  ctx.fillStyle=jerseyColor; ctx.beginPath(); ctx.roundRect(-3,0,7,14,3); ctx.fill();
  ctx.fillStyle=skin; ctx.beginPath(); ctx.ellipse(0,16,4,4,0,0,Math.PI*2); ctx.fill(); ctx.restore();
}

class Player {
  constructor(id, color, x, y, keys, zoneLeft, zoneRight) {
    this.id=id; this.color=color; this.x=x; this.y=y;
    this.vx=0; this.vy=0; this.keys=keys;
    this.kickCooldown=0; this.walkCycle=0; this.radius=PLAYER_RADIUS;
    this.facingRight=(id===1); this.isKicking=false; this.kickAnim=0;
    this.zoneLeft=zoneLeft; this.zoneRight=zoneRight;
  }
  update(dt, fieldBounds) {
    const top=fieldBounds.top, bottom=fieldBounds.bottom;
    let ax=0,ay=0;
    if(keysDown[this.keys.left])  ax-=PLAYER_ACCEL;
    if(keysDown[this.keys.right]) ax+=PLAYER_ACCEL;
    if(keysDown[this.keys.up])    ay-=PLAYER_ACCEL;
    if(keysDown[this.keys.down])  ay+=PLAYER_ACCEL;
    this.vx=(this.vx+ax)*FRICTION; this.vy=(this.vy+ay)*FRICTION;
    const spd=Math.hypot(this.vx,this.vy);
    if(spd>PLAYER_SPEED){this.vx=this.vx/spd*PLAYER_SPEED; this.vy=this.vy/spd*PLAYER_SPEED;}
    this.x+=this.vx; this.y+=this.vy;
    this.x=Math.max(this.zoneLeft+this.radius, Math.min(this.zoneRight-this.radius, this.x));
    this.y=Math.max(top+this.radius, Math.min(bottom-this.radius, this.y));
    if(ax>0.05) this.facingRight=true;
    if(ax<-0.05) this.facingRight=false;
    if(spd>0.3) this.walkCycle+=0.18;
    if(this.kickCooldown>0) this.kickCooldown--;
    if(this.isKicking){this.kickAnim--; if(this.kickAnim<=0)this.isKicking=false;}
  }
  tryKick(ball) {
    if(this.kickCooldown>0) return false;
    const dx=ball.x-this.x, dy=ball.y-this.y, dist=Math.hypot(dx,dy);
    if(dist<this.radius+ball.radius+14){
      const nx=dist>0?dx/dist:1, ny=dist>0?dy/dist:0;
      ball.vx=nx*KICK_POWER+this.vx*0.5;
      ball.vy=ny*KICK_POWER+this.vy*0.5;
      ball.spin=(nx+ny)*0.3;
      this.kickCooldown=20; this.isKicking=true; this.kickAnim=15;
      if(dx>0) this.facingRight=true; else this.facingRight=false;
      spawnKickParticles(ball.x,ball.y,this.color);
      playSound('kick'); return true;
    }
    return false;
  }
  draw(ctx) {
    drawChibiPlayer(ctx,this.x,this.y,this.color,this.walkCycle,this.facingRight,this.id,this.isKicking);
  }
}

class Ball {
  constructor(x,y,color,zoneLeft,zoneRight){
    this.x=x;this.y=y;this.vx=0;this.vy=0;this.spin=0;this.angle=0;
    this.color=color;this.radius=BALL_RADIUS;this.trail=[];
    this.zoneLeft=zoneLeft; this.zoneRight=zoneRight;
  }
  reset(x,y){this.x=x;this.y=y;this.vx=0;this.vy=0;this.spin=0;this.angle=0;this.trail=[];}
  update(fieldBounds){
    this.trail.push({x:this.x,y:this.y});
    if(this.trail.length>10) this.trail.shift();
    this.vx*=BALL_FRICTION; this.vy*=BALL_FRICTION;
    this.angle+=this.spin; this.spin*=0.95;
    this.x+=this.vx; this.y+=this.vy;
    const top=fieldBounds.top, bottom=fieldBounds.bottom;
    if(this.x-this.radius<this.zoneLeft){this.x=this.zoneLeft+this.radius;this.vx*=-BALL_WALL_BOUNCE;}
    if(this.x+this.radius>this.zoneRight){this.x=this.zoneRight-this.radius;this.vx*=-BALL_WALL_BOUNCE;}
    if(this.y-this.radius<top){this.y=top+this.radius;this.vy*=-BALL_WALL_BOUNCE;}
    if(this.y+this.radius>bottom){this.y=bottom-this.radius;this.vy*=-BALL_WALL_BOUNCE;}
  }
  draw(ctx){
    for(let i=0;i<this.trail.length;i++){
      const t=this.trail[i];
      ctx.beginPath();ctx.arc(t.x,t.y,this.radius*(i/this.trail.length)*0.75,0,Math.PI*2);
      ctx.fillStyle=`rgba(255,255,255,${(i/this.trail.length)*0.28})`;ctx.fill();
    }
    ctx.save();ctx.translate(this.x,this.y);
    ctx.save();ctx.scale(1,0.4);ctx.translate(2,this.radius*1.2);
    const sg=ctx.createRadialGradient(0,0,0,0,0,this.radius);
    sg.addColorStop(0,'rgba(0,0,0,0.4)');sg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=sg;ctx.beginPath();ctx.arc(0,0,this.radius*1.3,0,Math.PI*2);ctx.fill();ctx.restore();
    ctx.rotate(this.angle);
    const bg=ctx.createRadialGradient(-3,-3,1,0,0,this.radius);
    bg.addColorStop(0,'#fff');bg.addColorStop(0.7,'#e8e8e8');bg.addColorStop(1,'#b0b0b0');
    ctx.fillStyle=bg;ctx.beginPath();ctx.arc(0,0,this.radius,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=hexToRgba(this.color,0.85);
    for(let i=0;i<5;i++){
      const a=(i/5)*Math.PI*2;
      ctx.beginPath();ctx.arc(Math.cos(a)*this.radius*0.55,Math.sin(a)*this.radius*0.55,this.radius*0.28,0,Math.PI*2);ctx.fill();
    }
    ctx.fillStyle=darken(this.color,15);ctx.beginPath();ctx.arc(0,0,this.radius*0.28,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.6)';ctx.beginPath();ctx.ellipse(-3,-4,3.5,2.5,-0.5,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
}

function spawnKickParticles(x,y,color){
  for(let i=0;i<8;i++){
    const a=Math.random()*Math.PI*2,s=2+Math.random()*4;
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,maxLife:0.5+Math.random()*0.5,color,size:3+Math.random()*4,type:'circle'});
  }
}
function spawnGoalParticles(x,y,color){
  for(let i=0;i<40;i++){
    const a=Math.random()*Math.PI*2,s=3+Math.random()*8;
    particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-4,life:1,maxLife:0.8+Math.random()*0.8,
      color:Math.random()>0.5?color:'#ffd700',size:4+Math.random()*8,type:Math.random()>0.5?'circle':'star'});
  }
}
function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];p.life-=dt/p.maxLife;
    if(p.life<=0){particles.splice(i,1);continue;}
    p.x+=p.vx;p.y+=p.vy;p.vy+=0.15;p.vx*=0.95;
  }
}
function drawParticles(){
  for(const p of particles){
    ctx.save();ctx.globalAlpha=Math.max(0,p.life)*0.9;ctx.fillStyle=p.color;
    ctx.translate(p.x,p.y);
    if(p.type==='star'){
      ctx.beginPath();
      for(let i=0;i<10;i++){const ri=i%2===0?p.size*2*p.life:p.size*p.life,ai=(i/10)*Math.PI*2-Math.PI/2;i===0?ctx.moveTo(Math.cos(ai)*ri,Math.sin(ai)*ri):ctx.lineTo(Math.cos(ai)*ri,Math.sin(ai)*ri);}
      ctx.closePath();ctx.fill();
    }else{ctx.beginPath();ctx.arc(0,0,p.size*p.life,0,Math.PI*2);ctx.fill();}
    ctx.restore();
  }
}

function drawField(fl) {
  const {left,right,top,bottom,fieldW,fieldH,goalW,goalH,margin,cx,cy} = fl;
  ctx.fillStyle='#0d2010'; ctx.fillRect(0,0,W,H);
  const pg=ctx.createLinearGradient(left,top,right,bottom);
  pg.addColorStop(0,'#1a4020');pg.addColorStop(0.5,'#1f5028');pg.addColorStop(1,'#183818');
  ctx.fillStyle=pg; ctx.fillRect(left,top,fieldW,fieldH);
  for(let i=0;i<10;i++){
    if(i%2===0){ctx.fillStyle='rgba(0,0,0,0.06)';ctx.fillRect(left+i*(fieldW/10),top,fieldW/10,fieldH);}
  }
  ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=2.5;
  ctx.strokeRect(left,top,fieldW,fieldH);
  ctx.beginPath();ctx.moveTo(cx,top);ctx.lineTo(cx,bottom);ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,65,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.85)';ctx.beginPath();ctx.arc(cx,cy,4,0,Math.PI*2);ctx.fill();
  const penW=90,penH=160,spW=40,spH=80;
  ctx.strokeRect(left,cy-penH/2,penW,penH); ctx.strokeRect(right-penW,cy-penH/2,penW,penH);
  ctx.strokeRect(left,cy-spH/2,spW,spH);   ctx.strokeRect(right-spW,cy-spH/2,spW,spH);
  [[left,top],[right,top],[left,bottom],[right,bottom]].forEach(([x,y])=>{
    const a=Math.atan2(cy-y,cx-x);
    ctx.beginPath();ctx.arc(x,y,18,a-0.4,a+0.4);ctx.stroke();
  });
  drawRealisticGoal(ctx, left, cy, goalW, goalH, '#1e90ff', 'left');
  drawRealisticGoal(ctx, right, cy, goalW, goalH, '#ff3a3a', 'right');
  drawCrowd(fl);
}

function drawCrowd(fl) {
  const crowds=[
    {x1:fl.left-20, x2:fl.right+20, y:fl.top-10,    dir:-1},
    {x1:fl.left-20, x2:fl.right+20, y:fl.bottom+10, dir:1},
  ];
  const colors=['#ff4444','#4444ff','#44ff44','#ffff44','#ff44ff','#44ffff','#fff','#ff8844'];
  for(const crowd of crowds){
    for(let row=0;row<3;row++){
      const baseY=crowd.y+crowd.dir*row*12,count=Math.floor((crowd.x2-crowd.x1)/14);
      for(let i=0;i<count;i++){
        const hx=crowd.x1+i*14+(row%2)*7;
        ctx.fillStyle=colors[(i+row*3)%colors.length];
        ctx.globalAlpha=0.4+Math.sin(i*0.8+row)*0.15;
        ctx.beginPath();ctx.arc(hx,baseY,5,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#c8a878';
        ctx.beginPath();ctx.arc(hx,baseY-7*(crowd.dir===-1?-1:1),3.5,0,Math.PI*2);ctx.fill();
      }
    }
  }
  ctx.globalAlpha=1;
}

function triggerFlash(color='#ffffff'){flashAlpha=0.6;flashColor=color;}
function drawFlash(){if(flashAlpha<=0)return;ctx.fillStyle=hexToRgba(flashColor,flashAlpha);ctx.fillRect(0,0,W,H);flashAlpha-=0.04;}
function cameraShake(intensity,duration){shakeDuration=duration;shakeX=(Math.random()-0.5)*intensity;shakeY=(Math.random()-0.5)*intensity;}
function updateShake(){
  if(shakeDuration>0){shakeDuration--;shakeX=(Math.random()-0.5)*(shakeDuration/10)*3;shakeY=(Math.random()-0.5)*(shakeDuration/10)*3;}
  else{shakeX=0;shakeY=0;}
}

function showPauseOverlay() {
  document.getElementById('pause-overlay').classList.add('visible');
}
function hidePauseOverlay() {
  document.getElementById('pause-overlay').classList.remove('visible');
}

const keysDown={};
window.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT') return;
  keysDown[e.code]=true;
  if(gameState==='playing'){
    if(e.code==='Space'){e.preventDefault();player1.tryKick(ball1);}
    if(e.code==='KeyF') player2.tryKick(ball2);
    if(e.code==='Escape'||e.code==='KeyP') togglePause();
  } else if(gameState==='paused'){
    if(e.code==='Escape'||e.code==='KeyP') togglePause();
  }
});
window.addEventListener('keyup',e=>{keysDown[e.code]=false;});

function togglePause(){
  if(gameState==='playing'){
    gameState='paused'; cancelAnimationFrame(animId);
    showPauseOverlay(); updatePauseBtn(true);
    stopCrowd();
  } else if(gameState==='paused'){
    gameState='playing'; lastTimestamp=performance.now();
    hidePauseOverlay(); updatePauseBtn(false);
    animId=requestAnimationFrame(gameLoop);
    startCrowd();
  }
}
function updatePauseBtn(isPaused){
  const btn=document.getElementById('pause-btn');
  if(btn) btn.textContent=isPaused?'▶':'⏸';
}

function checkScoring(){
  const pts=phase===2?2:1;
  if(cooldown1>0)cooldown1--;
  else if(target1.checkHit(ball1)){
    score1+=pts;cooldown1=55;target1.hitFlash=35;
    spawnGoalParticles(target1.x,target1.y,'#1e90ff');
    triggerFlash('#1e90ff');cameraShake(6,20);playSound('goal');
    updateScoreDisplay();
    const fl=getFieldLayout();
    ball1.reset(...randomBallPos(fl.left, fl.cx, fl.top, fl.bottom));
  }
  if(cooldown2>0)cooldown2--;
  else if(target2.checkHit(ball2)){
    score2+=pts;cooldown2=55;target2.hitFlash=35;
    spawnGoalParticles(target2.x,target2.y,'#ff3a3a');
    triggerFlash('#ff3a3a');cameraShake(6,20);playSound('goal');
    updateScoreDisplay();
    const fl=getFieldLayout();
    ball2.reset(...randomBallPos(fl.cx, fl.right, fl.top, fl.bottom));
  }
}
function updateScoreDisplay(){
  const s1=document.getElementById('score1'),s2=document.getElementById('score2');
  s1.textContent=score1;s2.textContent=score2;
  s1.classList.remove('score-pop');s2.classList.remove('score-pop');
  void s1.offsetWidth;void s2.offsetWidth;
  s1.classList.add('score-pop');s2.classList.add('score-pop');
}

function updateTimer(dt){
  if(gameState!=='playing')return;
  timerAccum+=dt;
  if(timerAccum>=1){
    timerAccum-=1;timeLeft--;
    const m=Math.floor(timeLeft/60),s=timeLeft%60;
    document.getElementById('timer-display').textContent=`${m}:${s.toString().padStart(2,'0')}`;
    if(timeLeft===PHASE2_START){
      phase=2;
      document.getElementById('phase-badge').textContent='FASE 2 • 2PT';
      document.getElementById('phase-badge').classList.add('active-gold');
      document.getElementById('timer-display').classList.add('phase2');
      playSound('whistle');
      crowdPhase2();
    }
    if(timeLeft<=URGENT_TIME&&timeLeft>0){
      document.getElementById('timer-display').classList.add('urgent');
      document.getElementById('timer-display').classList.remove('phase2');
      playSound('beep');
      crowdUrgent();
    }
    if(timeLeft<=0)endGame();
  }
}

function gameLoop(timestamp){
  if(gameState!=='playing')return;
  const dt=Math.min((timestamp-lastTimestamp)/1000,0.05);lastTimestamp=timestamp;
  const fl=getFieldLayout();
  const fb={top:fl.top,bottom:fl.bottom};
  player1.update(dt,fb);player2.update(dt,fb);
  ball1.update(fb);ball2.update(fb);
  target1.update(timeLeft);target2.update(timeLeft);
  updateParticles(dt);updateShake();updateTimer(dt);checkScoring();
  ctx.save();ctx.translate(shakeX,shakeY);ctx.clearRect(-10,-10,W+20,H+20);
  drawField(fl);
  target1.draw(ctx);target2.draw(ctx);
  ball1.draw(ctx);ball2.draw(ctx);
  player1.draw(ctx);player2.draw(ctx);
  drawParticles();drawFlash();
  ctx.restore();
  animId=requestAnimationFrame(gameLoop);
}

function showScreen(name){
  ['main-menu','intro-screen','game-screen'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.style.display='none';
  });
  document.getElementById('end-screen').classList.remove('visible');
  document.getElementById('countdown-overlay').style.opacity='0';
  document.getElementById('countdown-overlay').style.pointerEvents='none';
  hidePauseOverlay();
  if(name==='intro')document.getElementById('intro-screen').style.display='flex';
  else if(name==='game')document.getElementById('game-screen').style.display='flex';
  else if(name==='end'){document.getElementById('game-screen').style.display='flex';document.getElementById('end-screen').classList.add('visible');}
}
async function runCountdown(){
  const overlay=document.getElementById('countdown-overlay'),numEl=document.getElementById('countdown-number');
  overlay.style.pointerEvents='all';
  for(let i=3;i>=1;i--){
    numEl.textContent=i;numEl.style.animation='none';void numEl.offsetWidth;
    numEl.style.animation='countdownPop 0.9s ease-out forwards';overlay.style.opacity='1';
    playSound('beep');await sleep(900);
  }
  numEl.textContent='GO!';numEl.style.animation='none';void numEl.offsetWidth;
  numEl.style.animation='countdownPop 0.6s ease-out forwards';
  playSound('whistle');await sleep(600);
  overlay.style.opacity='0';overlay.style.pointerEvents='none';
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function randomBallPos(zoneLeft, zoneRight, fieldTop, fieldBottom) {
  const margin = 40;
  const x = zoneLeft + margin + Math.random() * (zoneRight - zoneLeft - margin * 2);
  const y = fieldTop  + margin + Math.random() * (fieldBottom - fieldTop  - margin * 2);
  return [x, y];
}

function initGameObjects(){
  const fl=getFieldLayout();
  const cx=fl.cx, cy=fl.cy;
  const p1ZoneLeft  = fl.left;
  const p1ZoneRight = fl.cx;
  const p2ZoneLeft  = fl.cx;
  const p2ZoneRight = fl.right;
  player1 = new Player(1,'#1e90ff', cx, cy,
    {up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight'},
    p1ZoneLeft, p1ZoneRight);
  player2 = new Player(2,'#ff3a3a', cx, cy,
    {up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD'},
    p2ZoneLeft, p2ZoneRight);
  ball1 = new Ball(...randomBallPos(fl.left, fl.cx, fl.top, fl.bottom), '#1e90ff', p1ZoneLeft, p1ZoneRight);
  ball2 = new Ball(...randomBallPos(fl.cx, fl.right, fl.top, fl.bottom), '#ff3a3a', p2ZoneLeft, p2ZoneRight);
  target1 = new Target(fl.left  - fl.goalW * 0.55, cy, '#1e90ff');
  target2 = new Target(fl.right + fl.goalW * 0.55, cy, '#ff3a3a');
}

async function startGame(){
  initAudio();
  score1=0;score2=0;timeLeft=GAME_DURATION;timerAccum=0;phase=1;
  particles=[];flashAlpha=0;shakeDuration=0;shakeX=0;shakeY=0;cooldown1=0;cooldown2=0;
  document.getElementById('score1').textContent='0';
  document.getElementById('score2').textContent='0';
  document.getElementById('timer-display').textContent='1:00';
  document.getElementById('timer-display').className='';
  document.getElementById('phase-badge').textContent='FASE 1 • 1PT';
  document.getElementById('phase-badge').className='phase-badge';
  updatePauseBtn(false);
  resizeCanvas();initGameObjects();showScreen('game');
  await runCountdown();
  gameState='playing';lastTimestamp=performance.now();
  startCrowd();
  animId=requestAnimationFrame(gameLoop);
}

function endGame(){
  gameState='ended';cancelAnimationFrame(animId);
  stopCrowd();
  document.getElementById('end-score1').textContent=score1;
  document.getElementById('end-score2').textContent=score2;
  const w=score1>score2?'🏆 JOGADOR 1 VENCE!':score2>score1?'🏆 JOGADOR 2 VENCE!':'🤝 EMPATE!';
  document.getElementById('end-winner').textContent=w;
  showScreen('end');playSound('victory');
}

function resizeCanvas(){
  const hudH=document.getElementById('hud')?.offsetHeight||HUD_HEIGHT;
  W=window.innerWidth;H=window.innerHeight-hudH;canvas.width=W;canvas.height=H;
}

let menuParticles=[], menuAnimId=null;

function menuStartBackground(){
  const mc=document.getElementById('menuCanvas');
  if(!mc) return;
  mc.width=window.innerWidth; mc.height=window.innerHeight;
  const mctx=mc.getContext('2d');
  menuParticles=[];
  for(let i=0;i<55;i++){
    menuParticles.push({
      x:Math.random()*mc.width, y:Math.random()*mc.height,
      vx:(Math.random()-0.5)*0.4, vy:(Math.random()-0.5)*0.4,
      r:1+Math.random()*2.5, alpha:0.2+Math.random()*0.5,
      color:Math.random()>0.5?'#1e90ff':'#fff',
    });
  }
  function mloop(){
    menuAnimId=requestAnimationFrame(mloop);
    mctx.clearRect(0,0,mc.width,mc.height);
    const bg=mctx.createRadialGradient(mc.width/2,mc.height*0.4,0,mc.width/2,mc.height*0.5,mc.width*0.8);
    bg.addColorStop(0,'#0d1e3a'); bg.addColorStop(0.5,'#07111f'); bg.addColorStop(1,'#030810');
    mctx.fillStyle=bg; mctx.fillRect(0,0,mc.width,mc.height);
    for(const p of menuParticles){
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0) p.x=mc.width; if(p.x>mc.width) p.x=0;
      if(p.y<0) p.y=mc.height; if(p.y>mc.height) p.y=0;
      mctx.globalAlpha=p.alpha; mctx.fillStyle=p.color;
      mctx.beginPath(); mctx.arc(p.x,p.y,p.r,0,Math.PI*2); mctx.fill();
    }
    mctx.globalAlpha=1;
    const g1=mctx.createRadialGradient(mc.width*0.5,mc.height*0.5,0,mc.width*0.5,mc.height*0.5,mc.width*0.45);
    g1.addColorStop(0,'rgba(30,144,255,0.09)'); g1.addColorStop(1,'transparent');
    mctx.fillStyle=g1; mctx.fillRect(0,0,mc.width,mc.height);
    mctx.strokeStyle='rgba(255,255,255,0.04)'; mctx.lineWidth=1.5;
    for(let y=mc.height*0.6;y<mc.height+30;y+=18){
      mctx.beginPath(); mctx.moveTo(0,y); mctx.lineTo(mc.width,y); mctx.stroke();
    }
  }
  mloop();
}

function menuStopBackground(){
  if(menuAnimId){cancelAnimationFrame(menuAnimId); menuAnimId=null;}
}

function goToMenu(){
  if(gameState==='playing'||gameState==='paused'){
    gameState='ended'; cancelAnimationFrame(animId);
    stopCrowd();
  }
  hidePauseOverlay();
  ['intro-screen','game-screen'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.style.display='none';
  });
  document.getElementById('end-screen').classList.remove('visible');
  document.getElementById('countdown-overlay').style.opacity='0';
  document.getElementById('countdown-overlay').style.pointerEvents='none';
  document.getElementById('main-menu').style.display='flex';
  menuStartBackground();
}

function updateSliderFill(slider){
  const pct=((slider.value-slider.min)/(slider.max-slider.min))*100;
  slider.style.background=`linear-gradient(to right,#1e90ff ${pct}%,rgba(255,255,255,0.12) ${pct}%)`;
}

window.addEventListener('DOMContentLoaded',()=>{
  canvas=document.getElementById('gameCanvas');
  ctx=canvas.getContext('2d');

  document.getElementById('btn-mode1').addEventListener('click',()=>{
    menuStopBackground();
    document.getElementById('main-menu').style.display='none';
    document.getElementById('intro-screen').style.display='flex';
  });

  document.getElementById('back-btn-intro').addEventListener('click', goToMenu);
  document.getElementById('start-btn').addEventListener('click', startGame);

  document.getElementById('pause-btn').addEventListener('click',()=>{
    if(gameState==='playing'||gameState==='paused') togglePause();
  });

  document.getElementById('resume-btn').addEventListener('click',()=>{
    if(gameState==='paused') togglePause();
  });

  document.getElementById('exit-to-menu-btn').addEventListener('click', goToMenu);

  document.getElementById('restart-btn').addEventListener('click',()=>{
    document.getElementById('end-screen').classList.remove('visible');
    startGame();
  });
  document.getElementById('menu-btn-end').addEventListener('click', goToMenu);

  const volJogoEl    = document.getElementById('vol-jogo');
  const volTorcidaEl = document.getElementById('vol-torcida');
  const volKickEl    = document.getElementById('vol-kick');

  [volJogoEl, volTorcidaEl, volKickEl].forEach(updateSliderFill);

  volJogoEl.addEventListener('input', e=>{
    volJogo = e.target.value / 100;
    document.getElementById('val-jogo').textContent = e.target.value;
    updateSliderFill(e.target);
  });
  volTorcidaEl.addEventListener('input', e=>{
    volTorcida = e.target.value / 100;
    document.getElementById('val-torcida').textContent = e.target.value;
    updateSliderFill(e.target);
    _setCrowdGain(0.1);
  });
  volKickEl.addEventListener('input', e=>{
    volKick = e.target.value / 100;
    document.getElementById('val-kick').textContent = e.target.value;
    updateSliderFill(e.target);
  });

  ['intro-screen','game-screen'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.style.display='none';
  });
  document.getElementById('end-screen').classList.remove('visible');
  document.getElementById('main-menu').style.display='flex';
  menuStartBackground();

  window.addEventListener('resize',()=>{
    const mc=document.getElementById('menuCanvas');
    if(mc){mc.width=window.innerWidth; mc.height=window.innerHeight;}
    if(gameState==='playing'||gameState==='paused'||gameState==='ended'){
      resizeCanvas(); initGameObjects();
    }
  });
});
