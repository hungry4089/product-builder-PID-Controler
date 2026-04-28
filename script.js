const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

// UI DOM 요소 연결
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

// 시뮬레이션 상태
let isPaused = false;
let currentMode = 'manual'; // 'manual' or 'pid'
let angle = 0;           // 현재 각도 (라디안)
let angularVelocity = 0; // 각속도
let integral = 0;
let prevError = 0;
let time = 0;

// 물리 상수
const length = 120;
const mass = 1.0;
const gravity = 0.8;
const damping = 0.98;

// 그래프 데이터 관리 (최대 100포인트)
const MAX_POINTS = 100;
const graphData = {
    labels: Array(MAX_POINTS).fill(''),
    angle: Array(MAX_POINTS).fill(0),
    target: Array(MAX_POINTS).fill(0),
    error: Array(MAX_POINTS).fill(0),
    voltage: Array(MAX_POINTS).fill(0),
    p: Array(MAX_POINTS).fill(0),
    i: Array(MAX_POINTS).fill(0),
    d: Array(MAX_POINTS).fill(0)
};

// Chart.js 초기화 함수
function createChart(id, label, color, dataKey, yMin, yMax) {
    return new Chart(document.getElementById(id), {
        type: 'line',
        data: {
            labels: graphData.labels,
            datasets: [{
                label: label,
                data: graphData[dataKey],
                borderColor: color,
                borderWidth: 2,
                pointRadius: 0,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                y: { min: yMin, max: yMax, grid: { color: 'rgba(128,128,128,0.1)' } },
                x: { display: false }
            },
            plugins: { legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } } }
        }
    });
}

const charts = {
    angle: createChart('chartAngle', '각도 (Target vs Current)', '#1877f2', 'angle', -180, 180),
    error: createChart('chartError', '오차 (Error)', '#fa3e3e', 'error', -180, 180),
    volt: createChart('chartVolt', '제어 전압 (Voltage)', '#42b72a', 'voltage', -12, 12),
    pid: new Chart(document.getElementById('chartPID'), {
        type: 'line',
        data: {
            labels: graphData.labels,
            datasets: [
                { label: 'P', data: graphData.p, borderColor: '#ff9f40', borderWidth: 1, pointRadius: 0, fill: false },
                { label: 'I', data: graphData.i, borderColor: '#4bc0c0', borderWidth: 1, pointRadius: 0, fill: false },
                { label: 'D', data: graphData.d, borderColor: '#9966ff', borderWidth: 1, pointRadius: 0, fill: false }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: { y: { grid: { color: 'rgba(128,128,128,0.1)' } }, x: { display: false } },
            plugins: { legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } } }
        }
    })
};

// 탭 전환 로직
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        document.getElementById(tabId + '-controls').classList.add('active');
        currentMode = tabId;
    });
});

// 물리 엔진 및 루프
function update() {
    if (!isPaused) {
        const targetDeg = parseFloat(elements.target.value);
        const targetRad = targetDeg * (Math.PI / 180);
        const kp = parseFloat(elements.kp.value);
        const ki = parseFloat(elements.ki.value);
        const kd = parseFloat(elements.kd.value);
        
        let voltage = 0;
        let p_out = 0, i_out = 0, d_out = 0;

        if (currentMode === 'pid') {
            let error = targetRad - angle;
            while (error > Math.PI) error -= Math.PI * 2;
            while (error < -Math.PI) error += Math.PI * 2;

            integral += error;
            integral = Math.max(Math.min(integral, 20), -20); // Windup 방지
            const derivative = error - prevError;

            p_out = kp * error;
            i_out = ki * integral;
            d_out = kd * derivative;
            voltage = p_out + i_out + d_out;
            voltage = Math.max(Math.min(voltage, 12), -12); // 전압 제한

            prevError = error;
            
            // 그래프용 데이터 업데이트 (각도 단위)
            graphData.error.push(error * (180/Math.PI));
            graphData.p.push(p_out);
            graphData.i.push(i_out);
            graphData.d.push(d_out);
        } else {
            voltage = parseFloat(elements.manualVolt.value);
            graphData.error.push(0);
            graphData.p.push(0);
            graphData.i.push(0);
            graphData.d.push(0);
        }

        // 물리 연산: Torque = Voltage * K - Gravity * sin(Angle)
        const motorTorque = voltage * 0.1;
        const gravityTorque = gravity * Math.sin(angle);
        const angularAccel = motorTorque - gravityTorque;

        angularVelocity += angularAccel;
        angularVelocity *= damping;
        angle += angularVelocity;

        // 상태 업데이트
        elements.statAngle.innerText = (angle * (180/Math.PI)).toFixed(1);
        elements.statVel.innerText = (angularVelocity * 60 * (180/Math.PI)).toFixed(1);
        elements.statVolt.innerText = voltage.toFixed(2);
        elements.overlay.innerText = (angle * (180/Math.PI)).toFixed(1) + "°";

        // 그래프 데이터 갱신
        graphData.angle.push(angle * (180/Math.PI));
        graphData.target.push(targetDeg);
        graphData.voltage.push(voltage);

        [graphData.angle, graphData.target, graphData.error, graphData.voltage, graphData.p, graphData.i, graphData.d].forEach(arr => {
            if (arr.length > MAX_POINTS) arr.shift();
        });

        Object.values(charts).forEach(chart => chart.update('none'));
        draw(targetRad);
    }
    requestAnimationFrame(update);
}

function draw(targetRad) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 - 50; // 약간 위쪽에 회전축 배치

    // 배경 가이드 (점선 원)
    ctx.beginPath();
    ctx.arc(cx, cy, length, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 목표 위치 (붉은 점선)
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(targetRad) * length, cy + Math.cos(targetRad) * length);
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 펜싱봉 (막대)
    const px = cx + Math.sin(angle) * length;
    const py = cy + Math.cos(angle) * length;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 모터 축 (회색 원)
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#444';
    ctx.fill();
    ctx.strokeStyle = '#666';
    ctx.stroke();

    // 끝부분 추 (빨간색 공)
    ctx.beginPath();
    ctx.arc(px, py, 20, 0, Math.PI * 2);
    ctx.fillStyle = '#fa3e3e';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
}

// 이벤트 리스너
elements.resetBtn.addEventListener('click', () => {
    angle = 0; angularVelocity = 0; integral = 0; prevError = 0;
});
elements.pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    elements.pauseBtn.innerText = isPaused ? '재개' : '일시정지';
});

// 슬라이더 텍스트 동기화
const sliders = ['target', 'kp', 'ki', 'kd', 'manualVolt'];
sliders.forEach(id => {
    const el = document.getElementById(id);
    const valEl = document.getElementById(id + 'Val');
    el.addEventListener('input', () => valEl.innerText = el.value);
});

// 테마 토글
elements.modeToggle.addEventListener('click', () => {
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    elements.modeToggle.innerText = theme === 'dark' ? '화이트 모드' : '다크 모드';
    
    // 그래프 색상 조정 (선택 사항)
    const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
    Object.values(charts).forEach(chart => {
        chart.options.scales.y.grid.color = gridColor;
        chart.update();
    });
});

update();
