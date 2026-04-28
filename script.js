const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

// UI DOM 요소 연결
const targetSlider = document.getElementById('target');
const kpSlider = document.getElementById('kp');
const kiSlider = document.getElementById('ki');
const kdSlider = document.getElementById('kd');
const modeToggle = document.getElementById('modeToggle');
const resetBtn = document.getElementById('resetSim');

// 테마 관리
const currentTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);
updateToggleText(currentTheme);

modeToggle.addEventListener('click', () => {
    let theme = document.documentElement.getAttribute('data-theme');
    let newTheme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateToggleText(newTheme);
});

function updateToggleText(theme) {
    modeToggle.innerText = theme === 'light' ? '다크 모드' : '화이트 모드';
}

// 물리 모델 변수
let angle = 0;           // 현재 각도 (0은 아래 방향)
let angularVelocity = 0; // 각속도
const length = 140;      // 막대 길이
const gravity = 0.5;     // 중력 세기 (조절됨)
const damping = 0.98;    // 공기 저항/마찰

// PID 제어 변수
let integral = 0;
let prevError = 0;

// 초기화 함수
function resetSimulation() {
    angle = 0;
    angularVelocity = 0;
    integral = 0;
    prevError = 0;
}

resetBtn.addEventListener('click', resetSimulation);

// 메인 루프
function update() {
    // 1. UI 값 읽기
    const targetAngleDegree = parseFloat(targetSlider.value);
    const targetAngle = targetAngleDegree * (Math.PI / 180);
    const kp = parseFloat(kpSlider.value);
    const ki = parseFloat(kiSlider.value);
    const kd = parseFloat(kdSlider.value);

    // 2. PID 계산
    // 목표 각도와 현재 각도 사이의 오차 (최단 거리 계산)
    let error = targetAngle - angle;
    // -PI ~ PI 사이로 정규화하여 최단 경로로 회전하게 함
    while (error > Math.PI) error -= Math.PI * 2;
    while (error < -Math.PI) error += Math.PI * 2;

    integral += error;
    // 적분 윈드업 방지
    integral = Math.max(Math.min(integral, 10), -10);

    const derivative = error - prevError;
    prevError = error;

    // 제어 신호 (토크)
    const controlSignal = (kp * 0.01 * error) + (ki * 0.001 * integral) + (kd * 0.1 * derivative);

    // 3. 물리 계산
    // 중력에 의한 토크: sin(angle)을 사용하여 아래쪽(0)이 가장 안정적이게 설정
    const gravityTorque = gravity * Math.sin(angle);
    
    // 각가속도 = 제어 토크 - 중력 토크
    const angularAcceleration = controlSignal - gravityTorque;

    angularVelocity += angularAcceleration;
    angularVelocity *= damping;
    angle += angularVelocity;

    draw(targetAngle);
    requestAnimationFrame(update);
}

function draw(targetAngle) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // 목표 기준선 (가이드)
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(targetAngle) * length, cy + Math.cos(targetAngle) * length);
    ctx.strokeStyle = isDark ? 'rgba(255, 100, 100, 0.6)' : 'rgba(255, 0, 0, 0.4)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // 기어봉 (회전 막대)
    const px = cx + Math.sin(angle) * length;
    const py = cy + Math.cos(angle) * length;
    
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.strokeStyle = isDark ? '#ffffff' : '#2c3e50';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 중심축
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? '#ecf0f1' : '#34495e';
    ctx.fill();

    // 끝부분 추
    ctx.beginPath();
    ctx.arc(px, py, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#3498db';
    ctx.strokeStyle = isDark ? '#fff' : '#2980b9';
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
}

// 슬라이더 이벤트
const inputs = ['target', 'kp', 'ki', 'kd'];
inputs.forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
        document.getElementById(id + 'Val').innerText = e.target.value;
    });
});

update();
