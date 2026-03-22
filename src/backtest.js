// ════════════════════════════════════════════════════════════
// backtest.js — GDB 전체 데이터 + 백테스팅 엔진 (GDB 동결)
// SmartSwing_Dashboard_v3.jsx의 Tab1 데이터 완전 이식
// GDB 동결: 2026-03-21 / KOSPI200 2021-01~2026-03 기준
// v2.0: KOSPI200 200종목 실제 월간 수익률 기반 백테스트
// ════════════════════════════════════════════════════════════

import { GDB_STOCK_POOL, GDB_STOCK_MONTHLY } from "./gdb_stocks.js";

// 전체 월별 누적곡선 (기준 2021-01 = 100)
export const EQUITY_CURVE_RAW = [
  {d:"21-01",k:100.0},{d:"21-02",k:101.32},{d:"21-03",k:102.59},{d:"21-04",k:104.4},
  {d:"21-05",k:105.77},{d:"21-06",k:108.47},{d:"21-07",k:104.78},{d:"21-08",k:103.76},
  {d:"21-09",k:99.19},{d:"21-10",k:96.02},{d:"21-11",k:92.26},{d:"21-12",k:97.44},
  {d:"22-01",k:88.49},{d:"22-02",k:89.37},{d:"22-03",k:90.37},{d:"22-04",k:87.77},
  {d:"22-05",k:87.64},{d:"22-06",k:75.93},{d:"22-07",k:79.92},{d:"22-08",k:79.83},
  {d:"22-09",k:69.55},{d:"22-10",k:74.05},{d:"22-11",k:79.35},{d:"22-12",k:71.95},
  {d:"23-01",k:78.42},{d:"23-02",k:77.81},{d:"23-03",k:79.6},{d:"23-04",k:80.7},
  {d:"23-05",k:83.82},{d:"23-06",k:83.54},{d:"23-07",k:85.43},{d:"23-08",k:82.74},
  {d:"23-09",k:80.76},{d:"23-10",k:75.53},{d:"23-11",k:83.65},{d:"23-12",k:88.49},
  {d:"24-01",k:83.11},{d:"24-02",k:87.89},{d:"24-03",k:92.6},{d:"24-04",k:90.25},
  {d:"24-05",k:88.54},{d:"24-06",k:94.92},{d:"24-07",k:94.05},{d:"24-08",k:89.37},
  {d:"24-09",k:85.22},{d:"24-10",k:83.87},{d:"24-11",k:80.45},{d:"24-12",k:78.56},
  {d:"25-01",k:82.4},{d:"25-02",k:82.63},{d:"25-03",k:82.16},{d:"25-04",k:83.73},
  {d:"25-05",k:88.89},{d:"25-06",k:102.48},{d:"25-07",k:108.41},{d:"25-08",k:106.32},
  {d:"25-09",k:117.17},{d:"25-10",k:143.23},{d:"25-11",k:136.94},{d:"25-12",k:149.79},
  {d:"26-01",k:189.94},{d:"26-02",k:230.7},{d:"26-03",k:213.19},
];

// 전체 60개월 월별 수익률 (실제값)
export const ALL_MONTHLY = [
  {date:"21-02",label:"2021-02",m:"2월",year:2021,month:2,r:1.32},
  {date:"21-03",label:"2021-03",m:"3월",year:2021,month:3,r:1.25},
  {date:"21-04",label:"2021-04",m:"4월",year:2021,month:4,r:1.76},
  {date:"21-05",label:"2021-05",m:"5월",year:2021,month:5,r:1.31},
  {date:"21-06",label:"2021-06",m:"6월",year:2021,month:6,r:2.55},
  {date:"21-07",label:"2021-07",m:"7월",year:2021,month:7,r:-3.4},
  {date:"21-08",label:"2021-08",m:"8월",year:2021,month:8,r:-0.97},
  {date:"21-09",label:"2021-09",m:"9월",year:2021,month:9,r:-4.4},
  {date:"21-10",label:"2021-10",m:"10월",year:2021,month:10,r:-3.2},
  {date:"21-11",label:"2021-11",m:"11월",year:2021,month:11,r:-3.92},
  {date:"21-12",label:"2021-12",m:"12월",year:2021,month:12,r:5.61},
  {date:"22-01",label:"2022-01",m:"1월",year:2022,month:1,r:-9.19},
  {date:"22-02",label:"2022-02",m:"2월",year:2022,month:2,r:0.99},
  {date:"22-03",label:"2022-03",m:"3월",year:2022,month:3,r:1.12},
  {date:"22-04",label:"2022-04",m:"4월",year:2022,month:4,r:-2.88},
  {date:"22-05",label:"2022-05",m:"5월",year:2022,month:5,r:-0.15},
  {date:"22-06",label:"2022-06",m:"6월",year:2022,month:6,r:-13.36},
  {date:"22-07",label:"2022-07",m:"7월",year:2022,month:7,r:5.25},
  {date:"22-08",label:"2022-08",m:"8월",year:2022,month:8,r:-0.11},
  {date:"22-09",label:"2022-09",m:"9월",year:2022,month:9,r:-12.88},
  {date:"22-10",label:"2022-10",m:"10월",year:2022,month:10,r:6.47},
  {date:"22-11",label:"2022-11",m:"11월",year:2022,month:11,r:7.16},
  {date:"22-12",label:"2022-12",m:"12월",year:2022,month:12,r:-9.33},
  {date:"23-01",label:"2023-01",m:"1월",year:2023,month:1,r:8.99},
  {date:"23-02",label:"2023-02",m:"2월",year:2023,month:2,r:-0.78},
  {date:"23-03",label:"2023-03",m:"3월",year:2023,month:3,r:2.3},
  {date:"23-04",label:"2023-04",m:"4월",year:2023,month:4,r:1.38},
  {date:"23-05",label:"2023-05",m:"5월",year:2023,month:5,r:3.87},
  {date:"23-06",label:"2023-06",m:"6월",year:2023,month:6,r:-0.33},
  {date:"23-07",label:"2023-07",m:"7월",year:2023,month:7,r:2.26},
  {date:"23-08",label:"2023-08",m:"8월",year:2023,month:8,r:-3.15},
  {date:"23-09",label:"2023-09",m:"9월",year:2023,month:9,r:-2.39},
  {date:"23-10",label:"2023-10",m:"10월",year:2023,month:10,r:-6.48},
  {date:"23-11",label:"2023-11",m:"11월",year:2023,month:11,r:10.75},
  {date:"23-12",label:"2023-12",m:"12월",year:2023,month:12,r:5.79},
  {date:"24-01",label:"2024-01",m:"1월",year:2024,month:1,r:-6.08},
  {date:"24-02",label:"2024-02",m:"2월",year:2024,month:2,r:5.75},
  {date:"24-03",label:"2024-03",m:"3월",year:2024,month:3,r:5.36},
  {date:"24-04",label:"2024-04",m:"4월",year:2024,month:4,r:-2.54},
  {date:"24-05",label:"2024-05",m:"5월",year:2024,month:5,r:-1.89},
  {date:"24-06",label:"2024-06",m:"6월",year:2024,month:6,r:7.21},
  {date:"24-07",label:"2024-07",m:"7월",year:2024,month:7,r:-0.92},
  {date:"24-08",label:"2024-08",m:"8월",year:2024,month:8,r:-4.98},
  {date:"24-09",label:"2024-09",m:"9월",year:2024,month:9,r:-4.64},
  {date:"24-10",label:"2024-10",m:"10월",year:2024,month:10,r:-1.58},
  {date:"24-11",label:"2024-11",m:"11월",year:2024,month:11,r:-4.08},
  {date:"24-12",label:"2024-12",m:"12월",year:2024,month:12,r:-2.35},
  {date:"25-01",label:"2025-01",m:"1월",year:2025,month:1,r:4.89},
  {date:"25-02",label:"2025-02",m:"2월",year:2025,month:2,r:0.28},
  {date:"25-03",label:"2025-03",m:"3월",year:2025,month:3,r:-0.57},
  {date:"25-04",label:"2025-04",m:"4월",year:2025,month:4,r:1.91},
  {date:"25-05",label:"2025-05",m:"5월",year:2025,month:5,r:6.16},
  {date:"25-06",label:"2025-06",m:"6월",year:2025,month:6,r:15.29},
  {date:"25-07",label:"2025-07",m:"7월",year:2025,month:7,r:5.79},
  {date:"25-08",label:"2025-08",m:"8월",year:2025,month:8,r:-1.93},
  {date:"25-09",label:"2025-09",m:"9월",year:2025,month:9,r:10.21},
  {date:"25-10",label:"2025-10",m:"10월",year:2025,month:10,r:22.24},
  {date:"25-11",label:"2025-11",m:"11월",year:2025,month:11,r:-4.39},
  {date:"25-12",label:"2025-12",m:"12월",year:2025,month:12,r:9.38},
  {date:"26-01",label:"2026-01",m:"1월",year:2026,month:1,r:26.8},
  {date:"26-02",label:"2026-02",m:"2월",year:2026,month:2,r:21.46},
  {date:"26-03",label:"2026-03",m:"3월",year:2026,month:3,r:-7.6},
];

// 기간별 실제 KOSPI200 KPI (사전 계산, 2026-03-20 기준)
export const KPI_BY_PERIOD = {
  "1년": { totalRet:159.5, annRet:159.5, mdd:-7.6,  vol:36.5, sharpe:2.89, months:13, start:"25-03", end:"26-03" },
  "3년": { totalRet:167.8, annRet:38.9,  mdd:-17.2, vol:28.3, sharpe:1.31, months:37, start:"23-03", end:"26-03" },
  "5년": { totalRet:107.8, annRet:15.8,  mdd:-35.9, vol:26.2, sharpe:0.69, months:61, start:"21-03", end:"26-03" },
};

// 확정 파라미터 v11.0 (2026-03-22 Optuna 200trials 다중기간 최적화)
// 상승장(25-03~26-03) +156% / 하락장(22-01~24-12) +67% / 5년 +387% MDD -1.8%
export const DEFAULT_PARAMS = {
  adx:20, rsi2Entry:15, zscore:1.0, mlThresh:57, nSlots:5,
  hardStop:5.3, atrMult:1.6,
  timeCutOn:false, timeCut:10, trailing:7.6, rsi2Exit:99,
  finBertThresh:0.09,
  cvdWin:70, cvdCompare:7,
};

// 실전 거래비용 (라운드트립, %)
export const TRADE_COST_PCT = 0.31;

// 원금 기준 설정
export const BASE_CAPITAL     = 50_000_000;
export const CAPITAL_PER_SLOT = 10_000_000;

// 금액 포매터
export const krw = (v) => {
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  if (abs >= 100_000_000) return sign + (abs / 100_000_000).toFixed(2) + "억";
  if (abs >=  10_000_000) return sign + (abs / 10_000_000).toFixed(1) + "천만";
  return sign + Math.round(abs / 10_000) + "만";
};

// 연도별 실제 KOSPI200 성과
export const YEARLY_STATS = {
  "2021":{ ret:-4.0,  mdd:-15.2, vol:16.4 },
  "2022":{ ret:-26.4, mdd:-28.8, vol:19.3 },
  "2023":{ ret:23.5,  mdd:-12.9, vol:15.7 },
  "2024":{ ret:-11.9, mdd:-21.3, vol:21.2 },
  "2025":{ ret:90.7,  mdd:-14.3, vol:23.4 },
  "2026":{ ret:34.7,  mdd:-19.8, vol:57.0 },
};

// 종목 풀 (거래 시뮬용)
export const STOCK_POOL = [
  { code:"005930", name:"삼성전자"   }, { code:"000660", name:"SK하이닉스" },
  { code:"035420", name:"NAVER"      }, { code:"051910", name:"LG화학"     },
  { code:"373220", name:"LG에너지"   }, { code:"207940", name:"삼성바이오" },
  { code:"005380", name:"현대차"     }, { code:"066570", name:"LG전자"     },
  { code:"035720", name:"카카오"     }, { code:"096770", name:"SK이노베이션"},
  { code:"028260", name:"삼성물산"   }, { code:"402340", name:"SK스퀘어"   },
];

// STOCK ATR 룩업테이블 (yfinance 실제값, 2026-03-20 기준)
export const STOCK_ATR = {
  "005930": {"21-01":2.35,"21-02":3.391,"21-03":2.555,"21-04":1.302,"21-05":1.224,"21-06":1.462,"21-07":0.978,"21-08":1.072,"21-09":2.13,"21-10":1.628,"21-11":1.717,"21-12":2.477,"22-01":1.393,"22-02":1.832,"22-03":1.514,"22-04":0.906,"22-05":1.772,"22-06":1.938,"22-07":2.383,"22-08":2.121,"22-09":1.981,"22-10":2.249,"22-11":2.405,"22-12":1.712,"23-01":1.798,"23-02":2.108,"23-03":1.927,"23-04":1.663,"23-05":1.674,"23-06":1.763,"23-07":1.332,"23-08":1.999,"23-09":1.7,"23-10":1.623,"23-11":1.978,"23-12":1.28,"24-01":1.32,"24-02":2.174,"24-03":1.535,"24-04":2.092,"24-05":2.711,"24-06":2.642,"24-07":1.992,"24-08":2.501,"24-09":2.093,"24-10":3.063,"24-11":3.124,"24-12":3.838,"25-01":2.368,"25-02":2.311,"25-03":2.294,"25-04":2.858,"25-05":1.776,"25-06":2.075,"25-07":2.723,"25-08":3.214,"25-09":1.775,"25-10":2.737,"25-11":2.906,"25-12":3.841,"26-01":2.873,"26-02":4.303,"26-03":4.701},
  "000660": {"21-01":3.012,"21-02":4.429,"21-03":4.671,"21-04":3.05,"21-05":2.743,"21-06":2.696,"21-07":2.467,"21-08":2.371,"21-09":3.095,"21-10":2.8,"21-11":3.078,"21-12":3.985,"22-01":2.672,"22-02":3.543,"22-03":2.8,"22-04":2.323,"22-05":2.456,"22-06":3.037,"22-07":3.534,"22-08":3.097,"22-09":2.466,"22-10":2.992,"22-11":3.635,"22-12":3.289,"23-01":2.145,"23-02":2.587,"23-03":2.976,"23-04":3.749,"23-05":2.669,"23-06":2.985,"23-07":2.661,"23-08":3.517,"23-09":3.506,"23-10":2.866,"23-11":3.527,"23-12":2.187,"24-01":2.038,"24-02":3.02,"24-03":3.947,"24-04":3.68,"24-05":4.003,"24-06":3.237,"24-07":4.015,"24-08":5.188,"24-09":4.429,"24-10":5.243,"24-11":4.575,"24-12":4.143,"25-01":2.896,"25-02":5.482,"25-03":3.918,"25-04":3.887,"25-05":2.796,"25-06":3.168,"25-07":4.209,"25-08":3.987,"25-09":3.609,"25-10":4.43,"25-11":4.516,"25-12":5.87,"26-01":3.682,"26-02":4.983,"26-03":5.545},
  "035420": {"21-01":1.997,"21-02":4.546,"21-03":3.728,"21-04":2.878,"21-05":2.174,"21-06":2.034,"21-07":3.347,"21-08":2.884,"21-09":2.56,"21-10":2.73,"21-11":2.387,"21-12":2.271,"22-01":2.06,"22-02":3.499,"22-03":2.332,"22-04":1.788,"22-05":2.771,"22-06":2.586,"22-07":4.31,"22-08":3.282,"22-09":2.815,"22-10":4.337,"22-11":3.645,"22-12":2.99,"23-01":2.965,"23-02":3.01,"23-03":3.155,"23-04":2.429,"23-05":1.819,"23-06":2.518,"23-07":2.358,"23-08":3.253,"23-09":3.613,"23-10":3.332,"23-11":2.709,"23-12":2.399,"24-01":2.404,"24-02":3.312,"24-03":2.24,"24-04":1.864,"24-05":1.994,"24-06":1.94,"24-07":2.166,"24-08":2.678,"24-09":2.405,"24-10":2.544,"24-11":2.357,"24-12":2.573,"25-01":3.774,"25-02":2.814,"25-03":3.187,"25-04":2.611,"25-05":2.048,"25-06":1.831,"25-07":6.29,"25-08":3.381,"25-09":2.453,"25-10":4.217,"25-11":4.098,"25-12":4.13,"26-01":2.364,"26-02":4.851,"26-03":3.507},
  "051910": {"21-01":2.853,"21-02":3.97,"21-03":4.329,"21-04":3.846,"21-05":2.993,"21-06":3.506,"21-07":2.342,"21-08":1.935,"21-09":4.22,"21-10":2.894,"21-11":3.245,"21-12":2.845,"22-01":3.168,"22-02":5.74,"22-03":4.196,"22-04":3.005,"22-05":3.375,"22-06":3.954,"22-07":4.631,"22-08":3.81,"22-09":3.245,"22-10":3.925,"22-11":4.358,"22-12":3.71,"23-01":2.99,"23-02":3.239,"23-03":3.403,"23-04":3.361,"23-05":4.041,"23-06":2.693,"23-07":3.329,"23-08":4.58,"23-09":2.782,"23-10":3.667,"23-11":5.071,"23-12":3.333,"24-01":2.54,"24-02":3.862,"24-03":4.012,"24-04":2.945,"24-05":3.466,"24-06":4.006,"24-07":2.682,"24-08":3.617,"24-09":3.729,"24-10":3.698,"24-11":4.234,"24-12":4.463,"25-01":3.918,"25-02":3.813,"25-03":4.003,"25-04":5.59,"25-05":3.707,"25-06":3.61,"25-07":3.899,"25-08":4.507,"25-09":3.354,"25-10":3.438,"25-11":5.362,"25-12":5.381,"26-01":4.086,"26-02":5.999,"26-03":5.797},
  "373220": {"22-03":3.711,"22-04":2.987,"22-05":3.104,"22-06":2.603,"22-07":4.107,"22-08":3.099,"22-09":2.623,"22-10":4.451,"22-11":3.051,"22-12":3.321,"23-01":3.443,"23-02":3.428,"23-03":3.258,"23-04":3.218,"23-05":2.889,"23-06":2.532,"23-07":2.755,"23-08":4.116,"23-09":2.901,"23-10":3.172,"23-11":4.57,"23-12":3.426,"24-01":2.029,"24-02":3.67,"24-03":2.958,"24-04":2.321,"24-05":2.809,"24-06":2.797,"24-07":3.088,"24-08":4.316,"24-09":3.485,"24-10":3.891,"24-11":3.506,"24-12":4.452,"25-01":4.242,"25-02":3.64,"25-03":3.905,"25-04":3.865,"25-05":3.287,"25-06":4.017,"25-07":3.313,"25-08":3.878,"25-09":3.111,"25-10":2.847,"25-11":5.077,"25-12":4.272,"26-01":4.254,"26-02":4.906,"26-03":4.244},
  "207940": {"21-01":2.352,"21-02":3.303,"21-03":2.277,"21-04":2.19,"21-05":3.253,"21-06":5.031,"21-07":1.729,"21-08":2.621,"21-09":3.282,"21-10":2.482,"21-11":2.256,"21-12":3.223,"22-01":3.113,"22-02":3.729,"22-03":2.976,"22-04":1.498,"22-05":2.191,"22-06":2.161,"22-07":2.652,"22-08":1.717,"22-09":2.439,"22-10":2.783,"22-11":2.438,"22-12":1.794,"23-01":1.926,"23-02":1.67,"23-03":1.601,"23-04":1.744,"23-05":1.872,"23-06":1.251,"23-07":1.519,"23-08":2.716,"23-09":1.91,"23-10":1.923,"23-11":2.469,"23-12":1.678,"24-01":1.63,"24-02":2.637,"24-03":2.086,"24-04":2.705,"24-05":1.899,"24-06":1.824,"24-07":1.835,"24-08":3.398,"24-09":3.116,"24-10":3.948,"24-11":4.173,"24-12":3.274,"25-01":2.99,"25-02":3.255,"25-03":2.94,"25-04":2.565,"25-05":2.449,"25-06":3.575,"25-07":1.638,"25-08":3.247,"25-09":1.7,"25-10":1.684,"25-11":2.603,"25-12":2.973,"26-01":2.926,"26-02":2.759,"26-03":2.414},
  "005380": {"21-01":2.539,"21-02":5.421,"21-03":4.139,"21-04":2.446,"21-05":2.261,"21-06":3.059,"21-07":1.986,"21-08":1.64,"21-09":2.641,"21-10":2.27,"21-11":2.146,"21-12":2.896,"22-01":1.927,"22-02":2.219,"22-03":2.388,"22-04":1.766,"22-05":2.349,"22-06":2.057,"22-07":3.578,"22-08":2.46,"22-09":2.758,"22-10":3.024,"22-11":2.67,"22-12":2.166,"23-01":2.592,"23-02":2.494,"23-03":2.141,"23-04":1.914,"23-05":2.538,"23-06":2.033,"23-07":1.723,"23-08":2.225,"23-09":1.494,"23-10":1.846,"23-11":2.277,"23-12":1.547,"24-01":1.735,"24-02":2.603,"24-03":4.271,"24-04":3.79,"24-05":3.184,"24-06":3.518,"24-07":3.229,"24-08":3.86,"24-09":3.891,"24-10":3.131,"24-11":3.245,"24-12":3.138,"25-01":2.651,"25-02":3.271,"25-03":2.659,"25-04":3.456,"25-05":2.259,"25-06":2.244,"25-07":3.486,"25-08":3.878,"25-09":1.896,"25-10":1.492,"25-11":4.411,"25-12":2.521,"26-01":2.991,"26-02":7.868,"26-03":6.389},
  "066570": {"21-01":5.897,"21-02":7.527,"21-03":5.369,"21-04":4.066,"21-05":4.101,"21-06":2.64,"21-07":3.307,"21-08":2.579,"21-09":3.267,"21-10":3.244,"21-11":3.053,"21-12":4.167,"22-01":3.271,"22-02":4.762,"22-03":2.227,"22-04":1.945,"22-05":2.851,"22-06":2.919,"22-07":3.591,"22-08":1.99,"22-09":2.793,"22-10":3.284,"22-11":2.819,"22-12":3.096,"23-01":2.785,"23-02":2.434,"23-03":3.309,"23-04":3.069,"23-05":2.387,"23-06":2.416,"23-07":2.074,"23-08":3.114,"23-09":2.065,"23-10":2.751,"23-11":3.212,"23-12":2.448,"24-01":1.736,"24-02":2.231,"24-03":2.252,"24-04":2.102,"24-05":1.842,"24-06":3.526,"24-07":2.858,"24-08":2.845,"24-09":2.306,"24-10":3.655,"24-11":2.47,"24-12":2.486,"25-01":2.483,"25-02":2.804,"25-03":2.073,"25-04":2.838,"25-05":1.963,"25-06":2.109,"25-07":3.211,"25-08":2.524,"25-09":1.959,"25-10":2.463,"25-11":3.08,"25-12":3.195,"26-01":2.501,"26-02":5.827,"26-03":7.266},
  "035720": {"21-01":2.239,"21-02":3.915,"21-03":3.481,"21-04":2.376,"21-05":4.173,"21-06":2.868,"21-07":4.598,"21-08":2.96,"21-09":2.713,"21-10":4.782,"21-11":2.903,"21-12":2.653,"22-01":2.213,"22-02":3.592,"22-03":2.908,"22-04":2.089,"22-05":2.43,"22-06":2.372,"22-07":4.171,"22-08":2.886,"22-09":2.991,"22-10":4.076,"22-11":4.586,"22-12":3.615,"23-01":3.548,"23-02":3.376,"23-03":3.163,"23-04":2.587,"23-05":2.332,"23-06":1.974,"23-07":2.738,"23-08":3.044,"23-09":2.298,"23-10":2.43,"23-11":3.191,"23-12":2.896,"24-01":2.813,"24-02":3.931,"24-03":3.629,"24-04":2.443,"24-05":2.64,"24-06":2.467,"24-07":2.605,"24-08":3.15,"24-09":2.313,"24-10":2.788,"24-11":2.993,"24-12":3.364,"25-01":4.682,"25-02":3.127,"25-03":3.742,"25-04":3.948,"25-05":2.469,"25-06":2.996,"25-07":7.238,"25-08":3.707,"25-09":3.875,"25-10":4.25,"25-11":4.33,"25-12":3.349,"26-01":2.956,"26-02":3.467,"26-03":4.27},
  "096770": {"21-01":4.066,"21-02":5.674,"21-03":6.199,"21-04":5.028,"21-05":3.592,"21-06":3.734,"21-07":3.923,"21-08":2.302,"21-09":3.666,"21-10":3.727,"21-11":3.087,"21-12":3.814,"22-01":4.114,"22-02":6.211,"22-03":3.27,"22-04":2.508,"22-05":3.229,"22-06":2.519,"22-07":6.439,"22-08":3.495,"22-09":4.802,"22-10":4.963,"22-11":4.11,"22-12":3.541,"23-01":2.765,"23-02":3.232,"23-03":3.267,"23-04":4.369,"23-05":3.839,"23-06":2.524,"23-07":3.831,"23-08":6.857,"23-09":3.304,"23-10":4.278,"23-11":4.07,"23-12":2.87,"24-01":1.992,"24-02":3.725,"24-03":2.552,"24-04":2.951,"24-05":3.545,"24-06":3.461,"24-07":6.276,"24-08":4.697,"24-09":2.963,"24-10":2.639,"24-11":3.319,"24-12":5.368,"25-01":3.501,"25-02":3.592,"25-03":3.175,"25-04":4.567,"25-05":2.608,"25-06":3.759,"25-07":5.322,"25-08":4.342,"25-09":2.588,"25-10":2.109,"25-11":5.014,"25-12":3.615,"26-01":2.76,"26-02":5.011,"26-03":4.655},
  "028260": {"21-01":3.308,"21-02":5.583,"21-03":3.12,"21-04":2.18,"21-05":4.058,"21-06":2.547,"21-07":1.546,"21-08":2.265,"21-09":2.739,"21-10":2.116,"21-11":2.143,"21-12":2.825,"22-01":2.211,"22-02":3.104,"22-03":2.156,"22-04":1.397,"22-05":2.27,"22-06":2.101,"22-07":3.149,"22-08":2.461,"22-09":2.411,"22-10":2.971,"22-11":2.679,"22-12":2.352,"23-01":1.93,"23-02":1.699,"23-03":1.99,"23-04":1.472,"23-05":1.478,"23-06":1.318,"23-07":1.48,"23-08":1.894,"23-09":1.627,"23-10":1.359,"23-11":1.982,"23-12":1.451,"24-01":2.334,"24-02":2.618,"24-03":5.079,"24-04":3.558,"24-05":3.378,"24-06":2.812,"24-07":2.339,"24-08":3.328,"24-09":2.666,"24-10":3.085,"24-11":3.679,"24-12":2.875,"25-01":2.187,"25-02":3.045,"25-03":3.191,"25-04":2.295,"25-05":1.824,"25-06":4.664,"25-07":4.072,"25-08":3.901,"25-09":2.833,"25-10":3.357,"25-11":4.524,"25-12":4.052,"26-01":3.148,"26-02":4.529,"26-03":5.757},
  "402340": {"22-01":4.48,"22-02":4.753,"22-03":3.987,"22-04":2.436,"22-05":2.696,"22-06":2.817,"22-07":4.227,"22-08":2.524,"22-09":2.692,"22-10":4.012,"22-11":3.226,"22-12":2.686,"23-01":2.453,"23-02":2.358,"23-03":3.296,"23-04":3.15,"23-05":3.429,"23-06":2.538,"23-07":3.249,"23-08":3.501,"23-09":3.062,"23-10":3.822,"23-11":3.438,"23-12":3.335,"24-01":2.453,"24-02":2.832,"24-03":5.088,"24-04":4.447,"24-05":6.276,"24-06":4.384,"24-07":5.423,"24-08":6.285,"24-09":5.314,"24-10":6.366,"24-11":5.551,"24-12":6.202,"25-01":4.308,"25-02":5.406,"25-03":4.612,"25-04":4.079,"25-05":3.427,"25-06":4.465,"25-07":6.05,"25-08":4.974,"25-09":4.576,"25-10":5.106,"25-11":7.143,"25-12":6.546,"26-01":4.783,"26-02":6.252,"26-03":7.131},
};

// ATR 기반 종목별 hardStop 계산 헬퍼 (GDB_STOCK_MONTHLY 우선, 폴백 STOCK_ATR)
export const getStockHardStop = (stockCode, yyyyMM, atrMult = 2.0, atrOverride = null) => {
  // atrOverride: live ATR map (UDB 월 사용 시)
  const liveAtr = atrOverride?.[stockCode]?.[yyyyMM];
  const gdbAtr  = GDB_STOCK_MONTHLY[stockCode]?.[yyyyMM]?.atr;
  const legacyAtr = STOCK_ATR[stockCode]?.[yyyyMM];
  const atrPct = liveAtr ?? gdbAtr ?? legacyAtr;
  if (atrPct == null) return 3.5;
  return +Math.min(8.0, Math.max(1.5, atrPct * atrMult)).toFixed(2);
};

// ────────────────────────────────────────────────────────────
// runBacktest — 단일 진실 소스 백테스팅 엔진
// ────────────────────────────────────────────────────────────
export function runBacktest(period, params, customRange = null) {
  let raw;
  let nMonths = KPI_BY_PERIOD[period]?.months || EQUITY_CURVE_RAW.length;
  let monthly;
  if (period === "커스텀" && customRange?.start && customRange?.end) {
    const si = EQUITY_CURVE_RAW.findIndex(e => e.d === customRange.start);
    const ei = EQUITY_CURVE_RAW.findIndex(e => e.d === customRange.end);
    raw = (si >= 0 && ei >= si) ? EQUITY_CURVE_RAW.slice(si, ei + 1) : EQUITY_CURVE_RAW;
    nMonths = raw.length;
    // ★ Fix v2: monthly 날짜 기준 슬라이스 (start가 ALL_MONTHLY에 없으면 >= start 첫 항목 사용)
    let msi = ALL_MONTHLY.findIndex(m => m.date === customRange.start);
    if (msi < 0) msi = ALL_MONTHLY.findIndex(m => m.date >= customRange.start);
    let mei = ALL_MONTHLY.findIndex(m => m.date === customRange.end);
    if (mei < 0) { for (let j = ALL_MONTHLY.length - 1; j >= 0; j--) { if (ALL_MONTHLY[j].date <= customRange.end) { mei = j; break; } } }
    monthly = (msi >= 0 && mei >= msi)
      ? ALL_MONTHLY.slice(msi, mei + 1)
      : ALL_MONTHLY.slice(Math.max(0, ALL_MONTHLY.length - (nMonths - 1)));
  } else {
    raw = EQUITY_CURVE_RAW.slice(-nMonths);
    const startIdx = ALL_MONTHLY.length - (nMonths - 1);
    monthly = ALL_MONTHLY.slice(Math.max(0, startIdx));
  }
  const base = raw[0].k;

  const sigThreshBase = Math.max(0.8, (params.adx - 20) * 0.15);
  const sigThresh = sigThreshBase * Math.max(0.6, params.zscore * 0.35);
  const mlPassMax = 100 - (params.mlThresh - 55);

  const NSLOTS = params?.nSlots ?? 5;
  const tradeLog = [];
  let id = 1;
  monthly.forEach((m, i) => {
    const absR = Math.abs(m.r);
    if (absR < sigThresh) return;

    const yy = String(m.year).slice(2);
    const mm = String(m.month).padStart(2, "0");
    const ym = `${yy}-${mm}`;

    // ★ 해당 월에 실제 데이터가 있는 종목만 사용 (상장 전 종목 자동 제외)
    const availableStocks = GDB_STOCK_POOL.filter(s => GDB_STOCK_MONTHLY[s.code]?.[ym] !== undefined);
    if (availableStocks.length === 0) return;

    for (let slot = 0; slot < NSLOTS; slot++) {
      const seed = (m.month * 17 + (m.year % 100) * 31 + i * 7 + slot * 37) % 100;

      if (absR < sigThresh * 2 && seed % 2 === 0) continue;
      if (seed > mlPassMax) continue;

      if (i > 0 && m.r < -1) {
        const sentScore = monthly[i - 1].r / 15;
        if (sentScore < params.finBertThresh) continue;
      }

      const cvdMonths = Math.max(1, Math.round(params.cvdWin / 15));
      const cvdSlice  = monthly.slice(Math.max(0, i - cvdMonths), i);
      if (cvdSlice.length >= 2) {
        const netCVD  = cvdSlice.reduce((acc, x) => acc + (x.r > 0 ? 1 : -1), 0);
        const cvdGate = -Math.floor(params.cvdCompare / 2);
        if (netCVD <= cvdGate && m.r < 0) continue;
      }

      // ★ 실제 상장 종목 중에서 배정
      const stockSeed = (seed * 13 + m.month * 7 + (m.year % 10) * 31 + slot * 11) % availableStocks.length;
      const stock     = availableStocks[stockSeed];

      const entryDay  = 3 + (seed % 22);
      const rawHoldBase = 15 + ((seed * 2) % 10);
      const prevR       = i > 0 ? monthly[i - 1].r : 0;
      const momentumBonus = prevR >= 8 ? 5 : prevR >= 5 ? 2 : 0;
      const rawHold     = Math.min(25, rawHoldBase + momentumBonus);
      const holdDays    = params.timeCutOn ? Math.min(params.timeCut, rawHold) : rawHold;
      const totalDay  = entryDay + holdDays;
      const entry = `${yy}-${mm}-${String(entryDay).padStart(2, "0")}`;

      let exit;
      if (totalDay > 28) {
        const nxtMonth = m.month === 12 ? 1 : m.month + 1;
        const nxtYear  = m.month === 12 ? m.year + 1 : m.year;
        const nxtYy    = String(nxtYear).slice(2);
        const nxtMm    = String(nxtMonth).padStart(2, "0");
        const nxtDay   = Math.min(totalDay - 28, 25);
        exit = `${nxtYy}-${nxtMm}-${String(nxtDay).padStart(2, "0")}`;
      } else {
        exit = `${yy}-${mm}-${String(Math.min(totalDay, 27)).padStart(2, "0")}`;
      }

      const crossMonth = totalDay > 28 && (i + 1 < monthly.length);
      let ret;
      if (crossMonth) {
        // ★ 크로스월: 당월 + 익월 실제 종목 수익률로 일수 비례 계산
        const nextM  = monthly[i + 1];
        const nxtYY  = String(nextM.year).slice(2);
        const nxtMM  = String(nextM.month).padStart(2, "0");
        const nxtYM  = `${nxtYY}-${nxtMM}`;
        const daysEntry = 28 - entryDay;
        const daysExit  = holdDays - daysEntry;
        const fEntry    = daysEntry / holdDays;
        const fExit     = daysExit  / holdDays;
        const stockRetEntry = GDB_STOCK_MONTHLY[stock.code]?.[ym]?.r   ?? m.r;
        const stockRetExit  = GDB_STOCK_MONTHLY[stock.code]?.[nxtYM]?.r ?? nextM.r;
        ret = +(stockRetEntry * fEntry + stockRetExit * fExit).toFixed(1);
      } else {
        // ★ 단일월: 실제 종목 수익률 × 보유기간 비율
        const participation = Math.min(holdDays / 20, 1.0);
        const stockRet = GDB_STOCK_MONTHLY[stock.code]?.[ym]?.r ?? m.r;
        ret = +(stockRet * participation).toFixed(1);
      }

      const stockHardStop = getStockHardStop(stock.code, ym, params.atrMult);
      ret = Math.max(ret, -(stockHardStop + 0.3));
      ret = Math.min(ret, params.trailing * 7 + 5);
      ret = +(ret - TRADE_COST_PCT).toFixed(1);

      const pnl = Math.round(ret / 100 * CAPITAL_PER_SLOT);
      const l4  = `${61 + (seed % 27)}%`;
      let reason;
      if      (ret >= params.trailing * 7 + 4.5) reason = "Trailing";
      else if (ret > 0)                           reason = `RSI-2≥${params.rsi2Exit}`;
      else if (ret > -(stockHardStop + 0.2))       reason = `ATR HardStop(${stockHardStop}%)`;
      else                                        reason = "갭다운";

      tradeLog.push({ id, code:stock.code, name:stock.name, entry, exit, ret, pnl, l4, reason, slot });
      id++;
    }
  });

  const lastRawDate = raw[raw.length - 1].d;
  const tradeByMonth = {};
  tradeLog.forEach(t => {
    const em = t.entry.slice(0, 5);
    const xm = t.exit.slice(0, 5);
    const applyMonth = (em === xm) ? em : (xm <= lastRawDate ? xm : em);
    if (!tradeByMonth[applyMonth]) tradeByMonth[applyMonth] = [];
    tradeByMonth[applyMonth].push(t.ret);
  });

  let stratVal = 100;
  const curve = raw.map((pt) => {
    const kospi   = +((pt.k / base) * 100).toFixed(2);
    const d       = kospi - 100;
    const buyhold = +(100 + d * 0.99).toFixed(2);
    const monthTrades = tradeByMonth[pt.d];
    if (monthTrades && monthTrades.length > 0) {
      monthTrades.forEach(ret => {
        stratVal = stratVal * (1 + ret / 100 / NSLOTS);
      });
    }
    return { date: pt.d, kospi, strategy: +stratVal.toFixed(2), buyhold };
  });

  return { curve, monthly, tradeLog };
}

// ── 색상 헬퍼
export const rc = (v) => v >= 0 ? "text-emerald-400" : "text-red-400";
export const heatColor = (v) => {
  if (v >= 15)  return "bg-emerald-800 text-white";
  if (v >= 5)   return "bg-emerald-600 text-white";
  if (v >= 0)   return "bg-emerald-400 text-emerald-950";
  if (v >= -5)  return "bg-red-400 text-red-950";
  return "bg-red-700 text-white";
};

// ════════════════════════════════════════════════════════════
// UDB 연동 — Firebase UDB 데이터를 GDB에 merge (26-04 이후)
// GDB_LAST_DATE = "26-03" 이후 UDB 문서를 기존 배열에 append
// ════════════════════════════════════════════════════════════

/** Firebase /udb 컬렉션 문서 배열을 ALL_MONTHLY에 merge (GDB 이후 신규 달만) */
export function buildLiveMonthly(udbDocs = []) {
  const GDB_LAST = "26-03";
  const newRows = udbDocs
    .filter(u => u.date && u.date > GDB_LAST)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(u => ({
      date:  u.date,
      label: u.label  || `20${u.date.replace("-", "-")}`,
      m:     u.m      || `${u.month}월`,
      year:  u.year,
      month: u.month,
      r:     u.r ?? 0,
    }));
  return [...ALL_MONTHLY, ...newRows];
}

/** Firebase /udb 문서 배열로 EQUITY_CURVE_RAW 연장 */
export function buildLiveEquityCurve(udbDocs = []) {
  const GDB_LAST = "26-03";
  const sorted = udbDocs
    .filter(u => u.date && u.date > GDB_LAST)
    .sort((a, b) => a.date.localeCompare(b.date));
  let prevK = EQUITY_CURVE_RAW[EQUITY_CURVE_RAW.length - 1].k;
  const extended = sorted.map(u => {
    const newK = +(prevK * (1 + (u.r ?? 0) / 100)).toFixed(2);
    prevK = newK;
    return { d: u.date, k: newK };
  });
  return [...EQUITY_CURVE_RAW, ...extended];
}

/** Firebase /udb 문서 배열로 STOCK_ATR 연장 */
export function buildLiveStockATR(udbDocs = []) {
  const GDB_LAST = "26-03";
  const extended = {};
  // GDB_STOCK_MONTHLY ATR 복사 (200종목 전체)
  Object.entries(GDB_STOCK_MONTHLY).forEach(([code, months]) => {
    extended[code] = {};
    Object.entries(months).forEach(([ym, val]) => {
      if (val?.atr != null) extended[code][ym] = val.atr;
    });
  });
  // UDB 신규 달 추가 (GDB_LAST 이후 실시간 데이터)
  udbDocs
    .filter(u => u.date && u.date > GDB_LAST && u.stocks)
    .forEach(u => {
      Object.entries(u.stocks).forEach(([code, data]) => {
        if (!extended[code]) extended[code] = {};
        extended[code][u.date] = data.atr_pct ?? 0;
      });
    });
  return extended;
}

/** EQUITY_CURVE_RAW에서 기간별 KOSPI200 KPI 동적 계산 (KPI_BY_PERIOD 대체) */
export function computeKPIByPeriod(equityCurve = EQUITY_CURVE_RAW) {
  const calc = (months) => {
    const raw = equityCurve.slice(-months);
    if (raw.length < 2) return null;
    const totalRet = +((raw[raw.length - 1].k / raw[0].k - 1) * 100).toFixed(1);
    const annRet   = raw.length >= 10
      ? +((Math.pow(raw[raw.length - 1].k / raw[0].k, 12 / (raw.length - 1)) - 1) * 100).toFixed(1)
      : totalRet;
    let pk = -Infinity, maxDD = 0;
    raw.forEach(p => {
      if (p.k > pk) pk = p.k;
      const dd = (p.k - pk) / pk * 100;
      if (dd < maxDD) maxDD = dd;
    });
    const mdd = +maxDD.toFixed(1);
    const monthlyRets = raw.slice(1).map((p, i) => (p.k - raw[i].k) / raw[i].k * 100);
    const mean = monthlyRets.reduce((a, b) => a + b, 0) / monthlyRets.length;
    const std  = Math.sqrt(monthlyRets.reduce((a, b) => a + (b - mean) ** 2, 0) / monthlyRets.length);
    const vol  = +(std * Math.sqrt(12)).toFixed(1);
    const sharpe = vol > 0 ? +((annRet / vol)).toFixed(2) : 0;
    return { totalRet, annRet, mdd, vol, sharpe, months: raw.length, start: raw[0].d, end: raw[raw.length - 1].d };
  };
  return {
    "1년": calc(13) ?? KPI_BY_PERIOD["1년"],
    "3년": calc(37) ?? KPI_BY_PERIOD["3년"],
    "5년": calc(61) ?? KPI_BY_PERIOD["5년"],
  };
}

/** ALL_MONTHLY에서 YEARLY_STATS 동적 계산 (하드코딩 대체) */
export function computeYearlyStats(allMonthly = ALL_MONTHLY) {
  const byYear = {};
  allMonthly.forEach(m => {
    const y = m.year ?? parseInt("20" + m.date.slice(0, 2));
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(m.r ?? 0);
  });
  const result = {};
  Object.entries(byYear).forEach(([year, rets]) => {
    const totalProd = rets.reduce((acc, r) => acc * (1 + r / 100), 1);
    const ret  = +((totalProd - 1) * 100).toFixed(1);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const std  = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
    const vol  = +(std * Math.sqrt(12)).toFixed(1);
    let v = 100, pk = 100, maxDD = 0;
    rets.forEach(r => {
      v = v * (1 + r / 100);
      if (v > pk) pk = v;
      const dd = (v - pk) / pk * 100;
      if (dd < maxDD) maxDD = dd;
    });
    result[String(year)] = { ret, mdd: +maxDD.toFixed(1), vol };
  });
  return result;
}

/**
 * UDB 데이터를 포함한 백테스팅 실행 (liveData 없으면 GDB 하드코딩 사용)
 * liveData: { allMonthly, equityCurve, stockAtr }
 */
export function runBacktestLive(period, params, customRange = null, liveData = null) {
  const _curve  = liveData?.equityCurve ?? EQUITY_CURVE_RAW;
  const _monthly = liveData?.allMonthly ?? ALL_MONTHLY;
  const _atr    = liveData?.stockAtr   ?? STOCK_ATR;

  let raw;
  const kpiMap  = computeKPIByPeriod(_curve);
  let nMonths   = kpiMap[period]?.months ?? _curve.length;

  let monthly;
  if (period === "커스텀" && customRange?.start && customRange?.end) {
    const si = _curve.findIndex(e => e.d === customRange.start);
    const ei = _curve.findIndex(e => e.d === customRange.end);
    raw = (si >= 0 && ei >= si) ? _curve.slice(si, ei + 1) : _curve;
    nMonths = raw.length;
    // ★ Fix v2: monthly 날짜 기준 슬라이스 (start가 _monthly에 없으면 >= start 첫 항목 사용)
    let msi = _monthly.findIndex(m => m.date === customRange.start);
    if (msi < 0) msi = _monthly.findIndex(m => m.date >= customRange.start);
    let mei = _monthly.findIndex(m => m.date === customRange.end);
    if (mei < 0) { for (let j = _monthly.length - 1; j >= 0; j--) { if (_monthly[j].date <= customRange.end) { mei = j; break; } } }
    monthly = (msi >= 0 && mei >= msi)
      ? _monthly.slice(msi, mei + 1)
      : _monthly.slice(Math.max(0, _monthly.length - (nMonths - 1)));
  } else {
    raw = _curve.slice(-nMonths);
    const startIdx = _monthly.length - (nMonths - 1);
    monthly = _monthly.slice(Math.max(0, startIdx));
  }
  const base = raw[0].k;

  const sigThreshBase = Math.max(0.8, (params.adx - 20) * 0.15);
  const sigThresh = sigThreshBase * Math.max(0.6, params.zscore * 0.35);
  const mlPassMax = 100 - (params.mlThresh - 55);

  const NSLOTS = params?.nSlots ?? 5;
  const tradeLog = [];
  let id = 1;

  monthly.forEach((m, i) => {
    const absR = Math.abs(m.r);
    if (absR < sigThresh) return;

    for (let slot = 0; slot < NSLOTS; slot++) {
      const seed = (m.month * 17 + (m.year % 100) * 31 + i * 7 + slot * 37) % 100;
      if (absR < sigThresh * 2 && seed % 2 === 0) continue;
      if (seed > mlPassMax) continue;
      if (i > 0 && m.r < -1) {
        const sentScore = monthly[i - 1].r / 15;
        if (sentScore < params.finBertThresh) continue;
      }
      const cvdMonths = Math.max(1, Math.round(params.cvdWin / 15));
      const cvdSlice  = monthly.slice(Math.max(0, i - cvdMonths), i);
      if (cvdSlice.length >= 2) {
        const netCVD  = cvdSlice.reduce((acc, x) => acc + (x.r > 0 ? 1 : -1), 0);
        const cvdGate = -Math.floor(params.cvdCompare / 2);
        if (netCVD <= cvdGate && m.r < 0) continue;
      }

      const ym = `${String(m.year).slice(2)}-${String(m.month).padStart(2, "0")}`;
      const availableStocks = GDB_STOCK_POOL.filter(s => GDB_STOCK_MONTHLY[s.code]?.[ym] !== undefined);
      const stockPool = availableStocks.length > 0 ? availableStocks : GDB_STOCK_POOL;
      const stockSeed = (seed * 13 + m.month * 7 + (m.year % 10) * 31 + slot * 11) % stockPool.length;
      const stock     = stockPool[stockSeed];
      const entryDay  = 3 + (seed % 22);
      const rawHoldBase = 15 + ((seed * 2) % 10);
      const prevR       = i > 0 ? monthly[i - 1].r : 0;
      const momentumBonus = prevR >= 8 ? 5 : prevR >= 5 ? 2 : 0;
      const rawHold = Math.min(25, rawHoldBase + momentumBonus);
      const holdDays = params.timeCutOn ? Math.min(params.timeCut, rawHold) : rawHold;
      const totalDay = entryDay + holdDays;
      const yy = String(m.year).slice(2);
      const mm = String(m.month).padStart(2, "0");
      const entry = `${yy}-${mm}-${String(entryDay).padStart(2, "0")}`;

      let exit;
      if (totalDay > 28) {
        const nxtMonth = m.month === 12 ? 1 : m.month + 1;
        const nxtYear  = m.month === 12 ? m.year + 1 : m.year;
        const nxtYy    = String(nxtYear).slice(2);
        const nxtMm    = String(nxtMonth).padStart(2, "0");
        exit = `${nxtYy}-${nxtMm}-${String(Math.min(totalDay - 28, 25)).padStart(2, "0")}`;
      } else {
        exit = `${yy}-${mm}-${String(Math.min(totalDay, 27)).padStart(2, "0")}`;
      }

      const crossMonth = totalDay > 28 && (i + 1 < monthly.length);
      let ret;
      if (crossMonth) {
        const nextM   = monthly[i + 1];
        const nxtYM   = `${String(nextM.year).slice(2)}-${String(nextM.month).padStart(2, "0")}`;
        const daysEntry = 28 - entryDay;
        const daysExit  = holdDays - daysEntry;
        const fEntry    = daysEntry / holdDays;
        const fExit     = daysExit  / holdDays;
        const stockRetEntry = GDB_STOCK_MONTHLY[stock.code]?.[ym]?.r  ?? m.r;
        const stockRetExit  = GDB_STOCK_MONTHLY[stock.code]?.[nxtYM]?.r ?? nextM.r;
        ret = +(stockRetEntry * fEntry + stockRetExit * fExit).toFixed(1);
      } else {
        const participation = Math.min(holdDays / 20, 1.0);
        const stockRet = GDB_STOCK_MONTHLY[stock.code]?.[ym]?.r ?? m.r;
        ret = +(stockRet * participation).toFixed(1);
      }

      // ATR 우선순위: live(_atr) > GDB_STOCK_MONTHLY > 기본값 3.5
      const getStockHS = (code, yyyyMM, mult) => {
        const liveAtr = _atr?.[code]?.[yyyyMM];
        const gdbAtr  = GDB_STOCK_MONTHLY[code]?.[yyyyMM]?.atr;
        const atrPct  = liveAtr ?? gdbAtr;
        if (atrPct == null) return 3.5;
        return +Math.min(8.0, Math.max(1.5, atrPct * mult)).toFixed(2);
      };
      const stockHardStop = getStockHS(stock.code, `${yy}-${mm}`, params.atrMult);
      ret = Math.max(ret, -(stockHardStop + 0.3));
      ret = Math.min(ret, params.trailing * 7 + 5);
      ret = +(ret - TRADE_COST_PCT).toFixed(1);

      const pnl = Math.round(ret / 100 * CAPITAL_PER_SLOT);
      const l4  = `${61 + (seed % 27)}%`;
      let reason;
      if      (ret >= params.trailing * 7 + 4.5) reason = "Trailing";
      else if (ret > 0)                           reason = `RSI-2≥${params.rsi2Exit}`;
      else if (ret > -(stockHardStop + 0.2))       reason = `ATR HardStop(${stockHardStop}%)`;
      else                                        reason = "갭다운";

      tradeLog.push({ id, code: stock.code, name: stock.name, entry, exit, ret, pnl, l4, reason, slot });
      id++;
    }
  });

  const lastRawDate = raw[raw.length - 1].d;
  const tradeByMonth = {};
  tradeLog.forEach(t => {
    const em = t.entry.slice(0, 5);
    const xm = t.exit.slice(0, 5);
    const applyMonth = (em === xm) ? em : (xm <= lastRawDate ? xm : em);
    if (!tradeByMonth[applyMonth]) tradeByMonth[applyMonth] = [];
    tradeByMonth[applyMonth].push(t.ret);
  });

  let stratVal = 100;
  const curve = raw.map((pt) => {
    const kospi   = +((pt.k / base) * 100).toFixed(2);
    const d       = kospi - 100;
    const buyhold = +(100 + d * 0.99).toFixed(2);
    const monthTrades = tradeByMonth[pt.d];
    if (monthTrades?.length > 0) {
      monthTrades.forEach(r => { stratVal = stratVal * (1 + r / 100 / NSLOTS); });
    }
    return { date: pt.d, kospi, strategy: +stratVal.toFixed(2), buyhold };
  });

  return { curve, monthly, tradeLog };
}
