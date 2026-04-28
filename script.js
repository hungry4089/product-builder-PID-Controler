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

// 시뮬레이션 상태
let isPaused = false;
let currentMode = 'manual';
let angle = 0;           // 라디안
let angularVelocity = 0; // 라디안/프레임
let integral = 0;
let prevError = 0;

// 물리 상수 및 제약 조건
const length = 130;
const gravity = 0.5;
const damping = 0.98;
const MAX_VOLTAGE = 12;
const MAX_ANGULAR_VELOCITY = Math.PI / 40; 

// 그래프 데이터
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

// Chart.js 옵션 (Y축 범위 안정화 추가)
const getChartOptions = (yMin, yMax, suggestRange = true) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    elements: { line: { tension: 0.1 } },
    scales: { 
        x: { display: false }, 
        y: { 
            // 값이 매우 작을 때 출렁거림 방지: 최소 +/- 1.0 범위 유지
            min: suggestRange ? undefined : yMin,
            max: suggestRange ? undefined : yMax,
            suggestedMin: suggestRange ? -1.0 : yMin,
            suggestedMax: suggestRange ? 1.0 : yMax,
            grid: { color: 'rgba(128,128,128,0.1)' } 
        } 
    },
    plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } }
});

const charts = {
    angle: new Chart(document.getElementById('chartAngle'), {
        type: 'line',
        data: { labels: graphData.labels, datasets: [{ label: '각도 (Target vs Current)', data: graphData.angle, borderColor: '#007bff', borderWidth: 2, pointRadius: 0 }] },
        options: getChartOptions(-180, 180, false)
    }),
    error: new Chart(document.getElementById('chartError'), {
        type: 'line',
        data: { labels: graphData.labels, datasets: [{ label: '오차 (Error)', data: graphData.error, borderColor: '#dc3545', borderWidth: 2, pointRadius: 0 }] },
        options: getChartOptions(-180, 180, false)
    }),
    volt: new Chart(document.getElementById('chartVolt'), {
        type: 'line',
        data: { labels: graphData.labels, datasets: [{ label: '제어 전압 (V)', data: graphData.voltage, borderColor: '#28a745', borderWidth: 2, pointRadius: 0 }] },
        options: getChartOptions(-12, 12, false)
    }),
    pid: new Chart(document.getElementById('chartPID'), {
        type: 'line',
        data: { 
            labels: graphData.labels, 
            datasets: [
                { label: 'P', data: graphData.p, borderColor: '#ff9f40', borderWidth: 1, pointRadius: 0 },
                { label: 'I', data: graphData.i, borderColor: '#4bc0c0', borderWidth: 1, pointRadius: 0 },
                { label: 'D', data: graphData.d, borderColor: '#9966ff', borderWidth: 1, pointRadius: 0 }
            ] 
        },
        options: getChartOptions(-5, 5, true) // PID 성분은 동적 범위 사용하되 최소 +/- 5 유지
    })
};

// 프리셋 설정
window.setPreset = (type) => {
    switch(type) {
        case 'P': elements.kp.value = 40; elements.ki.value = 0; elements.kd.value = 0; break;
        case 'PD': elements.kp.value = 40; elements.ki.value = 0; elements.kd.value = 5; break;
        case 'PID': elements.kp.value = 40; elements.ki.value = 2; elements.kd.value = 4; break;
        case 'AGGRESSIVE': elements.kp.value = 80; elements.ki.value = 4; elements.kd.value = 2; break;
    }
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
        const targetDeg = parseFloat(elements.target.value);
        const targetRad = targetDeg * (Math.PI / 180);
        const kp = parseFloat(elements.kp.value);
        const ki = parseFloat(elements.ki.value);
        const kd = parseFloat(elements.kd.value);
        
        let voltage = 0;
        let p_out = 0, i_out = 0, d_out = 0;

        if (currentMode === 'pid') {
            let error = targetRad - angle;
            // 최단 경로 계산
            while (error > Math.PI) error -= Math.PI * 2;
            while (error < -Math.PI) error += Math.PI * 2;

            integral += error;
            integral = Math.max(Math.min(integral, 20), -20); // Anti-windup
            const derivative = error - prevError;

            // 제어 로직 보강 (정밀도 개선)
            p_out = kp * 0.15 * error;
            i_out = ki * 0.02 * integral;
            d_out = kd * 0.8 * derivative;
            voltage = p_out + i_out + d_out;
            voltage = Math.max(Math.min(voltage, MAX_VOLTAGE), -MAX_VOLTAGE);
            prevError = error;

            graphData.error.push(error * (180/Math.PI));
            graphData.p.push(p_out); graphData.i.push(i_out); graphData.d.push(d_out);
        } else {
            voltage = parseFloat(elements.manualVolt.value);
            graphData.error.push(0); graphData.p.push(0); graphData.i.push(0); graphData.d.push(0);
            integral = 0; prevError = 0; // 수동 모드 시 PID 내부 값 초기화
        }

        // 물리 연산
        const motorTorque = voltage * 0.1;
        const gravityTorque = gravity * Math.sin(angle);
        const angularAccel = motorTorque - gravityTorque;

        angularVelocity += angularAccel * 0.1;
        angularVelocity = Math.max(Math.min(angularVelocity, MAX_ANGULAR_VELOCITY), -MAX_ANGULAR_VELOCITY);
        angularVelocity *= damping;
        angle += angularVelocity;

        // UI 업데이트
        const currentDeg = (angle * (180/Math.PI)).toFixed(1);
        elements.statAngle.innerText = currentDeg;
        elements.statVel.innerText = (angularVelocity * 60 * (180/Math.PI)).toFixed(1);
        elements.statVolt.innerText = voltage.toFixed(2);
        elements.overlay.innerText = currentDeg + "°";

        // 그래프 데이터 갱신
        graphData.angle.push(parseFloat(currentDeg));
        graphData.voltage.push(voltage);
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
    ctx.fillStyle = isDark ? '#1e1e1e' : '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 - 20;

    // 가이드 원
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    ctx.arc(cx, cy, length, 0, Math.PI * 2);
    ctx.stroke();

    // 목표 위치 (수동 모드 아닐 때만 표시)
    if (currentMode === 'pid') {
        ctx.beginPath();
        ctx.setLineDash([8, 6]);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(targetRad) * length, cy + Math.cos(targetRad) * length);
        ctx.strokeStyle = '#28a745';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        
        // "목표" 텍스트
        ctx.fillStyle = '#28a745';
        ctx.font = 'bold 14px Arial';
        ctx.fillText('목표', cx + Math.sin(targetRad) * (length + 25) - 10, cy + Math.cos(targetRad) * (length + 25) + 5);
    }

    // 기어봉
    const px = cx + Math.sin(angle) * length;
    const py = cy + Math.cos(angle) * length;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.strokeStyle = isDark ? '#f0f0f0' : '#2c3e50';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 모터 허브
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? '#444' : '#bdc3c7';
    ctx.fill();
    ctx.stroke();

    // 추
    ctx.beginPath();
    ctx.arc(px, py, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#dc3545';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
}

// 리셋 버튼: 모든 슬라이더와 값 초기화
elements.resetBtn.addEventListener('click', () => {
    ['target', 'manualVolt', 'kp', 'ki', 'kd'].forEach(id => {
        document.getElementById(id).value = 0;
    });
    syncSliderTexts();
    angle = 0; angularVelocity = 0; integral = 0; prevError = 0;
});

elements.pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    elements.pauseBtn.innerText = isPaused ? '재개' : '일시정지';
});

// 슬라이더 이벤트 연동
['target', 'manualVolt', 'kp', 'ki', 'kd'].forEach(id => {
    document.getElementById(id).addEventListener('input', syncSliderTexts);
});

// 테마 토글
elements.modeToggle.addEventListener('click', () => {
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    elements.modeToggle.innerText = theme === 'dark' ? '화이트 모드' : '다크 모드';
    
    const textColor = theme === 'dark' ? '#e0e0e0' : '#333';
    Object.values(charts).forEach(c => {
        c.options.scales.y.ticks.color = textColor;
        c.update();
    });
});

update();
