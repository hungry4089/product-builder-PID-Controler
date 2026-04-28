const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');
const dashboard = document.querySelector('.dashboard');

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

// --- 물리 모델 상수 ---
let isPaused = false;
let currentMode = 'manual';
let angle = 0;           
let angularVelocity = 0; 
let integral = 0;        
let prevError = 0;       

const M = 5.0;           
const L = 0.25;          
const G = 9.81;          
const I = M * L * L;     
const B = 0.4;           
const KT = 1.7;          
const DT = 1 / 60;       

// --- 그래프 데이터 ---
const MAX_POINTS = 80;
const graphData = {
    labels: Array(MAX_POINTS).fill(''),
    angle: Array(MAX_POINTS).fill(0),
    target: Array(MAX_POINTS).fill(0),
    error: Array(MAX_POINTS).fill(0),
    voltage: Array(MAX_POINTS).fill(0),
    p: Array(MAX_POINTS).fill(0), i: Array(MAX_POINTS).fill(0), d: Array(MAX_POINTS).fill(0)
};

// 동적 스케일 관리 변수
const dynBounds = {
    angle: { min: -10, max: 10 },
    error: { min: -10, max: 10 },
    volt: { min: -10, max: 10 },
    pid: { min: -10, max: 10 }
};

// 공통 차트 옵션 생성
const getBaseOptions = (title, unit, color, isFixed, yMin, yMax) => ({
    responsive: true, maintainAspectRatio: false, animation: false,
    scales: { 
        x: { display: false }, 
        y: { 
            min: isFixed ? yMin : undefined,
            max: isFixed ? yMax : undefined,
            grid: { color: 'rgba(128,128,128,0.06)' },
            ticks: { font: { size: 7 }, display: isFixed } // 고정 그래프만 눈금 표시
        } 
    },
    plugins: { 
        legend: { display: !isFixed, labels: { boxWidth: 5, font: { size: 7 } } },
        tooltip: { enabled: false }
    }
});

// 차트 초기화
const charts = {
    angleF: new Chart(document.getElementById('chartAngleFixed'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: 'Fixed', data: graphData.angle, borderColor: '#007bff', borderWidth: 1, pointRadius: 0 }] },
        options: getBaseOptions('Angle', '°', '#007bff', true, -180, 180)
    }),
    angleD: new Chart(document.getElementById('chartAngleDynamic'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: 'Angle', data: graphData.angle, borderColor: '#007bff', borderWidth: 1, pointRadius: 0 }] },
        options: getBaseOptions('Angle', '°', '#007bff', false)
    }),
    errorF: new Chart(document.getElementById('chartErrorFixed'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: 'Fixed', data: graphData.error, borderColor: '#dc3545', borderWidth: 1, pointRadius: 0 }] },
        options: getBaseOptions('Error', '°', '#dc3545', true, -180, 180)
    }),
    errorD: new Chart(document.getElementById('chartErrorDynamic'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: 'Error', data: graphData.error, borderColor: '#dc3545', borderWidth: 1, pointRadius: 0 }] },
        options: getBaseOptions('Error', '°', '#dc3545', false)
    }),
    voltF: new Chart(document.getElementById('chartVoltFixed'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: 'Fixed', data: graphData.voltage, borderColor: '#28a745', borderWidth: 1, pointRadius: 0 }] },
        options: getBaseOptions('Torque', 'Nm', '#28a745', true, -25, 25)
    }),
    voltD: new Chart(document.getElementById('chartVoltDynamic'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: 'Torque', data: graphData.voltage, borderColor: '#28a745', borderWidth: 1, pointRadius: 0 }] },
        options: getBaseOptions('Torque', 'Nm', '#28a745', false)
    }),
    pidF: new Chart(document.getElementById('chartPIDFixed'), {
        type: 'line', data: { labels: graphData.labels, datasets: [
            { label: 'P', data: graphData.p, borderColor: '#ff9f40', borderWidth: 1, pointRadius: 0 },
            { label: 'I', data: graphData.i, borderColor: '#4bc0c0', borderWidth: 1, pointRadius: 0 },
            { label: 'D', data: graphData.d, borderColor: '#9966ff', borderWidth: 1, pointRadius: 0 }
        ] }, options: getBaseOptions('PID', '', '#666', true, -15, 15)
    }),
    pidD: new Chart(document.getElementById('chartPIDDynamic'), {
        type: 'line', data: { labels: graphData.labels, datasets: [
            { label: 'P', data: graphData.p, borderColor: '#ff9f40', borderWidth: 1, pointRadius: 0 },
            { label: 'I', data: graphData.i, borderColor: '#4bc0c0', borderWidth: 1, pointRadius: 0 },
            { label: 'D', data: graphData.d, borderColor: '#9966ff', borderWidth: 1, pointRadius: 0 }
        ] }, options: getBaseOptions('PID', '', '#666', false)
    })
};

// 동적 스케일 업데이트 함수
function updateScales() {
    const configs = [
        { id: 'angleD', boundKey: 'angle', dataKeys: ['angle'] },
        { id: 'errorD', boundKey: 'error', dataKeys: ['error'] },
        { id: 'voltD', boundKey: 'volt', dataKeys: ['voltage'] },
        { id: 'pidD', boundKey: 'pid', dataKeys: ['p', 'i', 'd'] }
    ];

    configs.forEach(cfg => {
        let min = Infinity, max = -Infinity;
        cfg.dataKeys.forEach(dk => {
            graphData[dk].forEach(v => {
                if (v < min) min = v;
                if (v > max) max = v;
            });
        });

        if (min === Infinity) { min = -1; max = 1; }
        
        let range = max - min;
        if (range < 2) { // 최소 범위 2 보장
            const mid = (max + min) / 2;
            min = mid - 1; max = mid + 1;
            range = 2;
        }

        const targetMin = min - range * 0.2;
        const targetMax = max + range * 0.2;

        const bounds = dynBounds[cfg.boundKey];
        // 확장 즉시, 축소 서서히
        bounds.min = targetMin < bounds.min ? targetMin : bounds.min + (targetMin - bounds.min) * 0.05;
        bounds.max = targetMax > bounds.max ? targetMax : bounds.max + (targetMax - bounds.max) * 0.05;

        charts[cfg.id].options.scales.y.min = bounds.min;
        charts[cfg.id].options.scales.y.max = bounds.max;
    });
}

function update() {
    if (!isPaused) {
        const targetDeg = parseFloat(elements.target.value);
        const targetRad = targetDeg * (Math.PI / 180);
        const kp = parseFloat(elements.kp.value);
        const ki = parseFloat(elements.ki.value);
        const kd = parseFloat(elements.kd.value);
        
        let motorTorque = 0;
        let p_out = 0, i_out = 0, d_out = 0;

        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;

        if (currentMode === 'pid') {
            let error = targetRad - angle;
            while (error > Math.PI) error -= Math.PI * 2;
            while (error < -Math.PI) error += Math.PI * 2;

            integral += error * DT;
            integral = Math.max(Math.min(integral, 10), -10); 
            const derivative = (error - prevError) / DT;

            p_out = (kp * 0.3) * error;
            i_out = (ki * 0.4) * integral;
            d_out = (kd * 0.08) * derivative;
            motorTorque = p_out + i_out + d_out;
            motorTorque = Math.max(Math.min(motorTorque, 25), -25);

            prevError = error;
            graphData.error.push(error * (180/Math.PI));
            graphData.p.push(p_out); graphData.i.push(i_out); graphData.d.push(d_out);
        } else {
            motorTorque = parseFloat(elements.manualVolt.value) * KT;
            graphData.error.push(0); graphData.p.push(0); graphData.i.push(0); graphData.d.push(0);
            integral = 0;
        }

        const gravityTorque = M * G * L * Math.sin(angle);
        const frictionTorque = B * angularVelocity;
        const netTorque = motorTorque - gravityTorque - frictionTorque;

        const angularAcceleration = netTorque / I;
        angularVelocity += angularAcceleration * DT;
        angle += angularVelocity * DT;

        const currentDeg = (angle * (180/Math.PI)).toFixed(1);
        elements.statAngle.innerText = currentDeg;
        elements.statVel.innerText = (angularVelocity * (180/Math.PI)).toFixed(1);
        elements.statVolt.innerText = motorTorque.toFixed(2);
        elements.overlay.innerText = currentDeg + "°";

        graphData.angle.push(parseFloat(currentDeg));
        graphData.target.push(targetDeg);
        graphData.voltage.push(motorTorque);
        [graphData.angle, graphData.target, graphData.error, graphData.voltage, graphData.p, graphData.i, graphData.d].forEach(arr => {
            if (arr.length > MAX_POINTS) arr.shift();
        });

        updateScales();
        Object.values(charts).forEach(c => c.update('none'));
        draw(targetRad);
    }
    requestAnimationFrame(update);
}

function draw(targetRad) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const drawL = 100;

    // 눈금판
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
    ctx.font = '8px Arial';
    ctx.textAlign = 'center';
    for (let i = 0; i < 360; i += 30) {
        const rad = (i - 90) * (Math.PI / 180);
        const x1 = Math.cos(rad) * (drawL + 5), y1 = Math.sin(rad) * (drawL + 5);
        const x2 = Math.cos(rad) * (drawL + 12), y2 = Math.sin(rad) * (drawL + 12);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const label = i <= 180 ? i : i - 360;
        ctx.fillText(label, Math.cos(rad) * (drawL + 20), Math.sin(rad) * (drawL + 20) + 3);
    }
    ctx.restore();

    // 중력 가이드
    ctx.save();
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + drawL + 15); ctx.stroke();
    ctx.restore();

    if (currentMode === 'pid') {
        ctx.beginPath(); ctx.setLineDash([4, 3]);
        ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(targetRad) * drawL, cy + Math.cos(targetRad) * drawL);
        ctx.strokeStyle = '#28a745'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    }

    // 모터 본체
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, 18);
    grad.addColorStop(0, isDark ? '#444' : '#eee'); grad.addColorStop(1, isDark ? '#222' : '#ccc');
    ctx.fillStyle = grad; ctx.fill(); ctx.strokeStyle = isDark ? '#333' : '#bbb'; ctx.stroke();
    ctx.restore();

    // 막대기
    const px = cx + Math.sin(angle) * drawL, py = cy + Math.cos(angle) * drawL;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py);
    ctx.strokeStyle = isDark ? '#ecf0f1' : '#2c3e50'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();

    // 샤프트 & 추
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fillStyle = isDark ? '#777' : '#666'; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 13, 0, Math.PI * 2); ctx.fillStyle = '#dc3545'; ctx.fill();
    ctx.strokeStyle = isDark ? '#fff' : '#000'; ctx.lineWidth = 1.5; ctx.stroke();
}

// 이벤트
elements.resetBtn.addEventListener('click', () => {
    ['target', 'manualVolt', 'kp', 'ki', 'kd'].forEach(id => document.getElementById(id).value = 0);
    syncSliderTexts();
    angle = 0; angularVelocity = 0; integral = 0; prevError = 0;
    Object.keys(dynBounds).forEach(k => { dynBounds[k].min = -5; dynBounds[k].max = 5; });
});

elements.pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    elements.pauseBtn.innerText = isPaused ? '재개' : '일시정지';
});

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.getAttribute('data-tab');
        dashboard.setAttribute('data-mode', currentMode);
    });
});

['target', 'manualVolt', 'kp', 'ki', 'kd'].forEach(id => {
    document.getElementById(id).addEventListener('input', syncSliderTexts);
});

elements.modeToggle.addEventListener('click', () => {
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    elements.modeToggle.innerText = theme === 'dark' ? '화이트 모드' : '다크 모드';
});

function syncSliderTexts() {
    ['target', 'manualVolt', 'kp', 'ki', 'kd'].forEach(id => {
        const el = document.getElementById(id);
        const valEl = document.getElementById(id + 'Val');
        if (valEl) valEl.innerText = el.value;
    });
}

update();
