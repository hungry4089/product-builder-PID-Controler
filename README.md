# ⚙️ PID Controller Study — 모터 편심봉 시뮬레이션

> PID 제어기(비례·적분·미분 제어)의 파라미터(Kp, Ki, Kd)를 조절하며 모터와 편심봉의 제어 반응을 시각적으로 학습할 수 있는 시뮬레이터입니다.

---

### 🚀 [웹에서 바로 실행하기 (클릭)](https://product-builder-pid-controler.pages.dev)
별도의 다운로드나 설치 없이 브라우저에서 바로 실행하실 수 있습니다.

[![Play PID Controller](https://img.shields.io/badge/⚙️_PID_제어기-바로_실행하기-blue?style=for-the-badge&logo=cloudflare&logoColor=white)](https://product-builder-pid-controler.pages.dev)

---

### 💻 내 컴퓨터에서 오프라인으로 실행하기
1. 프로젝트 폴더 내의 **`실행하기.bat`** 파일을 더블 클릭합니다.
2. 기본 브라우저(Chrome, Edge 등)에서 즉시 실행됩니다.

---

### ✨ 주요 기능
- **실시간 물리 엔진 시뮬레이션**: 모터 토크, 중력, 마찰력 등이 반영된 편심봉 물리 모델링
- **PID 파라미터 튜닝**: Kp(비례), Ki(적분), Kd(미분) 슬라이더 실시간 조작
- **동적 그래프**: 목표값(Setpoint)과 현재값(Process Variable)을 Chart.js로 실시간 시각화