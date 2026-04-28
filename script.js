const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

const elements = {
    target: document.getElementById('target'),
    kp: document.getElementById('kp'),
    ki: document.getElementById('ki'),
    kd: document.getElementById('kd'),
    manualVolt: document.getElementById('manualVolt'),
    modeToggle: document.getElementById('modeToggle'),
    resetBtn: document.getElementById('resetSim'),
    pauseBtn: document.getElementById('pauseSim'),
    overlay: document.getElementById('canvasAngleOverlay'),
    statAngle: document.getElementById('statAngle'),
    statVel: document.getElementById('statVel'),
    statVolt: document.getElementById('statVolt'),
    targetVal: document.getElementById('targetVal'),
    manualVoltVal: document.getElementById('manualVoltVal'),
    kpVal: document.getElementById('kpVal'),
    kiVal: document.getElementById('kiVal'),
    kdVal: document.getElementById('kdVal')
};

// --- 정밀 물리 모델 상수 ---
let isPaused = false;
let currentMode = 'manual';
let angle = 0;           // 라디안 (0 = 수직 아래)
let angularVelocity = 0; // rad/s
let integral = 0;
let prevError = 0;

const M = 5.0;           // 질량: 5kg (묵직함 부여)
const L = 0.25;          // 막대 길이: 25cm
const G = 9.81;          // 중력 가속도
const I = M * L * L;     // 관성 모멘트
const B = 2.5;           // 마찰/감쇠 계수 (속도 평형을 위해 조정)
const KT = 1.5;          // 토크 상수 (전압당 토크)
const DT = 1 / 60;       // 타임 스텝

// RPM 제한: 수동 최대 전압 시 2초에 1바퀴 (PI rad/s) 근처로 수렴 유도
// (물리 엔진 자체에서 마찰과 토크의 평형으로 자연스럽게 구현됨)

// --- 그래프 데이터 ---
const MAX_POINTS = 100;
const graphData = {
    labels: Array(MAX_POINTS).fill(''),
    angle: Array(MAX_POINTS).fill(0),
    error: Array(MAX_POINTS).fill(0),
    voltage: Array(MAX_POINTS).fill(0),
    p: Array(MAX_POINTS).fill(0), i: Array(MAX_POINTS).fill(0), d: Array(MAX_POINTS).fill(0)
};

// Chart.js 설정 (요동 방지를 위한 suggested range 적용)
const getChartOptions = (yMin, yMax, suggest = false) => ({
    responsive: true, maintainAspectRatio: false, animation: false,
    scales: { 
        x: { display: false }, 
        y: { 
            min: suggest ? undefined : yMin, 
            max: suggest ? undefined : yMax,
            suggestedMin: suggest ? yMin : undefined,
            suggestedMax: suggest ? yMax : undefined,
            grid: { color: 'rgba(128,128,128,0.1)' } 
        } 
    },
    plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } } }
});

const charts = {
    angle: new Chart(document.getElementById('chartAngle'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: '각도 (deg)', data: graphData.angle, borderColor: '#007bff', pointRadius: 0 }] },
        options: getChartOptions(-180, 180)
    }),
    error: new Chart(document.getElementById('chartError'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: '오차 (Error)', data: graphData.error, borderColor: '#dc3545', pointRadius: 0 }] },
        options: getChartOptions(-180, 180)
    }),
    volt: new Chart(document.getElementById('chartVolt'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: '인가 토크 (Nm)', data: graphData.voltage, borderColor: '#28a745', pointRadius: 0 }] },
        options: getChartOptions(-15, 15)
    }),
    pid: new Chart(document.getElementById('chartPID'), {
        type: 'line', data: { labels: graphData.labels, datasets: [
            { label: 'P', data: graphData.p, borderColor: '#ff9f40', pointRadius: 0 },
            { label: 'I', data: graphData.i, borderColor: '#4bc0c0', pointRadius: 0 },
            { label: 'D', data: graphData.d, borderColor: '#9966ff', pointRadius: 0 }
        ] }, options: getChartOptions(-10, 10, true)
    })
};

// --- 로직 및 업데이트 ---
window.setPreset = (type) => {
    // 무거운 질량에 최적화된 게인값
    const presets = {
        'P': [60, 0, 0],
        'PD': [60, 0, 15],
        'PID': [60, 20, 10],
        'AGGRESSIVE': [100, 40, 5]
    };
    const [p, i, d] = presets[type];
    elements.kp.value = p; elements.ki.value = i; elements.kd.value = d;
    syncSliderTexts();
};

function syncSliderTexts() {
    ['target', 'manualVolt', 'kp', 'ki', 'kd'].forEach(id => {
        const el = document.getElementById(id);
        const valEl = document.getElementById(id + 'Val');
        if (valEl) valEl.innerText = el.value;
    });
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.getAttribute('data-tab');
        document.getElementById(currentMode + '-controls').classList.add('active');
    });
});

function update() {
    if (!isPaused) {
        const targetRad = parseFloat(elements.target.value) * (Math.PI / 180);
        const kp = parseFloat(elements.kp.value);
        const ki = parseFloat(elements.ki.value);
        const kd = parseFloat(elements.kd.value);
        
        let motorTorque = 0;
        let p_out = 0, i_out = 0, d_out = 0;

        if (currentMode === 'pid') {
            let error = targetRad - angle;
            while (error > Math.PI) error -= Math.PI * 2;
            while (error < -Math.PI) error += Math.PI * 2;

            integral += error * DT;
            integral = Math.max(Math.min(integral, 10), -10); // Anti-windup
            const derivative = (error - prevError) / DT;

            p_out = (kp * 0.8) * error;
            i_out = (ki * 0.8) * integral;
            d_out = (kd * 0.1) * derivative;
            motorTorque = p_out + i_out + d_out;
            motorTorque = Math.max(Math.min(motorTorque, 20), -20); // 최대 토크 제한

            prevError = error;
            graphData.error.push(error * (180/Math.PI));
            graphData.p.push(p_out); graphData.i.push(i_out); graphData.d.push(d_out);
        } else {
            // 수동 모드: 전압을 토크로 변환 (KT 상수를 곱함)
            const volt = parseFloat(elements.manualVolt.value);
            motorTorque = volt * KT;
            graphData.error.push(0); graphData.p.push(0); graphData.i.push(0); graphData.d.push(0);
        }

        // --- 물리 시뮬레이션 엔진 ---
        // 1. 중력 토크: τ_g = mgl * sin(θ)
        const gravityTorque = M * G * L * Math.sin(angle);
        
        // 2. 마찰/감쇠 토크: τ_f = B * ω
        const frictionTorque = B * angularVelocity;
        
        // 3. 알짜 토크: τ_net = τ_motor - τ_g - τ_f
        const netTorque = motorTorque - gravityTorque - frictionTorque;

        // 4. 각가속도 계산: α = τ / I
        const angularAcceleration = netTorque / I;

        // 5. 적분 (오일러 방식)
        angularVelocity += angularAcceleration * DT;
        angle += angularVelocity * DT;

        // UI 업데이트
        const currentDeg = (angle * (180/Math.PI)).toFixed(1);
        elements.statAngle.innerText = currentDeg;
        elements.statVel.innerText = (angularVelocity * (180/Math.PI)).toFixed(1);
        elements.statVolt.innerText = motorTorque.toFixed(2);
        elements.overlay.innerText = currentDeg + "°";

        // 그래프 갱신
        graphData.angle.push(parseFloat(currentDeg));
        graphData.voltage.push(motorTorque);
        [graphData.angle, graphData.error, graphData.voltage, graphData.p, graphData.i, graphData.d].forEach(arr => {
            if (arr.length > MAX_POINTS) arr.shift();
        });

        Object.values(charts).forEach(c => c.update('none'));
        draw(targetRad);
    }
    requestAnimationFrame(update);
}

function draw(targetRad) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 - 20;
    const drawL = 140;

    // 가이드 원
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    ctx.beginPath(); ctx.arc(cx, cy, drawL, 0, Math.PI * 2); ctx.stroke();

    // 목표 가이드 (PID 전용)
    if (currentMode === 'pid') {
        ctx.beginPath();
        ctx.setLineDash([8, 6]);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(targetRad) * drawL, cy + Math.cos(targetRad) * drawL);
        ctx.strokeStyle = '#28a745';
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#28a745';
        ctx.font = 'bold 13px Arial';
        ctx.fillText('목표', cx + Math.sin(targetRad) * (drawL + 25) - 10, cy + Math.cos(targetRad) * (drawL + 25) + 5);
    }

    // 막대기
    const px = cx + Math.sin(angle) * drawL;
    const py = cy + Math.cos(angle) * drawL;
    ctx.beginPath();
    ctx.moveTo(cx, cy); ctx.lineTo(px, py);
    ctx.strokeStyle = isDark ? '#ecf0f1' : '#2c3e50';
    ctx.lineWidth = 10; // 무게감 표현을 위해 두껍게
    ctx.lineCap = 'round';
    ctx.stroke();

    // 모터 축
    ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? '#444' : '#bdc3c7';
    ctx.fill(); ctx.stroke();

    // 무거운 추
    ctx.beginPath(); ctx.arc(px, py, 25, 0, Math.PI * 2);
    ctx.fillStyle = '#dc3545';
    ctx.fill(); ctx.strokeStyle = isDark ? '#fff' : '#000';
    ctx.lineWidth = 3; ctx.stroke();
}

elements.resetBtn.addEventListener('click', () => {
    ['target', 'manualVolt', 'kp', 'ki', 'kd'].forEach(id => document.getElementById(id).value = 0);
    syncSliderTexts();
    angle = 0; angularVelocity = 0; integral = 0; prevError = 0;
});

elements.pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    elements.pauseBtn.innerText = isPaused ? '재개' : '일시정지';
});

['target', 'manualVolt', 'kp', 'ki', 'kd'].forEach(id => {
    document.getElementById(id).addEventListener('input', syncSliderTexts);
});

elements.modeToggle.addEventListener('click', () => {
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    elements.modeToggle.innerText = theme === 'dark' ? '화이트 모드' : '다크 모드';
});

update();
