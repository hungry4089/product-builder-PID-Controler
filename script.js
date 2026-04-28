const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

// UI DOM 요소 연결
const targetSlider = document.getElementById('target');
const kpSlider = document.getElementById('kp');
const kiSlider = document.getElementById('ki');
const kdSlider = document.getElementById('kd');

// 물리 모델 변수 (진자 운동)
let angle = Math.PI / 2; // 현재 각도 (라디안)
let angularVelocity = 0; // 각속도
const mass = 1.0;        // 질량
const length = 120;      // 편심봉 길이
const gravity = 9.81;    // 중력 가속도
const damping = 0.95;    // 마찰(감쇠) 계수

// PID 제어 변수
let integral = 0;
let prevError = 0;

// 메인 루프 (초당 약 60프레임 실행)
function update() {
    // 1. 현재 UI 설정값 읽기
    const targetAngleDegree = parseFloat(targetSlider.value);
    const targetAngle = targetAngleDegree * (Math.PI / 180); // 도(Degree) -> 라디안(Radian) 변환
    const kp = parseFloat(kpSlider.value);
    const ki = parseFloat(kiSlider.value);
    const kd = parseFloat(kdSlider.value);

    // 2. PID 오차 계산 (최단 거리 정규화 적용)
    let rawError = targetAngle - angle;
    
    // 무한 회전 방지: 오차를 항상 -180도 ~ 180도(-π ~ π) 사이로 제한
    let error = Math.atan2(Math.sin(rawError), Math.cos(rawError)); 

    integral += error;

    // 적분 폭주(Windup) 방지 안전장치
    if (integral > 100) integral = 100;
    if (integral < -100) integral = -100;

    // 연산 오류(NaN) 발생 시 초기화 안전장치
    if (isNaN(angle) || isNaN(integral) || isNaN(angularVelocity)) {
        angle = Math.PI / 2;
        angularVelocity = 0;
        integral = 0;
        error = 0;
    }

    const derivative = error - prevError;
    
    // 3. PID 출력 (모터 제어량) 계산
    const controlSignal = (kp * error) + (ki * integral) + (kd * derivative);
    prevError = error;

    // 4. 물리 엔진 계산 (외력 및 가속도)
    // 중력에 의한 토크 (수직일 때 최대치, 수평일 때 0에 수렴)
    const gravityTorque = mass * gravity * length * Math.sin(angle) * 0.005; 
    
    // 최종 각가속도 = (모터 출력 - 중력 토크) 적용
    const angularAcceleration = controlSignal - gravityTorque;

    // 속도 및 위치 적분 계산
    angularVelocity += angularAcceleration;
    angularVelocity *= damping; // 마찰 적용
    angle += angularVelocity;

    // 화면 갱신
    draw(targetAngle);
    requestAnimationFrame(update);
}

// 캔버스 렌더링 함수
function draw(targetAngle) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // 목표 위치 가이드라인 그리기 (붉은색 점선)
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(targetAngle) * length, cy + Math.cos(targetAngle) * length);
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]); // 점선 초기화

    // 편심봉 막대기 그리기 (검은색 선)
    const px = cx + Math.sin(angle) * length;
    const py = cy + Math.cos(angle) * length;
    
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 5;
    ctx.stroke();

    // 모터 축(중심점) 그리기
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#666';
    ctx.fill();

    // 편심봉 끝 질량(추) 그리기
    ctx.beginPath();
    ctx.arc(px, py, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#3498db';
    ctx.fill();
    ctx.stroke();
}

// 슬라이더 조작 시 텍스트 즉시 변경 이벤트 리스너
const inputs = ['target', 'kp', 'ki', 'kd'];
inputs.forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
        document.getElementById(id + 'Val').innerText = e.target.value;
    });
});

// 시뮬레이션 시작
update();