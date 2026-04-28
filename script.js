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
    statVolt: document.getElementById('statVolt')
};

// 물리 모델 상태 변수
let isPaused = false;
let currentMode = 'manual';
let angle = 0;           // 현재 각도 (라디안, 0은 수직 아래)
let angularVelocity = 0; // 각속도 (rad/s)
let integral = 0;        // 적분항 누적값
let prevError = 0;       // 이전 에러

// 물리 상수 (현실적인 수치)
const L = 0.15;          // 막대 길이 (15cm)
const M = 0.5;           // 끝부분 추 질량 (0.5kg)
const G = 9.81;          // 중력 가속도
const I = M * L * L;     // 관성 모멘트 (점질량 가정)
const B = 0.05;          // 마찰 계수 (Damping)
const DT = 1 / 60;       // 프레임 시간 (60fps)

// RPM 제한 (2초에 1회전 = 0.5Hz = PI rad/s)
const MAX_W = Math.PI;

// 그래프 데이터
const MAX_POINTS = 100;
const graphData = {
    labels: Array(MAX_POINTS).fill(''),
    angle: Array(MAX_POINTS).fill(0),
    error: Array(MAX_POINTS).fill(0),
    voltage: Array(MAX_POINTS).fill(0),
    p: Array(MAX_POINTS).fill(0), i: Array(MAX_POINTS).fill(0), d: Array(MAX_POINTS).fill(0)
};

// Chart.js 설정
const commonOptions = {
    responsive: true, maintainAspectRatio: false, animation: false,
    scales: { x: { display: false }, y: { suggestedMin: -2, suggestedMax: 2, grid: { color: 'rgba(128,128,128,0.1)' } } }
};

const charts = {
    angle: new Chart(document.getElementById('chartAngle'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: '각도 (deg)', data: graphData.angle, borderColor: '#007bff', pointRadius: 0 }] },
        options: { ...commonOptions, scales: { y: { min: -180, max: 180 } } }
    }),
    error: new Chart(document.getElementById('chartError'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: '오차 (Error)', data: graphData.error, borderColor: '#dc3545', pointRadius: 0 }] },
        options: { ...commonOptions, scales: { y: { min: -180, max: 180 } } }
    }),
    volt: new Chart(document.getElementById('chartVolt'), {
        type: 'line', data: { labels: graphData.labels, datasets: [{ label: '입력 토크/전압', data: graphData.voltage, borderColor: '#28a745', pointRadius: 0 }] },
        options: { ...commonOptions, scales: { y: { min: -12, max: 12 } } }
    }),
    pid: new Chart(document.getElementById('chartPID'), {
        type: 'line', data: { labels: graphData.labels, datasets: [
            { label: 'P', data: graphData.p, borderColor: '#ff9f40', pointRadius: 0 },
            { label: 'I', data: graphData.i, borderColor: '#4bc0c0', pointRadius: 0 },
            { label: 'D', data: graphData.d, borderColor: '#9966ff', pointRadius: 0 }
        ] }, options: commonOptions
    })
};

// 프리셋
window.setPreset = (type) => {
    const vals = {
        'P': [40, 0, 0],
        'PD': [40, 0, 5],
        'PID': [40, 10, 5],
        'AGGRESSIVE': [100, 20, 2]
    }[type];
    elements.kp.value = vals[0]; elements.ki.value = vals[1]; elements.kd.value = vals[2];
    syncSliderTexts();
};

function syncSliderTexts() {
    ['target', 'manualVolt', 'kp', 'ki', 'kd'].forEach(id => {
        const el = document.getElementById(id);
        const valEl = document.getElementById(id + 'Val');
        if (valEl) valEl.innerText = el.value;
    });
}

// 탭 전환
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
        
        let controlTorque = 0;
        let p_out = 0, i_out = 0, d_out = 0;

        if (currentMode === 'pid') {
            let error = targetRad - angle;
            while (error > Math.PI) error -= Math.PI * 2;
            while (error < -Math.PI) error += Math.PI * 2;

            integral += error * DT;
            integral = Math.max(Math.min(integral, 5), -5); // Anti-windup
            const derivative = (error - prevError) / DT;

            p_out = (kp * 0.5) * error;
            i_out = (ki * 0.5) * integral;
            d_out = (kd * 0.05) * derivative;
            controlTorque = p_out + i_out + d_out;
            controlTorque = Math.max(Math.min(controlTorque, 10), -10); // 토크 제한

            prevError = error;
            graphData.error.push(error * (180/Math.PI));
            graphData.p.push(p_out); graphData.i.push(i_out); graphData.d.push(d_out);
        } else {
            controlTorque = parseFloat(elements.manualVolt.value) * 0.5;
            graphData.error.push(0); graphData.p.push(0); graphData.i.push(0); graphData.d.push(0);
        }

        // 물리 연산 (Torque Balance)
        // τ_net = τ_control - τ_gravity - τ_friction
        const gravityTorque = M * G * L * Math.sin(angle);
        const frictionTorque = B * angularVelocity;
        const netTorque = controlTorque - gravityTorque - frictionTorque;

        // α = τ / I
        const angularAcceleration = netTorque / I;

        // 적분 (Velocity & Position)
        angularVelocity += angularAcceleration * DT;
        
        // 속도 제한
        angularVelocity = Math.max(Math.min(angularVelocity, MAX_W), -MAX_W);
        
        angle += angularVelocity * DT;

        // UI 갱신
        const currentDeg = (angle * (180/Math.PI)).toFixed(1);
        elements.statAngle.innerText = currentDeg;
        elements.statVel.innerText = (angularVelocity * (180/Math.PI)).toFixed(1);
        elements.statVolt.innerText = controlTorque.toFixed(2);
        elements.overlay.innerText = currentDeg + "°";

        // 그래프 데이터 갱신
        graphData.angle.push(parseFloat(currentDeg));
        graphData.voltage.push(controlTorque);
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
    const drawLength = 140;

    // 배경 가이드
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, drawLength, 0, Math.PI * 2);
    ctx.stroke();

    // 목표 위치 (PID 모드일 때만)
    if (currentMode === 'pid') {
        ctx.beginPath();
        ctx.setLineDash([8, 6]);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(targetRad) * drawLength, cy + Math.cos(targetRad) * drawLength);
        ctx.strokeStyle = '#28a745';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = '#28a745';
        ctx.font = 'bold 13px Arial';
        ctx.fillText('목표', cx + Math.sin(targetRad) * (drawLength + 25) - 10, cy + Math.cos(targetRad) * (drawLength + 25) + 5);
    }

    // 막대기 (기어봉)
    const px = cx + Math.sin(angle) * drawLength;
    const py = cy + Math.cos(angle) * drawLength;
    
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.strokeStyle = isDark ? '#ecf0f1' : '#2c3e50';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 모터 축
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? '#444' : '#bdc3c7';
    ctx.fill();
    ctx.stroke();

    // 끝부분 추
    ctx.beginPath();
    ctx.arc(px, py, 20, 0, Math.PI * 2);
    ctx.fillStyle = '#dc3545';
    ctx.fill();
    ctx.strokeStyle = isDark ? '#fff' : '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
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
